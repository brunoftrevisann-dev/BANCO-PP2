let joseModulo = null;
async function jose() {
  if (!joseModulo) joseModulo = await import('jose');
  return joseModulo;
}

const obtenerBankCode = () => Number(process.env.BANK_CODE || 12);
const obtenerKid = () => process.env.QR_KID || 'tuo-1';

// Clave pública de firma — no es secreta, puede vivir en el código (prompt-aviso-lectura-qr.md
// v2, sección 1). La privada (con "d") ya NO vive en Express/Vercel: se movió a un secret de
// Supabase (QR_JWT_PRIVATE_KEY) que solo lee la Edge Function qr-firmar. Mismo par de claves
// de siempre — nunca se compartió públicamente, así que no hay ruptura de compatibilidad.
const CLAVE_PUBLICA_JWK = {
  kty: 'EC', crv: 'P-256',
  x: 'FpUlRhsV90k-HnjgOjjHdmR_BQXAh9cgkNjDZn56YNs',
  y: 'IbFlt8whZYvoA0dIOla6Og0zOgKcrO3J7RR_uNoYm2o'
};

function obtenerClavePublicaJwk() {
  return CLAVE_PUBLICA_JWK;
}

// Firma vía la Edge Function qr-firmar (Supabase), que es la única que tiene acceso a la
// clave privada. Protegida con un secret compartido propio — no es la clave de firma, solo
// autoriza a este backend a pedir firmas.
async function firmarQr({ cbu, alias, monto, moneda }) {
  const secreto = process.env.QR_FIRMAR_INTERNAL_SECRET;
  if (!secreto) throw new Error('QR_FIRMAR_INTERNAL_SECRET no está configurada');
  const url = `${process.env.SUPABASE_URL}/functions/v1/qr-firmar`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secreto}` },
      body: JSON.stringify({ cbu, alias, monto, moneda }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      const cuerpo = await resp.json().catch(() => ({}));
      throw new Error(cuerpo.error || `qr-firmar respondió ${resp.status}`);
    }
    const { jwt } = await resp.json();
    return jwt;
  } finally {
    clearTimeout(tid);
  }
}

// Verifica un QR con NUESTRA PROPIA clave pública (nunca la de otro banco) — lo usa el
// endpoint que recibe "avisos de lectura" de otros bancos (prompt-aviso-lectura-qr.md):
// ahí solo hace falta probar que el QR es nuestro y no venció, no la identidad de quien
// lo leyó (eso no se puede verificar sin firma del banco lector, y a propósito no se pide).
async function verificarQrPropio(jwt) {
  const { jwtVerify, importJWK } = await jose();
  const clavePublica = await importJWK(obtenerClavePublicaJwk(), 'ES256');
  const { payload } = await jwtVerify(jwt, clavePublica, { algorithms: ['ES256'], clockTolerance: 120 });
  if (Number(payload.iss) !== obtenerBankCode()) throw new Error('iss no coincide con este banco');
  if (typeof payload.cbu !== 'string' || !/^\d{22}$/.test(payload.cbu)) throw new Error('cbu inválido en el QR');
  return { cbu: payload.cbu, jti: typeof payload.jti === 'string' ? payload.jti : null };
}

// Los claims de un QR ajeno se usan para precargar formularios: se devuelven solo los campos
// esperados y con el tipo esperado, nunca el objeto crudo.
function normalizarClaims(crudo) {
  if (!crudo || typeof crudo.cbu !== 'string' || !/^\d{22}$/.test(crudo.cbu)) return null;
  const claims = { cbu: crudo.cbu };
  if (crudo.moneda === 'ARS' || crudo.moneda === 'USD') claims.moneda = crudo.moneda;
  if (typeof crudo.alias === 'string' && /^[a-zA-Z0-9.\-]{1,50}$/.test(crudo.alias)) claims.alias = crudo.alias;
  if (typeof crudo.monto === 'number' && Number.isFinite(crudo.monto) && crudo.monto > 0) claims.monto = crudo.monto;
  return claims;
}

const FORMA_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

async function verificarQr(payloadCrudo, bancosConocidos) {
  const texto = String(payloadCrudo || '').trim();
  if (!texto) return { tipo: 'error' };

  if (FORMA_JWT.test(texto)) {
    const { decodeJwt, decodeProtectedHeader, jwtVerify, importJWK } = await jose();
    let claimsCrudos;
    try {
      decodeProtectedHeader(texto);
      claimsCrudos = decodeJwt(texto);
    } catch {
      return { tipo: 'error' };
    }

    const banco = bancosConocidos[claimsCrudos.iss];
    if (!banco) {
      const claims = normalizarClaims(claimsCrudos);
      return claims ? { tipo: 'no_verificado', claims } : { tipo: 'error' };
    }

    try {
      const clavePublica = await importJWK(banco.publicKeyJwk, 'ES256');
      const { payload } = await jwtVerify(texto, clavePublica, { algorithms: ['ES256'] });
      const claims = normalizarClaims(payload);
      if (!claims) return { tipo: 'rechazado', motivoInterno: 'claims inválidos' };
      return { tipo: 'verificado', claims, banco: { bankCode: Number(claimsCrudos.iss), nombre: banco.nombre } };
    } catch (e) {
      return { tipo: 'rechazado', motivoInterno: e.code || e.message };
    }
  }

  if (/^\d{22}$/.test(texto)) return { tipo: 'plano', claims: { cbu: texto } };

  if (texto.startsWith('{')) {
    try {
      const claims = normalizarClaims(JSON.parse(texto));
      if (claims) return { tipo: 'plano', claims };
    } catch { /* no era JSON válido */ }
  }

  return { tipo: 'error' };
}

module.exports = { obtenerBankCode, obtenerKid, obtenerClavePublicaJwk, firmarQr, verificarQr, verificarQrPropio };
