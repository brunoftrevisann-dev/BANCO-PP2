const Persona = require('../models/personaModel');
const { enviarCodigoVerificacion } = require('../utils/mailer');

function fetchBC(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
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
    const { tipo, valor } = req.query;
    if (!tipo || !valor) return res.status(400).json({ error: 'tipo y valor requeridos' });
    if (tipo !== 'cbu' && tipo !== 'alias') return res.status(400).json({ error: 'tipo debe ser cbu o alias' });
    const url = tipo === 'cbu'
      ? `${process.env.BANCO_URL}/persons/${encodeURIComponent(valor)}`
      : `${process.env.BANCO_URL}/persons/alias/${encodeURIComponent(valor)}`;
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
    const { cbuOrigen, cbuDestino, importe } = req.body;
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

exports.actualizarAlias = async (req, res) => {
  try {
    const { cbu, alias } = req.body;
    if (!cbu || !alias) return res.status(400).json({ error: 'cbu y alias requeridos' });
    if (!/^[a-zA-Z0-9.\-]+$/.test(alias))
      return res.status(400).json({ error: 'El alias solo puede contener letras, números, puntos y guiones' });

    const bcRes = await fetchBC(`${process.env.BANCO_URL}/persons/${encodeURIComponent(cbu)}/alias`, {
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
    console.log('Datos recibidos en registrarPersona:', req.body);
    
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
      console.log('Campos faltantes:', faltantes);
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