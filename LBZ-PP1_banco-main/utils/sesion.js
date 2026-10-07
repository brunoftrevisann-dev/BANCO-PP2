// Sesiones reales (cookie httpOnly + JWT) — antes todo endpoint confiaba ciegamente en el
// idPersona/cbu que mandaba el cliente en el body/query, así que cualquiera podía operar como
// si fuera otra persona con solo conocer su id o cbu. Reusa `jose` (ya es dependencia, usado
// para firmar los QR interbancarios) en vez de agregar jsonwebtoken — misma API.
const NOMBRE_COOKIE = 'tuo_session';
const DURACION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — primera vez que hay sesiones, sin refresh tokens todavía

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
    // secure:true exige HTTPS — en local (node app.js, sin HTTPS) el navegador directamente
    // ignora la cookie si se manda así, y el login "funciona" pero ninguna request siguiente
    // queda autenticada. Vercel pone NODE_ENV=production solo en producción (HTTPS real).
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: DURACION_MS
  });
}

function limpiarCookieSesion(res) {
  res.clearCookie(NOMBRE_COOKIE);
}

// Middleware: exige una sesión válida y deja el id de la persona en req.idPersona. Nunca lee
// idPersona/cbu del body/query para decidir identidad — esa es la causa raíz del problema que
// esto corrige, así que el resto del código tiene que empezar a confiar solo en req.idPersona.
function requireAuth(req, res, next) {
  const token = req.cookies?.[NOMBRE_COOKIE];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  verificarSesion(token)
    .then(idPersona => { req.idPersona = idPersona; next(); })
    .catch(() => res.status(401).json({ error: 'Sesión inválida o vencida' }));
}

module.exports = { firmarSesion, verificarSesion, setCookieSesion, limpiarCookieSesion, requireAuth };
