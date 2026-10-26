// Edge Function pública que recibe el aviso de lectura de otros bancos (prompt-aviso-lectura-qr.md).
// Es un proxy delgado a propósito: la lógica vive en qrController.avisoLectura.
//
// Secret requerido: BACKEND_AVISO_URL = https://banco-tuo.vercel.app/api/qr/aviso-lectura

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
    // No debería frenar el pago de quien nos avisa, pero el error se informa igual.
    return new Response(JSON.stringify({ error: 'no se pudo contactar el backend' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
