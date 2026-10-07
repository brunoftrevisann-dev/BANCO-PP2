// Login biométrico (Face ID / huella / Windows Hello) vía WebAuthn — el "reto" (challenge)
// que hay que firmar y verificar en cada ceremonia (registro o login) no se guarda en el
// servidor: Vercel es serverless, no hay memoria compartida entre requests. En vez de una
// tabla nueva solo para esto, se firma como un JWT de corta duración (mismo patrón que
// utils/sesion.js, reusa `jose`) que el cliente manda de ida y vuelta sin tocarlo.
const DURACION_MS = 5 * 60 * 1000; // 5 minutos — alcanza de sobra para completar el prompt biométrico

let joseModulo = null;
async function jose() {
  if (!joseModulo) joseModulo = await import('jose');
  return joseModulo;
}

function obtenerSecreto() {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('JWT_SECRET no está configurada');
  return new TextEncoder().encode(secreto);
}

async function firmarReto(challenge) {
  const { SignJWT } = await jose();
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ challenge })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + DURACION_MS / 1000)
    .sign(obtenerSecreto());
}

async function verificarReto(token) {
  const { jwtVerify } = await jose();
  const { payload } = await jwtVerify(token, obtenerSecreto(), { algorithms: ['HS256'] });
  if (typeof payload.challenge !== 'string') throw new Error('Reto inválido');
  return payload.challenge;
}

// WebAuthn necesita el origen exacto (con esquema) y el rpID (el host, sin puerto) que usó el
// navegador. Se usa el header Origin que el propio navegador manda, en vez de confiar en
// req.protocol/req.hostname de Express — esos quedan mal detrás del proxy de Vercel a menos
// que se configure `trust proxy`, y el header Origin es justo lo que WebAuthn necesita validar.
function obtenerRpIdYOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw new Error('Falta el header Origin');
  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    throw new Error('Origin inválido');
  }
  return { rpID: hostname, origin };
}

module.exports = { firmarReto, verificarReto, obtenerRpIdYOrigin };
