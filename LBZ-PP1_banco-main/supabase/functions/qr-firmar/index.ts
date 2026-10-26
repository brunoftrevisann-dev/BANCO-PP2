// Edge Function privada que firma los QR de Banco Tuo: es la única pieza que toca la clave privada.
// No verifica cuentas, solo firma lo que le llega; por eso exige el secret compartido con Express.
//
// Secrets requeridos (Project Settings → Edge Functions → Secrets):
//   QR_JWT_PRIVATE_KEY        = JWK privado completo, JSON de una línea (con "d")
//   QR_FIRMAR_INTERNAL_SECRET = mismo valor que en Express

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
