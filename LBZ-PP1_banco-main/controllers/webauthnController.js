const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');
const Persona = require('../models/personaModel');
const Credencial = require('../models/webauthnModel');
const { firmarReto, verificarReto, obtenerRpIdYOrigin } = require('../utils/webauthnReto');
const { firmarSesion, setCookieSesion } = require('../utils/sesion');

function detectarDispositivoDesdeUA(ua) {
  if (!ua) return 'Dispositivo';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Dispositivo';
}

// Rol "activar biometría" — requiere sesión ya iniciada (con contraseña), se usa desde
// settings.html para registrar una passkey nueva en ESTE dispositivo.
exports.opcionesRegistro = async (req, res) => {
  try {
    const { rpID } = obtenerRpIdYOrigin(req);
    const persona = await Persona.getParaSesion(req.idPersona);
    if (!persona) return res.status(404).json({ error: 'Persona no encontrada' });

    const yaRegistradas = await Credencial.getPorPersona(req.idPersona);

    const options = await generateRegistrationOptions({
      rpName: 'tuo',
      rpID,
      userID: Buffer.from(String(req.idPersona)),
      userName: persona.email,
      userDisplayName: `${persona.nombre} ${persona.apellido}`,
      attestationType: 'none',
      // residentKey:'required' es lo que hace que esto sea una passkey de verdad: el propio
      // dispositivo recuerda a quién pertenece, así el login no necesita pedir el email.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
      excludeCredentials: yaRegistradas.map(c => ({ id: c.credential_id }))
    });

    const reto = await firmarReto(options.challenge);
    res.json({ options, reto });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verificarRegistro = async (req, res) => {
  try {
    const { attResp, reto } = req.body;
    if (!attResp || !reto) return res.status(400).json({ error: 'attResp y reto son requeridos' });

    const { rpID, origin } = obtenerRpIdYOrigin(req);
    let expectedChallenge;
    try {
      expectedChallenge = await verificarReto(reto);
    } catch {
      return res.status(400).json({ error: 'El reto venció o es inválido, intentá de nuevo' });
    }

    const verificacion = await verifyRegistrationResponse({
      response: attResp,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID
    });
    if (!verificacion.verified || !verificacion.registrationInfo) {
      return res.status(400).json({ error: 'No se pudo verificar la credencial' });
    }

    const { credentialID, credentialPublicKey, counter } = verificacion.registrationInfo;
    await Credencial.crear(req.idPersona, {
      credentialId: credentialID,
      publicKey: isoBase64URL.fromBuffer(credentialPublicKey),
      counter,
      deviceLabel: detectarDispositivoDesdeUA(req.headers['user-agent'])
    });

    res.status(201).json({ credentialId: credentialID });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Rol "login" — público, sin sesión todavía (es justamente lo que la va a crear). Sin
// allowCredentials: el navegador le muestra al usuario cualquier passkey de tuo guardada en
// este dispositivo, sin que el server tenga que saber de antemano quién es.
exports.opcionesLogin = async (req, res) => {
  try {
    const { rpID } = obtenerRpIdYOrigin(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    const reto = await firmarReto(options.challenge);
    res.json({ options, reto });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verificarLogin = async (req, res) => {
  try {
    const { authResp, reto } = req.body;
    if (!authResp || !reto) return res.status(400).json({ error: 'authResp y reto son requeridos' });

    const { rpID, origin } = obtenerRpIdYOrigin(req);
    let expectedChallenge;
    try {
      expectedChallenge = await verificarReto(reto);
    } catch {
      return res.status(400).json({ error: 'El reto venció o es inválido, intentá de nuevo' });
    }

    // La identidad sale de qué credential_id es (ya ligado a una persona en nuestra propia
    // base), no de decodificar el userHandle que manda el navegador — misma garantía, un paso menos.
    const credencial = await Credencial.getPorCredentialId(authResp.id);
    if (!credencial) return res.status(401).json({ error: 'Esa passkey no está registrada en tuo' });

    const verificacion = await verifyAuthenticationResponse({
      response: authResp,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: credencial.credential_id,
        credentialPublicKey: isoBase64URL.toBuffer(credencial.public_key),
        counter: credencial.counter
      }
    });
    if (!verificacion.verified) return res.status(401).json({ error: 'No se pudo verificar la huella/rostro' });

    await Credencial.actualizarCounter(credencial.credential_id, verificacion.authenticationInfo.newCounter);

    const persona = await Persona.getParaSesion(credencial.id_persona);
    if (!persona) return res.status(404).json({ error: 'Persona no encontrada' });

    // Misma cookie de sesión que el login con contraseña — nada nuevo del lado de las ~25
    // rutas que ya exigen requireAuth.
    setCookieSesion(res, await firmarSesion(persona.id));
    res.json(persona);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.eliminarCredencial = async (req, res) => {
  try {
    const borrada = await Credencial.eliminar(req.idPersona, req.params.id);
    if (!borrada) return res.status(404).json({ error: 'Credencial no encontrada' });
    res.json({ message: 'Acceso biométrico desactivado en este dispositivo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
