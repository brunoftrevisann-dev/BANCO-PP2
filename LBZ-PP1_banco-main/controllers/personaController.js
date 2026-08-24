const Persona = require('../models/personaModel');
const { enviarCodigoVerificacion, enviarCodigoPassword, enviarCodigoAperturaUsd } = require('../utils/mailer');

function fetchBC(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
}

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');
function normalizarParaAlias(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD').replace(DIACRITICOS, '')
    .replace(/[^a-z0-9]/g, '');
}

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Intenta asignar un alias a una cuenta USD recién creada. Si el candidato base ya está en uso,
// prueba una vez más con un sufijo numérico. Ante un error que no sea "alias en uso" (puede ser
// que el Banco Central todavía no haya terminado de propagar la cuenta recién creada) reintenta
// una vez más antes de rendirse. Si todo falla, devuelve null (el usuario lo asigna a mano después).
async function intentarAsignarAliasUsd(cbu, nombre, apellido) {
  const base = `${normalizarParaAlias(nombre)}.${normalizarParaAlias(apellido)}.usd`;
  const candidatos = [base, `${base}.${Math.floor(100 + Math.random() * 900)}`];
  for (const alias of candidatos) {
    if (!alias || alias === '.usd') continue;
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const res = await fetchBC(`${process.env.BANCO_URL}/accounts/${encodeURIComponent(cbu)}/alias`, {
          method: 'PUT',
          headers: {
            'x-api-key': process.env.BANCO_TOKEN,
            'x-environment': process.env.BANCO_ENV,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ alias })
        });
        if (res.ok) return alias;
        if (res.status === 409) break; // alias en uso: probar el siguiente candidato, no reintentar este
        if (intento === 1) { await esperar(600); continue; }
        console.error(`No se pudo asignar alias USD "${alias}" a ${cbu}: HTTP ${res.status}`);
      } catch (err) {
        if (intento === 1) { await esperar(600); continue; }
        console.error(`Error de red asignando alias USD "${alias}" a ${cbu}:`, err.message);
      }
    }
  }
  return null;
}

exports.obtenerPersonas = async (req, res) => {
  try {
    const personas = await Persona.getAll();
    res.json(personas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.obtenerRoles = async (req, res) => {
  try {
    const roles = await Persona.getRoles(req.params.id);
    if (roles.length === 0) return res.status(404).json({ error: 'Persona no encontrada o sin roles' });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.obtenerProductos = async (req, res) => {
  try {
    const productos = await Persona.getProductos(req.params.id);
    if (productos.length === 0) return res.status(404).json({ error: 'Persona no encontrada o sin productos' });
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.crearPersona = async (req, res) => {
  try {
    const nuevaPersona = await Persona.create(req.body);
    res.status(201).json(nuevaPersona);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }
    const persona = await Persona.findByCredentials(email, password);
    if (!persona) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    res.json(persona);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.obtenerHistorial = async (req, res) => {
  const minutos = Math.min(parseInt(req.query.minutos) || 30, 1440);
  try {
    // 1. Sincronizar transacciones recientes desde BC API al local DB
    const response = await fetchBC(`${process.env.BANCO_URL}/transactions?minutos=${minutos}`, {
      headers: { 'x-api-key': process.env.BANCO_TOKEN, 'x-environment': process.env.BANCO_ENV }
    });
    if (response.ok) {
      const recent = await response.json();
      if (Array.isArray(recent)) {
        await Promise.all(recent.map(tx => Persona.upsertTransaccion(tx).catch(() => {})));
      }
    }
  } catch { /* BC puede estar caído, continuamos con datos locales */ }

  try {
    // 2. Devolver historial completo desde DB local (sin límite de tiempo)
    const todas = await Persona.getAllTransacciones();
    res.json(todas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.buscarPersona = async (req, res) => {
  try {
    const { tipo, valor, moneda } = req.query;
    if (!tipo || !valor) return res.status(400).json({ error: 'tipo y valor requeridos' });
    if (tipo !== 'cbu' && tipo !== 'alias') return res.status(400).json({ error: 'tipo debe ser cbu o alias' });
    // La caja en ARS se busca en /persons; cualquier otra moneda (ej. USD) vive en /accounts
    const recurso = moneda && moneda !== 'ARS' ? 'accounts' : 'persons';
    // El alias en el Banco Central es sensible a mayúsculas/minúsculas; se normaliza a minúscula
    // para que no falle por autocapitalización del navegador o por cómo lo haya tipeado el usuario.
    const valorBusqueda = tipo === 'alias' ? valor.toLowerCase() : valor;
    const url = tipo === 'cbu'
      ? `${process.env.BANCO_URL}/${recurso}/${encodeURIComponent(valorBusqueda)}`
      : `${process.env.BANCO_URL}/${recurso}/alias/${encodeURIComponent(valorBusqueda)}`;
    const response = await fetchBC(url, {
      headers: { 'x-api-key': process.env.BANCO_TOKEN, 'x-environment': process.env.BANCO_ENV }
    });
    const data = await response.json();
    // Si la BC API no devuelve DNI, enriquecer con datos de la base local
    if (response.ok && data.cbu && !data.dni) {
      try {
        const local = await Persona.getByCbu(data.cbu);
        if (local?.dni) data.dni = local.dni;
        if (!data.alias && local?.alias) data.alias = local.alias;
      } catch {}
    }
    res.status(response.status).json(data);
  } catch (error) {
    const msg = error.name === 'AbortError' ? 'Timeout: la API externa tardó demasiado' : error.message;
    res.status(504).json({ error: msg });
  }
};

exports.transferir = async (req, res) => {
  try {
    const { cbuOrigen, cbuDestino, importe, descripcion } = req.body;
    if (!cbuOrigen || !cbuDestino || !importe)
      return res.status(400).json({ error: 'cbuOrigen, cbuDestino e importe son requeridos' });
    if (Number(importe) <= 0) return res.status(400).json({ error: 'El importe debe ser mayor a 0' });
    if (cbuOrigen === cbuDestino) return res.status(400).json({ error: 'No podés transferirte a vos mismo' });

    const cuentaOrigen = await Persona.getByCbu(cbuOrigen);
    if (!cuentaOrigen) return res.status(404).json({ error: 'Cuenta origen no encontrada' });
    if (Number(cuentaOrigen.saldo) < Number(importe))
      return res.status(422).json({ error: 'Saldo insuficiente' });

    const bcRes = await fetchBC(`${process.env.BANCO_URL}/transactions`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.BANCO_TOKEN,
        'x-environment': process.env.BANCO_ENV,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cbuOrigen, cbuDestino,
        importe: Number(importe),
        saldoOrigen: Number(cuentaOrigen.saldo)
      })
    });
    const bcData = await bcRes.json();
    if (!bcRes.ok) return res.status(bcRes.status).json(bcData);
    if (bcData.estado && bcData.estado !== 'aprobada') {
      return res.status(422).json({ error: bcData.motivoRechazo || 'Transferencia rechazada por el banco central', estado: bcData.estado });
    }

    const nuevoSaldo = Number(cuentaOrigen.saldo) - Number(importe);
    await Persona.updateSaldo(cbuOrigen, nuevoSaldo);

    // Guardar descripcion en DB para ambas partes (tuo→tuo)
    if (bcData._id && descripcion) {
      await Persona.upsertTransaccion({
        ...bcData,
        descripcion: descripcion.trim().slice(0, 120)
      }).catch(() => {});
    }

    const cuentaDestino = await Persona.getByCbu(cbuDestino);
    if (cuentaDestino) {
      await Persona.updateSaldo(cbuDestino, Number(cuentaDestino.saldo) + Number(importe));
    }

    res.status(201).json({ ...bcData, nuevoSaldo });
  } catch (error) {
    const msg = error.name === 'AbortError'
      ? 'La transferencia tardó demasiado. Intentá de nuevo.'
      : `No se pudo conectar con el banco central: ${error.message}`;
    res.status(504).json({ error: msg });
  }
};

exports.cotizacionDolar = async (req, res) => {
  try {
    const [oficialRes, blueRes, mepRes] = await Promise.all([
      fetchBC('https://dolarapi.com/v1/dolares/oficial'),
      fetchBC('https://dolarapi.com/v1/dolares/blue'),
      fetchBC('https://dolarapi.com/v1/dolares/bolsa')
    ]);
    if (!oficialRes.ok || !blueRes.ok || !mepRes.ok) {
      return res.status(502).json({ error: 'No se pudo obtener la cotización del dólar' });
    }
    const [oficial, blue, mep] = await Promise.all([oficialRes.json(), blueRes.json(), mepRes.json()]);
    res.json({ oficial, blue, mep });
  } catch (error) {
    const msg = error.name === 'AbortError' ? 'Timeout: la API externa tardó demasiado' : error.message;
    res.status(504).json({ error: msg });
  }
};

// Paso 1: verifica que dni/telefono/email coincidan con la persona logueada y manda el código por email
exports.solicitarAperturaUsd = async (req, res) => {
  try {
    const { idPersona, dni, telefono, email } = req.body;
    if (!idPersona || !dni || !telefono || !email)
      return res.status(400).json({ error: 'idPersona, dni, telefono y email son requeridos' });

    const yaExiste = await Persona.getCuentaPorMoneda(idPersona, 'USD');
    if (yaExiste) return res.status(200).json(yaExiste);

    const coincide = await Persona.verificarDatosPersona(idPersona, dni.trim(), telefono.trim(), email.trim());
    if (!coincide) return res.status(403).json({ error: 'Los datos no coinciden con los de tu cuenta' });

    const result = await Persona.generarTokenPassword(email);
    if (!result) return res.status(404).json({ error: 'Persona no encontrada' });

    await enviarCodigoAperturaUsd(email, result.nombre, result.token);
    res.json({ message: 'Te enviamos un código a tu email. Tenés 5 minutos para confirmarlo.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Paso 2: confirma el código y recién ahí abre la cuenta en el Banco Central
exports.abrirCuentaUsd = async (req, res) => {
  try {
    const { idPersona, email, token } = req.body;
    if (!idPersona || !email || !token) return res.status(400).json({ error: 'idPersona, email y token son requeridos' });

    const existente = await Persona.getCuentaPorMoneda(idPersona, 'USD');
    if (existente) return res.status(200).json(existente);

    const verif = await Persona.verificarTokenPassword(email, token);
    if (!verif.ok) return res.status(400).json({ error: verif.motivo });

    const persona = await Persona.getDatosBasicos(idPersona);
    if (!persona) return res.status(404).json({ error: 'Persona no encontrada' });

    const bcRes = await fetchBC(`${process.env.BANCO_URL}/accounts`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.BANCO_TOKEN,
        'x-environment': process.env.BANCO_ENV,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ dni: persona.dni, moneda: 'USD' })
    });
    const bcData = await bcRes.json();
    if (!bcRes.ok) return res.status(bcRes.status).json(bcData);
    if (!bcData.cbu) return res.status(502).json({ error: 'El Banco Central no devolvió los datos de la cuenta USD' });

    // El Banco Central no asigna alias solo al abrir la cuenta: se lo generamos y asignamos acá
    const alias = bcData.alias || await intentarAsignarAliasUsd(bcData.cbu, persona.nombre, persona.apellido);

    const cuenta = await Persona.crearCuentaUsd(idPersona, bcData.cbu, alias);
    await Persona.limpiarTokenPorEmail(email);
    res.status(201).json(cuenta);
  } catch (error) {
    if (error.code === '23505') {
      const existente = await Persona.getCuentaPorMoneda(req.body.idPersona, 'USD');
      if (existente) return res.status(200).json(existente);
    }
    const msg = error.name === 'AbortError' ? 'La operación tardó demasiado. Intentá de nuevo.' : error.message;
    res.status(500).json({ error: msg });
  }
};

exports.cambiarDivisa = async (req, res) => {
  try {
    const { idPersona, direccion, importeUsd } = req.body;
    if (!idPersona || !direccion || !importeUsd)
      return res.status(400).json({ error: 'idPersona, direccion e importeUsd son requeridos' });
    if (!['compra', 'venta'].includes(direccion))
      return res.status(400).json({ error: 'direccion debe ser compra o venta' });
    if (Number(importeUsd) <= 0) return res.status(400).json({ error: 'El importe debe ser mayor a 0' });

    // Compra/venta de USD siempre usa la cotización MEP ("bolsa" en dolarapi)
    const rateRes = await fetchBC('https://dolarapi.com/v1/dolares/bolsa');
    if (!rateRes.ok) return res.status(502).json({ error: 'No se pudo obtener la cotización del dólar' });
    const { compra, venta } = await rateRes.json();

    const resultado = await Persona.cambiarDivisa(idPersona, direccion, Number(importeUsd), compra, venta);
    const tasaUsada = direccion === 'compra' ? venta : compra;

    const fmtNum = v => Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const descripcion = direccion === 'compra'
      ? `Compra de US$ ${fmtNum(importeUsd)} al dólar MEP ($ ${fmtNum(tasaUsada)})`
      : `Venta de US$ ${fmtNum(importeUsd)} al dólar MEP ($ ${fmtNum(tasaUsada)})`;
    const txId = 'CAMBIO-' + require('crypto').randomUUID();
    const createdAt = new Date().toISOString();

    // Se registra en el historial igual que un depósito o transferencia. Si falla el guardado,
    // no bloqueamos la respuesta: la plata ya se movió correctamente entre las dos cuentas.
    await Persona.upsertTransaccion({
      _id: txId,
      cbuOrigen: direccion === 'compra' ? resultado.cbuArs : resultado.cbuUsd,
      cbuDestino: direccion === 'compra' ? resultado.cbuUsd : resultado.cbuArs,
      importe: resultado.importeArs,
      estado: 'aprobada',
      descripcion,
      tipo: 'cambio_divisa',
      createdAt
    }).catch(e => console.error('Error registrando cambio de divisa en el historial:', e.message));

    res.json({ ...resultado, tasaUsada, txId, descripcion, createdAt });
  } catch (error) {
    if (error.code === 'NO_CUENTA') return res.status(404).json({ error: error.message });
    if (error.code === 'SALDO_INSUFICIENTE') return res.status(422).json({ error: error.message });
    const msg = error.name === 'AbortError' ? 'La operación tardó demasiado. Intentá de nuevo.' : error.message;
    res.status(500).json({ error: msg });
  }
};

exports.actualizarAlias = async (req, res) => {
  try {
    const { cbu, moneda } = req.body;
    let { alias } = req.body;
    if (!cbu || !alias) return res.status(400).json({ error: 'cbu y alias requeridos' });
    if (!/^[a-zA-Z0-9.\-]+$/.test(alias))
      return res.status(400).json({ error: 'El alias solo puede contener letras, números, puntos y guiones' });

    // El Banco Central distingue mayúsculas/minúsculas en el alias: se normaliza a minúscula
    // para que después siempre se pueda encontrar sin importar cómo lo haya tipeado quien busca.
    alias = alias.toLowerCase();

    // La caja en ARS actualiza el alias en /persons; cualquier otra moneda (ej. USD) vive en /accounts
    const recurso = moneda && moneda !== 'ARS' ? 'accounts' : 'persons';
    const bcRes = await fetchBC(`${process.env.BANCO_URL}/${recurso}/${encodeURIComponent(cbu)}/alias`, {
      method: 'PUT',
      headers: {
        'x-api-key': process.env.BANCO_TOKEN,
        'x-environment': process.env.BANCO_ENV,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ alias })
    });

    if (!bcRes.ok) {
      const errData = await bcRes.json();
      return res.status(bcRes.status).json(errData);
    }

    await Persona.updateAlias(cbu, alias);
    res.status(200).json({ message: 'Alias actualizado', alias });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Registrar persona con cuenta bancaria
exports.depositar = async (req, res) => {
  try {
    const { cbu, importe } = req.body;
    if (!cbu || !importe) return res.status(400).json({ error: 'cbu e importe requeridos' });
    if (Number(importe) <= 0) return res.status(400).json({ error: 'El importe debe ser mayor a 0' });
    if (Number(importe) > 1000000) return res.status(400).json({ error: 'El importe no puede superar $1.000.000' });

    const cuenta = await Persona.getByCbu(cbu);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const nuevoSaldo = Number(cuenta.saldo) + Number(importe);
    await Persona.updateSaldo(cbu, nuevoSaldo);

    await Persona.upsertTransaccion({
      _id: 'DEP-' + require('crypto').randomUUID(),
      cbuOrigen: 'DEPOSITO',
      cbuDestino: cbu,
      importe: Number(importe),
      estado: 'aprobada',
      motivoRechazo: null,
      bankCodeOrigen: null,
      bankCodeDestino: null,
      personaOrigen: null,
      personaDestino: { nombre: cuenta.nombre, apellido: cuenta.apellido },
      createdAt: new Date().toISOString()
    });

    res.json({ nuevoSaldo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reenviarCodigo = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email requerido' });
    const persona = await Persona.reenviarToken(email);
    if (!persona) return res.status(404).json({ error: 'Email no encontrado o cuenta ya verificada' });
    await enviarCodigoVerificacion(email, persona.nombre, persona.token);
    res.json({ message: 'Código reenviado. Tenés 5 minutos.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verificarCuenta = async (req, res) => {
  try {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ error: 'email y token requeridos' });
    const resultado = await Persona.verificarToken(email, token);
    if (!resultado.ok) return res.status(400).json({ error: resultado.motivo });
    res.json({ message: 'Cuenta verificada. Ya podés iniciar sesión.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.sincronizarSaldo = async (req, res) => {
  try {
    const { cbu, nuevoSaldo } = req.body;
    if (!cbu || nuevoSaldo === undefined) return res.status(400).json({ error: 'cbu y nuevoSaldo requeridos' });
    await Persona.updateSaldo(cbu, Number(nuevoSaldo));
    res.json({ saldo: Number(nuevoSaldo) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.registrarPersona = async (req, res) => {
  try {
    const { nombre, apellido, dni, email, telefono, fecha_nac, domicilio, cbu, alias, password } = req.body;

    // Validar campos requeridos
    if (!nombre || !apellido || !dni || !email || !telefono || !fecha_nac || !domicilio || !cbu || !alias || !password) {
      const faltantes = [];
      if (!nombre) faltantes.push('nombre');
      if (!apellido) faltantes.push('apellido');
      if (!dni) faltantes.push('dni');
      if (!email) faltantes.push('email');
      if (!telefono) faltantes.push('telefono');
      if (!fecha_nac) faltantes.push('fecha_nac');
      if (!domicilio) faltantes.push('domicilio');
      if (!cbu) faltantes.push('cbu');
      if (!alias) faltantes.push('alias');
      if (!password) faltantes.push('password');
      return res.status(400).json({ error: `Campos faltantes: ${faltantes.join(', ')}` });
    }

    const resultado = await Persona.registrarConCuenta(req.body);
    let emailEnviado = true;
    try {
      await enviarCodigoVerificacion(req.body.email, req.body.nombre, resultado.token);
    } catch (emailError) {
      console.error('Error enviando email de verificación:', emailError.message);
      emailEnviado = false;
    }
    res.status(201).json({
      message: emailEnviado
        ? 'Te enviamos un código a tu email. Tenés 5 minutos para verificar tu cuenta.'
        : 'Cuenta creada pero no pudimos enviar el email. Usá la opción de reenviar código.',
      pendingVerification: true,
      emailEnviado,
      email: req.body.email
    });
  } catch (error) {
    if (error.code === '23505' || error.message.includes('duplicate') || error.message.includes('unique')) {
      const detail = (error.detail || '').toLowerCase();
      if (detail.includes('dni')) return res.status(409).json({ error: 'El DNI ya está registrado' });
      if (detail.includes('email')) return res.status(409).json({ error: 'El email ya está registrado' });
      return res.status(409).json({ error: 'El DNI o email ya están registrados' });
    }
    if (error.message && error.message.toLowerCase().includes('already')) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.solicitarCambioPassword = async (req, res) => {
  try {
    const { email, passwordActual } = req.body;
    if (!email || !passwordActual)
      return res.status(400).json({ error: 'Email y contraseña actual requeridos' });

    const valido = await Persona.verificarPassword(email, passwordActual);
    if (!valido)
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const result = await Persona.generarTokenPassword(email);
    if (!result)
      return res.status(404).json({ error: 'Usuario no encontrado' });

    try {
      await enviarCodigoPassword(email, result.nombre, result.token);
    } catch (e) {
      console.error('Error enviando email cambio contraseña:', e.message);
      return res.status(500).json({ error: 'No se pudo enviar el email. Intentá de nuevo.' });
    }

    res.json({ message: 'Código enviado a tu email' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.confirmarCambioPassword = async (req, res) => {
  try {
    const { email, token, nuevaPassword } = req.body;
    if (!email || !token || !nuevaPassword)
      return res.status(400).json({ error: 'Email, código y nueva contraseña requeridos' });
    if (nuevaPassword.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const result = await Persona.verificarTokenPassword(email, token);
    if (!result.ok)
      return res.status(400).json({ error: result.motivo });

    await Persona.updatePassword(email, nuevaPassword);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};