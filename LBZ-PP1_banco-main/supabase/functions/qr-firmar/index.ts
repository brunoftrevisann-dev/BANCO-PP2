// Edge Function PRIVADA (protegida con un secret interno propio, no con el verify_jwt de
// Supabase) que firma los QR de Banco Tuo — ver prompt-aviso-lectura-qr.md v2, sección 1.
//
// Es la única pieza del sistema que toca la clave privada de firma: vive solo en el secret
// de Supabase QR_JWT_PRIVATE_KEY (JWK, con "d"), nunca en Express/Vercel/el repo. El backend
// de Express (utils/qrJwt.js → firmarQr) le pide la firma a esta función por HTTP, mandando
// los claims ya resueltos (cbu/alias/moneda/monto) y un secret compartido (QR_FIRMAR_INTERNAL_SECRET)
// que demuestra que el pedido viene de nuestro propio backend y no de cualquiera en internet
// — esta función NO verifica cuentas ni nada más, solo firma lo que le llega, así que si
// estuviera abierta al público cualquiera podría pedir un QR firmado con cualquier CBU.
//
// Variables de entorno requeridas (Project Settings → Edge Functions → Secrets):
//   QR_JWT_PRIVATE_KEY        = JWK privado completo, JSON de una línea (con "d")
//   QR_FIRMAR_INTERNAL_SECRET = secreto compartido con Express (mismo valor en ambos lados)

import { SignJWT, importJWK } from 'npm:jose@5';

const BANK_CODE = 12;
const KID = 'tuo-1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'método no permitido' }, 405);

  const secretoEsperado = Deno.env.get('QR_FIRMAR_INTERNAL_SECRET');
  const auth = req.headers.get('authorization') || '';
  if (!secretoEsperado || auth !== `Bearer ${secretoEsperado}`) {
    return jsonResponse({ error: 'no autorizado' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'body inválido' }, 400);
  }

  const { cbu, alias, moneda, monto } = body || {};
  if (typeof cbu !== 'string' || !/^\d{22}$/.test(cbu)) {
    return jsonResponse({ error: 'cbu inválido' }, 400);
  }
  if (monto !== undefined && !(Number(monto) > 0)) {
    return jsonResponse({ error: 'monto inválido' }, 400);
  }

  const jwkTexto = Deno.env.get('QR_JWT_PRIVATE_KEY');
  if (!jwkTexto) return jsonResponse({ error: 'QR_JWT_PRIVATE_KEY no configurada' }, 500);

  try {
    const clavePrivada = await importJWK(JSON.parse(jwkTexto), 'ES256');
    const ahora = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { iss: BANK_CODE, cbu, moneda, iat: ahora, exp: ahora + 600 };
    if (typeof alias === 'string' && alias) claims.alias = alias;
    if (monto !== undefined) claims.monto = Number(monto);

    const jwt = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: KID })
      .setJti(crypto.randomUUID())
      .sign(clavePrivada);

    return jsonResponse({ jwt }, 200);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'error firmando' }, 500);
  }
});
