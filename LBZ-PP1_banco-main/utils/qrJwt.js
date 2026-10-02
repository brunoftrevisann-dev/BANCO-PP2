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
    // jti identifica este QR puntual — lo usa el "aviso de lectura" para no avisar
    // dos veces la misma lectura (la cámara suele leer el mismo cuadro varias veces).
    .setJti(crypto.randomUUID())
    .sign(obtenerClavePrivada());
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
