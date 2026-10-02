Necesito sumar a mi homebanking el "aviso de lectura" del QR interbancario que acordamos con los otros bancos de la cátedra (Monix y uno más). Ya tenemos andando el QR firmado con JWT (ES256, claims `iss` = bankCode, `cbu`, `alias`, `monto`, `moneda`, `iat`, `exp`), así que esto se suma encima sin romper nada de lo que ya funciona.

## Qué es

Cuando un banco lee un QR de otro banco, le manda un aviso al banco que lo emitió, para que ese banco le muestre a su usuario algo como "Juan P. escaneó tu QR". No mueve plata ni condiciona el pago: es sólo un aviso.

## Contrato (idéntico en los 3 bancos, no cambiar nombres)

Cada banco expone un endpoint público (sin login) que llamamos `avisoUrl`:

`POST <avisoUrl>` · `Content-Type: application/json`

```json
{ "qr": "<el JWT completo que se leyó, sin tocar>", "banco": <bankCode del banco que leyó, número>, "nombre": "Juan P." }
```

- `qr` (string, obligatorio): el JWT tal cual salió del QR.
- `banco` (number, obligatorio): el bankCode del banco que LEYÓ.
- `nombre` (string, opcional): nombre corto de quien leyó; usamos nombre + inicial del apellido ("Juan P."), máximo 40 caracteres.

Respuestas: `202 {"ok":true,"avisado":true}` si se aceptó (`avisado:false` si el QR es válido pero la cuenta ya no existe) · `400` si falta algo · `401` si `qr` no tiene nuestra firma o venció.

## Lo que tenés que implementar

### 1. Recibir avisos (rol emisor)

Un endpoint nuevo (en Supabase: una Edge Function desplegada con `verify_jwt: false`, porque los otros bancos no son usuarios de tu proyecto):

1. Responder CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: content-type`, `Access-Control-Allow-Methods: POST, OPTIONS`, y contestar el `OPTIONS` con 200. Los otros bancos pueden llamarlo desde el navegador.
2. Validar el body: `qr` string (rechazar más de 4096 caracteres), `banco` entero positivo, `nombre` opcional (trim, cortar a 40).
3. Verificar `qr` con TU PROPIA clave pública (`jwtVerify` de `jose`, `algorithms: ['ES256']`, `clockTolerance: 120`) y chequear que `iss` sea tu bankCode. Si falla: 401. No hace falta ninguna clave de otro banco.
4. Con el `cbu` de los claims, buscar la cuenta activa y su dueño (con service role / server-side).
5. Ignorar duplicados: si ya registraste un aviso del mismo QR (mismo `jti`, o mismo `qr` si no usás `jti`) y mismo `banco` en los últimos 30 segundos, responder 202 sin volver a avisar. La cámara suele leer el mismo código varias veces seguidas.
6. Guardar el aviso (por ejemplo una tabla `qr_lecturas` con `persona_id`, `cuenta_id`, `jti`, `banco_lector`, `nombre_lector`, `created_at`, con RLS para que cada usuario lea sólo las suyas) y avisarle al usuario en tiempo real. En Supabase: sumar la tabla a la publicación `supabase_realtime` y en la pantalla donde se muestra el QR suscribirse a `INSERT` con filtro por el usuario. Mostrar un toast tipo "Juan P. escaneó tu QR" (si `banco` no es el tuyo, sumar "desde <nombre del banco>").

### 2. Mandar avisos (rol lector)

1. Una tabla local `bankCode → { nombre, avisoUrl }` (se completa a mano, como hicimos con el resto).
2. Después de decodificar cualquier QR JWT (aunque no hayas verificado la firma de ese banco), buscar el `iss` en esa tabla. Si no tiene `avisoUrl`, no hacer nada.
3. Hacer el POST *fire-and-forget*: `fetch(avisoUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qr, banco: <tu bankCode>, nombre }), keepalive: true, signal: AbortSignal.timeout(4000) }).catch(() => {})`. Nunca esperar la respuesta para seguir con el pago ni mostrar errores al usuario.
4. Incluir también tu propio banco en la tabla: así, si un usuario tuyo escanea el QR de otro usuario tuyo, también le llega el aviso, por el mismo camino.

### 3. Recomendado: `jti` en tus QR

Al firmar tus QR, sumá el claim `jti` con un id único (`crypto.randomUUID()`, en `jose`: `.setJti(...)`). Así sabés qué QR exacto se leyó (por ejemplo, para mostrar el aviso sólo mientras ese QR está en pantalla). Es opcional: el aviso funciona sin él, y los otros bancos lo ignoran.

## Datos de los otros bancos

| Banco | bankCode | avisoUrl |
| --- | --- | --- |
| Monix | 3 | `https://jrsismsrdqvhwmegfslz.supabase.co/functions/v1/qr-lectura` |

Cuando tengas tu endpoint desplegado, mandá tu `bankCode`, el nombre del banco y tu `avisoUrl` a los otros dos equipos para que lo sumen a su tabla.

## Cómo probarlo

1. Con `curl`, un POST a tu endpoint con `{"qr":"aaa.bbb.ccc","banco":3}` tiene que devolver 401.
2. Un POST con un QR real tuyo recién generado tiene que devolver 202, y la pantalla del dueño del QR tiene que mostrar el aviso.
3. Mandar el mismo POST dos veces seguidas tiene que generar un solo aviso.
4. Escanear un QR de Monix desde tu app: le tiene que llegar el aviso al usuario de Monix (avisanos y lo confirmamos de nuestro lado).
5. Con tu endpoint apagado o con una URL inválida en la tabla, el pago con QR tiene que seguir funcionando igual.

## Por qué sin firma

Para no tener que intercambiar claves: el emisor sólo usa la suya. El `qr` firmado prueba que el QR existe y no venció. Lo único que no se puede verificar es quién leyó (`banco`/`nombre`): alguien podría mandar un aviso falso, pero no mueve plata, sólo muestra un mensaje. Si después queremos blindarlo, se agrega una firma del banco lector sin cambiar el resto.

---

## Cómo quedó implementado en tuo

- **`avisoUrl` real es una Edge Function de Supabase** (`https://bjpgdcgloinsjogpwwgm.supabase.co/functions/v1/qr-lectura`, código en `supabase/functions/qr-lectura/index.ts`), igual que en los otros bancos — pero es un **proxy delgado**: solo reenvía el POST tal cual a nuestro backend de Express y devuelve la misma respuesta, sin reimplementar nada en Deno. `supabase/config.toml` la marca `verify_jwt = false` (pública, los otros bancos no son usuarios de este proyecto de Supabase).
- **Toda la lógica real** (rol emisor): `POST /api/qr/aviso-lectura` en Express (`controllers/qrController.js` → `exports.avisoLectura`), que es a donde apunta la Edge Function (variable de entorno `BACKEND_AVISO_URL`). Verifica el QR con `verificarQrPropio()` (`utils/qrJwt.js`, clave pública propia, chequea `iss`), resuelve la cuenta con `Persona.getByCbu`, deduplica con `models/qrLecturaModel.js` (`Qr_Lecturas`, ventana de 30s) y dispara `notificarQrLeido` (`utils/notificaciones.js`) → queda como una notificación normal (tipo `qr_leido`) que el dashboard ya sabe mostrar. `OPTIONS` tiene un handler dedicado en `app.js` que devuelve 200 exacto (la Edge Function también responde el `OPTIONS` ella misma, sin reenviarlo).
  - **Regla de duplicados (corregida 2026-10-02, mismo bug que encontró Monix)**: con `jti`, duplicado = mismo `jti` + mismo `banco_lector` en los últimos 30s. Sin `jti`, duplicado = misma **cuenta** (el `cbu` del QR) + mismo `banco_lector` en los últimos 30s — nunca comparando `jti = NULL` en SQL, porque eso no matchea nunca y deja pasar duplicados.
- **Rol lector** (avisa a otros bancos cuando escaneamos su QR): dentro de `exports.verificar` del mismo controller, se llama (fire-and-forget) a `avisarLecturaAlEmisor()`, que decodifica el `iss` del JWT escaneado sin verificar su firma, busca `bankCode → avisoUrl` en `config/bancosAviso.js` y hace el POST. Si el `iss` es el bankCode propio (un QR de otro usuario de tuo), se procesa todo en el mismo proceso sin ir por HTTP.
- **`jti`**: agregado a `firmarQr()` con `.setJti(crypto.randomUUID())`.
- **Tabla de bancos**: `config/bancosAviso.js` — separada de `config/bancosConocidosQr.js` (esa es para claves públicas; esta es solo `avisoUrl`, no hace falta ninguna clave de otro banco).
- **Nuestro propio `avisoUrl`** para pasarle a los otros equipos: `https://bjpgdcgloinsjogpwwgm.supabase.co/functions/v1/qr-lectura`. Funciona independientemente de `MAINTENANCE_MODE` en Vercel para el `OPTIONS` (lo contesta la propia Edge Function), pero el POST real sigue dependiendo de que `/api/qr/aviso-lectura` esté arriba — si el sitio está en mantenimiento, el proxy devuelve 502 (ver `fixes_checklist.md`).
- Verificado de punta a punta contra la base real (QR firmado → aviso → notificación con "desde Monix" → dedupe al repetir → limpieza de los datos de prueba), y también el camino "me escaneo a mí mismo" vía `/api/qr/verificar`.
