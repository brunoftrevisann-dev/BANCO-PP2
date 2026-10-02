Necesito sumar a mi homebanking (Banco Tuo, bankCode 12) el "aviso de lectura" y el "QR de un solo uso" que acordamos con Monix (bankCode 3) para el QR interbancario. Ya tenemos andando el QR firmado con JWT (ES256, claims `iss` = bankCode, `cbu`, `alias`, `monto`, `moneda`, `iat`, `exp`) y transferencias entre bancos, así que esto se suma encima sin romper nada de lo que ya funciona. Mi backend es Supabase (proyecto `bjpgdcgloinsjogpwwgm`).

Revisá primero qué hay hecho de una versión anterior de este pedido (puede haber una tabla o código a medias) y completalo o corregilo para que quede exactamente como se describe acá. No cambies nombres de campos, códigos de respuesta ni la URL: los tres bancos tienen que comportarse igual.

## Qué es

- **Aviso de lectura:** cuando un banco lee un QR de otro banco, le manda un aviso al banco que lo emitió, y ese banco le muestra a su usuario "Juan P. escaneó tu QR".
- **QR de un solo uso (como un posnet):** apenas lo escanea la primera persona, el QR se cierra: desaparece de la pantalla de quien cobra, y si otra persona escanea la misma imagen, su banco no la deja pagar.

## Contrato (idéntico en los 3 bancos)

Cada banco expone un endpoint público (sin login), su `avisoUrl`:

`POST <avisoUrl>` · `Content-Type: application/json`

```json
{ "qr": "<el JWT completo que se leyó, sin tocar>", "banco": 12, "nombre": "Juan P." }
```

- `qr` (string, obligatorio): el JWT tal cual salió del QR.
- `banco` (number, obligatorio): el bankCode del banco que LEYÓ.
- `nombre` (string, opcional): nombre corto de quien leyó: nombre + inicial del apellido ("Juan P."), máximo 40 caracteres.

Respuestas:

- `202 {"ok":true,"avisado":true}`: aviso aceptado (también si es una lectura repetida del mismo lector).
- `202 {"ok":true,"avisado":false}`: el QR es válido pero la cuenta ya no está activa.
- `409 {"ok":false,"usado":true,"error":"Este QR ya fue escaneado"}`: el QR ya lo escaneó otra persona.
- `400`: falta `qr` o `banco` no es un entero positivo.
- `401`: `qr` no tiene mi firma, no es mío (`iss` distinto) o venció.

## 1. Mis QR: firma con `jti` y clave privada en un secret

1. Al firmar mis QR, sumar el claim `jti` con un id único: en `jose`, `.setJti(crypto.randomUUID())`. Sin `jti` el QR no se puede cerrar.
2. La clave privada con la que firmo NO puede estar en el frontend ni en el código del repo. Tiene que vivir sólo en un secret de Supabase:
   - Dashboard → Edge Functions → Secrets → nuevo secret `QR_JWT_PRIVATE_KEY`, con la clave en formato JWK, JSON de una sola línea: `{"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."}` (con CLI: `supabase secrets set QR_JWT_PRIVATE_KEY='{...}'`).
   - La función que firma la lee con `Deno.env.get('QR_JWT_PRIVATE_KEY')` e `importJWK(JSON.parse(...), 'ES256')`. Si hoy la clave está embebida en algún lado, sacala de ahí una vez que el secret esté cargado.
   - La que se comparte con los otros bancos es sólo la parte pública (`kty`, `crv`, `x`, `y`, sin `d`).
3. Probar que mis QR siguen saliendo firmados y ahora traen `jti`.

## 2. Recibir avisos (Edge Function `qr-lectura`)

Crear y DESPLEGAR una Edge Function llamada exactamente `qr-lectura`, así mi `avisoUrl` queda `https://bjpgdcgloinsjogpwwgm.supabase.co/functions/v1/qr-lectura` (hoy esa URL da 404 "Requested function was not found": la función no existe).

- Desplegar con verificación de JWT **desactivada**: `supabase functions deploy qr-lectura --no-verify-jwt`, o en el Dashboard apagar "Enforce JWT verification". Si queda activada, Supabase rechaza los avisos de Monix con 401 antes de llegar a mi código, porque Monix no es usuario de mi proyecto.
- Esta función NO necesita la clave privada: verifica con mi clave PÚBLICA, que no es secreta, y puede ir en el código. Para escribir en la base usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, que Supabase ya inyecta en todas las Edge Functions.

Lógica:

1. CORS: responder `OPTIONS` con 200 y en todas las respuestas `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`.
2. Validar el body: `qr` string de hasta 4096 caracteres, `banco` entero positivo, `nombre` opcional (trim, cortar a 40). Si falla: 400.
3. Verificar `qr` con mi clave pública: `jwtVerify(qr, key, { algorithms: ['ES256'], clockTolerance: 120 })` y que `iss` sea 12. Si falla: 401.
4. Buscar mi cuenta activa por el `cbu` de los claims. Si no está: 202 `avisado:false`.
5. Si el QR tiene `jti` (cierre):
   - Buscar la PRIMERA lectura guardada con ese `jti`.
   - No hay ninguna → guardarla, notificar al usuario y responder 202.
   - Hay una del mismo lector (mismo `banco` Y mismo `nombre`) → 202, sin guardar ni notificar de nuevo (la cámara lee varias veces).
   - Hay una de otro lector → 409.
   - Si el insert falla por el índice único de `jti` (código `23505`: dos personas escanearon a la vez), volver a buscar la primera lectura y responder 202 si es del mismo lector o 409 si no.
6. Si el QR NO tiene `jti` (QR viejos): no hay cierre; sólo ignorar avisos de la misma cuenta y el mismo `banco` dentro de los últimos 30 segundos, y si no, guardar y notificar.

Tabla de referencia (es la de Monix; adaptá las referencias a tus tablas de personas y cuentas):

```sql
create table if not exists public.qr_lecturas (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  jti text,
  cid uuid,
  banco_lector integer not null,
  nombre_lector text,
  created_at timestamptz not null default now()
);
create index if not exists qr_lecturas_persona_idx on public.qr_lecturas (persona_id, created_at desc);
create unique index if not exists qr_lecturas_jti_unico on public.qr_lecturas (jti) where jti is not null;
alter table public.qr_lecturas enable row level security;
create policy "qr_lecturas: ver las propias" on public.qr_lecturas
  for select to authenticated using (persona_id = (select auth.uid()));
revoke insert, update, delete on public.qr_lecturas from anon, authenticated;
alter publication supabase_realtime add table public.qr_lecturas;
```

## 3. Pantalla del QR: cerrar al escanear

En la pantalla donde el usuario muestra su QR:

1. Suscribirse por Realtime a `INSERT` en `qr_lecturas` filtrando por el usuario logueado (`persona_id=eq.<id>`).
2. Al llegar una lectura: mostrar un toast "Juan P. escaneó tu QR" (si `banco_lector` no es 12, agregar "desde Monix" u el nombre del banco).
3. Si el `jti` de la lectura es el del QR que está en pantalla (decodificar el JWT mostrado para sacar su `jti`): ocultar el QR, mostrar "Juan P. escaneó tu QR" y, si tenía monto, "Esperando el pago de $X…". Agregar un botón "Generar nuevo QR" que pida una firma nueva (`jti` nuevo).

## 4. Escanear QR de otros bancos: esperar la respuesta

1. Tabla local `bankCode → { nombre, avisoUrl }` con:
   - Monix: bankCode 3, `https://jrsismsrdqvhwmegfslz.supabase.co/functions/v1/qr-lectura`
   - Banco Tuo (yo): bankCode 12, mi propia `avisoUrl` (así también se avisa cuando un usuario mío escanea el QR de otro usuario mío).
2. Después de decodificar un QR JWT (aunque no haya podido verificar la firma de ese banco), si su `iss` tiene `avisoUrl`, hacer el POST y ESPERAR la respuesta como máximo 3 segundos:
   `fetch(avisoUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qr, banco: 12, nombre }), signal: AbortSignal.timeout(3000) })`
3. Si responde **409**: NO dejar pagar y mostrar "Este QR ya fue escaneado por otra persona. Pedí que te muestren uno nuevo."
4. Si responde 202, cualquier otro error, timeout, o el banco no tiene `avisoUrl`: seguir con el pago normal. Un banco caído nunca tiene que trabar un pago.

## 5. Cómo probarlo

1. `curl -X POST <mi avisoUrl> -H 'Content-Type: application/json' -d '{"qr":"aaa.bbb.ccc","banco":3}'` → 401 (si da 404, la función no está desplegada o tiene otro nombre).
2. `curl -X OPTIONS <mi avisoUrl> -H 'Origin: https://monix-homebanking.vercel.app' -H 'Access-Control-Request-Method: POST' -i` → 200 con `Access-Control-Allow-Origin: *`.
3. Con un QR mío recién generado: POST con `{"qr":<QR>,"banco":3,"nombre":"Ana B."}` → 202 y la pantalla del dueño se cierra; el mismo POST otra vez → 202 y no se duplica; el mismo QR con `"nombre":"Otro X."` → 409.
4. Escanear un QR de Monix desde mi app: al usuario de Monix se le tiene que cerrar el QR con mi nombre. Si un segundo usuario mío escanea la misma imagen: "ya fue escaneado".
5. Con la `avisoUrl` de Monix rota (cambiarla a propósito), el pago con QR de Monix tiene que seguir funcionando.

## Por qué el aviso no lleva firma del banco lector

Para no tener que intercambiar claves: el emisor sólo usa la suya. El `qr` firmado prueba que el QR existe y no venció. Lo único que no se puede verificar es quién leyó (`banco`/`nombre`): alguien podría mandar un aviso falso, pero no mueve plata, sólo muestra un mensaje o cierra un QR (y el usuario genera otro).

---

## Cómo quedó implementado en tuo (v2 — con un solo uso + clave movida a Supabase)

**Diferencias deliberadas respecto al ejemplo de Monix, ya consultadas con el usuario:**
- `qr-lectura` sigue siendo un **proxy delgado** a Express (decisión de la v1, no cambia): verifica/dedupe/single-use viven en `controllers/qrController.js`, no en Deno. Evita duplicar esa lógica en dos lenguajes.
- El cierre del QR en pantalla (sección 3) se hace con **polling cada 2s** en vez de Supabase Realtime+RLS: la app usa login propio (no Supabase Auth), así que no hay `auth.uid()` que mapee a nuestras personas — meter Realtime real exigiría exponer una ANON key de Supabase en el navegador por primera vez y diseñar RLS sin auth.uid(), mucha infraestructura nueva para 1-2 segundos de diferencia en la UX.
- La tabla `Qr_Lecturas` sigue con `id_persona INTEGER`/`cbu VARCHAR(22)` (nuestro esquema real), no con los `uuid` del ejemplo de Monix — el doc mismo invita a adaptar la tabla.

**Un solo uso:** `models/qrLecturaModel.js` → `intentarCerrarConJti()`, `INSERT ... ON CONFLICT (jti) WHERE jti IS NOT NULL DO NOTHING RETURNING *` contra un índice único parcial (`idx_qr_lecturas_jti_unico`, migración en `app.js`). Si inserta: primera lectura, notifica. Si no: compara `banco_lector`+`nombre_lector` contra la fila existente → mismo lector (202, repetido) u otro lector (**409**). `controllers/qrController.js` → `registrarYNotificarLectura()` centraliza esto para los dos roles (emisor público y el camino propio in-process).

**Clave privada movida a Supabase:** ya NO vive en `.env`/`.env.vercel`/Vercel (se quitó `QR_PRIVATE_KEY_B64`). Nueva Edge Function **`qr-firmar`** (`supabase/functions/qr-firmar/index.ts`) que lee el secret `QR_JWT_PRIVATE_KEY` (JWK con `d`) y firma — protegida con un secret interno propio (`QR_FIRMAR_INTERNAL_SECRET`, no es la clave de firma, solo autoriza a nuestro Express a pedir firmas; `verify_jwt=false` en `config.toml`, igual criterio que `qr-lectura`). `utils/qrJwt.js` → `firmarQr()` ahora le pide la firma a esta función por HTTP en vez de firmar local; `obtenerClavePublicaJwk()` devuelve una constante hardcodeada (la pública, no es secreta) en vez de derivarla de una privada que ya no tenemos. Mismo par de claves de siempre — nunca se compartió públicamente, no hay ruptura de compatibilidad.

**Rol lector espera la respuesta (hasta 3s):** `avisarLecturaAlEmisor()` pasó de fire-and-forget a `await` con timeout de 3000ms; si el banco emisor responde 409, `exports.verificar` responde también 409 `{tipo:'usado', error:'Este QR ya fue escaneado por otra persona. Pedí que te muestren uno nuevo.'}` — el frontend (`dashboard.html`, `procesarQrEscaneado`) ya mostraba `resultado.error` en cualquier `!res.ok`, así que el bloqueo funciona sin tocar esa función.

**Cierre en pantalla (polling):** nuevo endpoint `GET /api/qr/estado?jti=` (`exports.estado`). `dashboard.html` (QR de ARS) y `dolares.html` (QR de USD) decodifican el `jti` del JWT que están mostrando, hacen polling cada 2s mientras el modal está abierto, y si `usado:true` ocultan el QR y muestran "Fulano escaneó tu QR (desde <banco>)" + botón "Generar nuevo QR".

**Nuestro `avisoUrl` real** (sin cambios de URL): `https://bjpgdcgloinsjogpwwgm.supabase.co/functions/v1/qr-lectura`.

**Pendiente operativo del usuario** (no se puede hacer desde este entorno — sin CLI de Supabase logueada):
- `npx supabase secrets set QR_JWT_PRIVATE_KEY="$(cat <archivo local que te pasé>)"` y `QR_FIRMAR_INTERNAL_SECRET=<mismo valor que en .env/Vercel>`.
- `npx supabase functions deploy qr-firmar` (además de `qr-lectura`, si todavía no se deployó de la vez pasada).
- Borrar `QR_PRIVATE_KEY_B64` de Vercel, agregar `QR_FIRMAR_INTERNAL_SECRET`, Redeploy.

Verificado de punta a punta contra la base real: firma simulada + `verificarQrPropio()` la acepta; primera lectura con `jti` → 202 + notificación; misma lectora repite → 202 sin duplicar; otra lectora → 409; `GET /api/qr/estado` refleja el estado correcto antes/después; 401 con JWT basura; `OPTIONS` → 200; escaneo propio (in-process) también bloquea con 409 a un segundo lector. Datos de prueba limpiados después de cada corrida.
