// Edge Function pública (sin login) que recibe el "aviso de lectura" del QR
// interbancario de otros bancos de la cátedra — ver prompt-aviso-lectura-qr.md.
//
// Es un PROXY DELGADO a propósito: toda la lógica real (verificar el QR con nuestra
// propia clave pública, buscar la cuenta, deduplicar en los últimos 30s, crear la
// notificación) ya está implementada y probada en el backend de Express
// (controllers/qrController.js → exports.avisoLectura), que corre contra la misma
// base de Postgres. Esta función existe solo para que `avisoUrl` sea una Edge
// Function de Supabase, igual que en los otros bancos — no duplica ni reimplementa
// nada de esa lógica en Deno.
//
// Variable de entorno requerida (Project Settings → Edge Functions → Secrets):
//   BACKEND_AVISO_URL = https://banco-tuo.vercel.app/api/qr/aviso-lectura

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'método no permitido' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const backendUrl = Deno.env.get('BACKEND_AVISO_URL');
  if (!backendUrl) {
    return new Response(JSON.stringify({ error: 'BACKEND_AVISO_URL no configurada' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let bodyTexto: string;
  try {
    bodyTexto = await req.text();
  } catch {
    return new Response(JSON.stringify({ error: 'body inválido' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyTexto,
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);
    const textoRespuesta = await resp.text();
    return new Response(textoRespuesta, {
      status: resp.status,
      headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('content-type') || 'application/json' },
    });
  } catch {
    // Backend caído, en mantenimiento, o timeout — esto nunca debería frenar un pago
    // del lado de quien nos avisa, pero sí le devolvemos un error honesto.
    return new Response(JSON.stringify({ error: 'no se pudo contactar el backend' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
