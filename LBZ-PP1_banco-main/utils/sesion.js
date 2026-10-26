// Sesión en cookie httpOnly con JWT: la identidad sale siempre de acá, nunca del body ni de la query.
const NOMBRE_COOKIE = 'tuo_session';
const DURACION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días, sin refresh tokens

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

async function firmarSesion(idPersona) {
  const { SignJWT } = await jose();
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: String(idPersona) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + DURACION_MS / 1000)
    .sign(obtenerSecreto());
}

async function verificarSesion(token) {
  const { jwtVerify } = await jose();
  const { payload } = await jwtVerify(token, obtenerSecreto(), { algorithms: ['HS256'] });
  const idPersona = parseInt(payload.sub, 10);
  if (!idPersona) throw new Error('Sesión inválida');
  return idPersona;
}

function setCookieSesion(res, token) {
  res.cookie(NOMBRE_COOKIE, token, {
    httpOnly: true,
    // En local no hay HTTPS, y con secure:true el navegador descarta la cookie.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: DURACION_MS
  });
}

function limpiarCookieSesion(res) {
  res.clearCookie(NOMBRE_COOKIE);
}

// Deja el id en req.idPersona: el resto del código tiene que confiar solo en ese valor.
function requireAuth(req, res, next) {
  const token = req.cookies?.[NOMBRE_COOKIE];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  verificarSesion(token)
    .then(idPersona => { req.idPersona = idPersona; next(); })
    .catch(() => res.status(401).json({ error: 'Sesión inválida o vencida' }));
}

module.exports = { firmarSesion, verificarSesion, setCookieSesion, limpiarCookieSesion, requireAuth };
