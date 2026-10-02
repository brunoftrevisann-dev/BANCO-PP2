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

// Registra la lectura y avisa al dueño del QR ("Fulano escaneó tu QR"), evitando avisos
// repetidos del mismo QR+banco en los últimos 30s (la cámara suele leer el mismo cuadro
// varias veces seguidas). Compartida entre el endpoint público (rol emisor) y el caso
// "nos escaneamos a nosotros mismos" (ver avisarLecturaAlEmisor).
async function registrarYNotificarLectura({ cbu, jti, bancoLector, nombreLector }) {
  const cuenta = await Persona.getByCbu(cbu);
  if (!cuenta) return { avisado: false };

  const repetido = await QrLectura.yaAvisado({ bancoLector, jti, cbu });
  if (repetido) return { avisado: true };

  await QrLectura.registrar({ idPersona: cuenta.id_persona, cbu, jti, bancoLector, nombreLector });

  const esOtroBanco = bancoLector !== obtenerBankCode();
  const nombreBanco = esOtroBanco ? (bancosAviso[bancoLector]?.nombre || null) : null;
  notificarQrLeido(cuenta.id_persona, { nombreLector, nombreBanco })
    .catch(e => console.error('Error creando notificación de lectura de QR:', e.message));

  return { avisado: true };
}

// Rol lector: después de decodificar cualquier QR JWT (verificado o no), le avisa al banco
// emisor que alguien lo leyó. Nunca bloquea ni condiciona el resto del flujo de pago: si el
// otro banco está caído o tarda, no importa — por eso nunca se espera ni se "awaitea" desde
// exports.verificar, y cualquier error se traga en silencio.
async function avisarLecturaAlEmisor(qrTexto, idPersonaLector) {
  const texto = String(qrTexto || '');
  if (!FORMA_JWT.test(texto)) return; // no es un JWT (CBU plano, JSON, etc.) — nada que avisar

  let claimsCrudos;
  try {
    claimsCrudos = JSON.parse(Buffer.from(texto.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return;
  }

  const bancoEmisor = Number(claimsCrudos.iss);
  if (!Number.isInteger(bancoEmisor) || typeof claimsCrudos.cbu !== 'string') return;

  let nombreLector = null;
  if (idPersonaLector) {
    try {
      const datos = await Persona.getDatosBasicos(idPersonaLector);
      if (datos) nombreLector = `${datos.nombre} ${(datos.apellido || '').charAt(0)}.`.trim().slice(0, 40);
    } catch { /* si no se puede resolver el nombre, se avisa sin nombre */ }
  }

  if (bancoEmisor === obtenerBankCode()) {
    // Es un QR propio (de otro usuario de tuo): se procesa en el mismo proceso, sin HTTP.
    await registrarYNotificarLectura({
      cbu: claimsCrudos.cbu, jti: typeof claimsCrudos.jti === 'string' ? claimsCrudos.jti : null,
      bancoLector: obtenerBankCode(), nombreLector
    });
    return;
  }

  const destino = bancosAviso[bancoEmisor];
  if (!destino || !destino.avisoUrl) return; // banco no conocido o sin aviso implementado

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(destino.avisoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr: texto, banco: obtenerBankCode(), nombre: nombreLector }),
      signal: ctrl.signal
    });
  } catch { /* fire-and-forget */ }
  finally { clearTimeout(tid); }
}

exports.verificar = async (req, res) => {
  try {
    const { qr, idPersona } = req.body;
    const resultado = await verificarQr(qr, bancosConocidos);
    avisarLecturaAlEmisor(qr, idPersona ? Number(idPersona) : null)
      .catch(e => console.error('Error avisando lectura de QR:', e.message));
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

// Rol emisor: otro banco (o el nuestro, para bancos sin el aviso implementado todavía) nos
// avisa que alguien leyó uno de nuestros QR. Endpoint público, sin login — contrato en
// prompt-aviso-lectura-qr.md. No mueve plata ni condiciona ningún pago, solo informa.
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

    const { avisado } = await registrarYNotificarLectura({ cbu: claims.cbu, jti: claims.jti, bancoLector: bancoNum, nombreLector });
    res.status(202).json({ ok: true, avisado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
