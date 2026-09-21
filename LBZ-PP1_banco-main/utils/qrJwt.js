const crypto = require('crypto');

let joseModulo = null;
async function jose() {
  if (!joseModulo) joseModulo = await import('jose');
  return joseModulo;
}

const obtenerBankCode = () => Number(process.env.BANK_CODE || 12);
const obtenerKid = () => process.env.QR_KID || 'tuo-1';

let clavePrivada = null;
function obtenerClavePrivada() {
  if (clavePrivada) return clavePrivada;
  const b64 = process.env.QR_PRIVATE_KEY_B64;
  if (!b64) throw new Error('QR_PRIVATE_KEY_B64 no está configurada');
  clavePrivada = crypto.createPrivateKey(Buffer.from(b64, 'base64').toString('utf8'));
  return clavePrivada;
}

function obtenerClavePublicaJwk() {
  return crypto.createPublicKey(obtenerClavePrivada()).export({ format: 'jwk' });
}

async function firmarQr({ cbu, alias, monto, moneda }) {
  const { SignJWT } = await jose();
  const ahora = Math.floor(Date.now() / 1000);
  // `iss` va en el payload y no con setIssuer(): la spec lo define como número y jose solo acepta string ahí.
  const claims = { iss: obtenerBankCode(), cbu, moneda, iat: ahora, exp: ahora + 600 };
  if (alias) claims.alias = alias;
  if (monto) claims.monto = monto;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: obtenerKid() })
    .sign(obtenerClavePrivada());
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

module.exports = { obtenerBankCode, obtenerKid, obtenerClavePublicaJwk, firmarQr, verificarQr };
