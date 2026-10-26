let joseModulo = null;
async function jose() {
  if (!joseModulo) joseModulo = await import('jose');
  return joseModulo;
}

const obtenerBankCode = () => Number(process.env.BANK_CODE || 12);
const obtenerKid = () => process.env.QR_KID || 'tuo-1';

// La clave privada vive solo en un secret de Supabase (Edge Function qr-firmar); la pública puede estar acá.
const CLAVE_PUBLICA_JWK = {
  kty: 'EC', crv: 'P-256',
  x: 'FpUlRhsV90k-HnjgOjjHdmR_BQXAh9cgkNjDZn56YNs',
  y: 'IbFlt8whZYvoA0dIOla6Og0zOgKcrO3J7RR_uNoYm2o'
};

function obtenerClavePublicaJwk() {
  return CLAVE_PUBLICA_JWK;
}

// El secret compartido solo autoriza a este backend a pedir firmas; no es la clave de firma.
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

// Solo prueba que el QR es nuestro y no venció: la identidad del banco lector no se puede verificar.
async function verificarQrPropio(jwt) {
  const { jwtVerify, importJWK } = await jose();
  const clavePublica = await importJWK(obtenerClavePublicaJwk(), 'ES256');
  const { payload } = await jwtVerify(jwt, clavePublica, { algorithms: ['ES256'], clockTolerance: 120 });
  if (Number(payload.iss) !== obtenerBankCode()) throw new Error('iss no coincide con este banco');
  if (typeof payload.cbu !== 'string' || !/^\d{22}$/.test(payload.cbu)) throw new Error('cbu inválido en el QR');
  return { cbu: payload.cbu, jti: typeof payload.jti === 'string' ? payload.jti : null };
}

// Los claims ajenos precargan formularios: solo se devuelven los campos esperados, con su tipo.
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
