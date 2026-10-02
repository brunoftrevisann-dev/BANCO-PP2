const Persona = require('../models/personaModel');
const QrLectura = require('../models/qrLecturaModel');
const bancosConocidos = require('../config/bancosConocidosQr');
const bancosAviso = require('../config/bancosAviso');
const { firmarQr, verificarQr, verificarQrPropio, obtenerBankCode } = require('../utils/qrJwt');
const { notificarQrLeido } = require('../utils/notificaciones');

const FORMA_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Solo se firman QR de cuentas que realmente son de tuo, con el alias y la moneda que figuran en
// la base: si no, la firma de tuo serviría para respaldar un CBU ajeno o datos inventados.
exports.firmar = async (req, res) => {
  try {
    const { cbu, monto } = req.body;
    if (!cbu) return res.status(400).json({ error: 'cbu requerido' });
    if (monto !== undefined && !(Number(monto) > 0)) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const cuenta = await Persona.getByCbu(cbu);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const jwt = await firmarQr({
      cbu: cuenta.cbu,
      alias: cuenta.alias,
      moneda: cuenta.moneda,
      monto: monto !== undefined ? Number(monto) : undefined
    });
    res.json({ jwt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function resolverNombreBanco(bancoLector) {
  return bancoLector !== obtenerBankCode() ? (bancosAviso[bancoLector]?.nombre || null) : null;
}

// Registra la lectura y avisa al dueño del QR ("Fulano escaneó tu QR"). Compartida entre el
// endpoint público (rol emisor) y el caso "nos escaneamos a nosotros mismos" (ver
// avisarLecturaAlEmisor). Devuelve { avisado, usado }:
// - usado=true   → el QR (con jti) ya lo había cerrado OTRO lector antes: hay que responder 409.
// - avisado=true → se aceptó (primera vez, repetición del mismo lector, o sin jti dentro de los 30s).
async function registrarYNotificarLectura({ cbu, jti, bancoLector, nombreLector }) {
  const cuenta = await Persona.getByCbu(cbu);
  if (!cuenta) return { avisado: false, usado: false };

  if (jti) {
    const { resultado } = await QrLectura.intentarCerrarConJti({ idPersona: cuenta.id_persona, cbu, jti, bancoLector, nombreLector });
    if (resultado === 'usado_por_otro') return { avisado: false, usado: true };
    if (resultado === 'repetida_mismo_lector') return { avisado: true, usado: false };
    // 'primera'
    notificarQrLeido(cuenta.id_persona, { nombreLector, nombreBanco: resolverNombreBanco(bancoLector) })
      .catch(e => console.error('Error creando notificación de lectura de QR:', e.message));
    return { avisado: true, usado: false };
  }

  // Sin jti (QR viejos): nunca se cierran, solo se ignoran repetidos de la misma cuenta+banco en 30s.
  const repetido = await QrLectura.yaAvisado({ bancoLector, cbu });
  if (repetido) return { avisado: true, usado: false };

  await QrLectura.registrar({ idPersona: cuenta.id_persona, cbu, jti: null, bancoLector, nombreLector });
  notificarQrLeido(cuenta.id_persona, { nombreLector, nombreBanco: resolverNombreBanco(bancoLector) })
    .catch(e => console.error('Error creando notificación de lectura de QR:', e.message));
  return { avisado: true, usado: false };
}

// Rol lector: después de decodificar cualquier QR JWT (verificado o no), le avisa al banco
// emisor que alguien lo leyó, y ESPERA la respuesta hasta 3s para saber si el QR ya estaba
// usado (409) — si lo está, no hay que dejar pagar. Cualquier otro caso (202, timeout, error,
// banco sin avisoUrl) nunca tiene que trabar el pago: se interpreta como "seguir normal".
async function avisarLecturaAlEmisor(qrTexto, idPersonaLector) {
  const texto = String(qrTexto || '');
  if (!FORMA_JWT.test(texto)) return { usado: false }; // no es un JWT — nada que avisar

  let claimsCrudos;
  try {
    claimsCrudos = JSON.parse(Buffer.from(texto.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return { usado: false };
  }

  const bancoEmisor = Number(claimsCrudos.iss);
  if (!Number.isInteger(bancoEmisor) || typeof claimsCrudos.cbu !== 'string') return { usado: false };

  let nombreLector = null;
  if (idPersonaLector) {
    try {
      const datos = await Persona.getDatosBasicos(idPersonaLector);
      if (datos) nombreLector = `${datos.nombre} ${(datos.apellido || '').charAt(0)}.`.trim().slice(0, 40);
    } catch { /* si no se puede resolver el nombre, se avisa sin nombre */ }
  }

  const jtiCrudo = typeof claimsCrudos.jti === 'string' ? claimsCrudos.jti : null;

  if (bancoEmisor === obtenerBankCode()) {
    // Es un QR propio (de otro usuario de tuo): se procesa en el mismo proceso, sin HTTP.
    const { usado } = await registrarYNotificarLectura({ cbu: claimsCrudos.cbu, jti: jtiCrudo, bancoLector: obtenerBankCode(), nombreLector });
    return { usado };
  }

  const destino = bancosAviso[bancoEmisor];
  if (!destino || !destino.avisoUrl) return { usado: false }; // banco no conocido o sin aviso implementado

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 3000);
  try {
    const resp = await fetch(destino.avisoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr: texto, banco: obtenerBankCode(), nombre: nombreLector }),
      signal: ctrl.signal
    });
    if (resp.status === 409) return { usado: true };
    return { usado: false };
  } catch {
    return { usado: false }; // banco caído, timeout, etc. — nunca frena el pago
  } finally {
    clearTimeout(tid);
  }
}

exports.verificar = async (req, res) => {
  try {
    const { qr, idPersona } = req.body;
    const [resultado, { usado }] = await Promise.all([
      verificarQr(qr, bancosConocidos),
      avisarLecturaAlEmisor(qr, idPersona ? Number(idPersona) : null)
    ]);

    if (usado) {
      return res.status(409).json({ tipo: 'usado', error: 'Este QR ya fue escaneado por otra persona. Pedí que te muestren uno nuevo.' });
    }
    if (resultado.tipo === 'error') return res.status(400).json({ tipo: 'error', error: 'Código QR no reconocido' });
    if (resultado.tipo === 'rechazado') {
      console.error('QR rechazado:', resultado.motivoInterno);
      return res.status(422).json({ tipo: 'rechazado', error: 'Este código no es válido o venció' });
    }
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Rol emisor: otro banco (o el nuestro, in-process) nos avisa que alguien leyó uno de
// nuestros QR. Endpoint público, sin login — contrato en prompt-aviso-lectura-qr.md.
// No mueve plata; si el QR ya estaba cerrado por otro lector, responde 409.
exports.avisoLectura = async (req, res) => {
  try {
    const { qr, banco, nombre } = req.body;
    if (typeof qr !== 'string' || !qr || qr.length > 4096) return res.status(400).json({ error: 'qr requerido' });
    const bancoNum = Number(banco);
    if (!Number.isInteger(bancoNum) || bancoNum <= 0) return res.status(400).json({ error: 'banco requerido' });
    const nombreLector = typeof nombre === 'string' ? (nombre.trim().slice(0, 40) || null) : null;

    let claims;
    try {
      claims = await verificarQrPropio(qr);
    } catch (e) {
      return res.status(401).json({ error: 'QR inválido o vencido' });
    }

    const { avisado, usado } = await registrarYNotificarLectura({ cbu: claims.cbu, jti: claims.jti, bancoLector: bancoNum, nombreLector });
    if (usado) return res.status(409).json({ ok: false, usado: true, error: 'Este QR ya fue escaneado' });
    res.status(202).json({ ok: true, avisado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Polling del QR propio (cada 2s mientras el modal está abierto en dashboard.html/dolares.html)
// para saber si ya lo escanearon y cerrarlo en pantalla — alternativa a Supabase Realtime,
// que exigiría RLS con auth.uid() sin mapeo directo a nuestras personas (login propio, sin
// sesiones de Supabase Auth).
exports.estado = async (req, res) => {
  try {
    const jti = String(req.query.jti || '');
    if (!jti) return res.status(400).json({ error: 'jti requerido' });
    const fila = await QrLectura.buscarPorJti(jti);
    if (!fila) return res.json({ usado: false });
    res.json({
      usado: true,
      bancoLector: fila.banco_lector,
      nombreLector: fila.nombre_lector,
      nombreBanco: resolverNombreBanco(fila.banco_lector)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
