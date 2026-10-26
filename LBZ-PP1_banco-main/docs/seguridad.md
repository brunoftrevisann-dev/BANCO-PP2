# Seguridad

## Autenticación y sesiones

La sesión se maneja con un JWT propio (HS256, firmado con `jose`), guardado en una cookie **httpOnly** llamada `tuo_session` (ver [`utils/sesion.js`](../utils/sesion.js)):

- `firmarSesion(idPersona)` genera el token; `setCookieSesion` la manda en una cookie con `httpOnly: true`, `maxAge` de 30 días, y `secure: true` solo cuando `NODE_ENV === 'production'` (en local, sin HTTPS, forzar `secure` siempre rompería el login).
- El middleware `requireAuth` lee la cookie, verifica la firma y pone `req.idPersona`. **Ningún controller confía en un `idPersona`/`cbu` que mande el cliente en el body o la query** — todos usan `req.idPersona` para decidir de quién son los datos.
- Logout (`POST /api/personas/logout`) borra la cookie del navegador. *A confirmar / limitación conocida: el JWT en sí no se invalida del lado del servidor (no hay blacklist) — un token copiado antes del logout sigue siendo válido hasta que expira, aunque la cookie ya no esté en el navegador.*

## Contraseñas

Hasheadas con `bcryptjs` (sin paso de compilación nativa, a diferencia de `bcrypt`). Las cuentas nuevas se hashean antes del `INSERT`. Las cuentas viejas (de antes de este esquema) migran solas: `compararYMigrarPassword()` en [`models/personaModel.js`](../models/personaModel.js) compara contra texto plano si todavía no es un hash `$2...`, y si coincide la rehashea en el momento — sin forzar un reset masivo a nadie.

La contraseña que se manda a la Admin API de Supabase Auth (sistema separado, no usado para las sesiones de tuo) sigue en texto plano ahí a propósito — Supabase la hashea de su lado.

## Rate limiting

Los códigos de verificación de 6 dígitos (verificación de cuenta y reset de contraseña, ambos usan las mismas columnas en `Personas`: `token_verificacion`, `token_expira`, `intentos_verificacion`) se bloquean después de **5 intentos fallidos**, incluso si el 6to intento trae el código correcto — hay que pedir uno nuevo para resetear el contador.

## Ownership checks (quién puede operar sobre qué)

Toda operación que recibe un `cbu`/`id` de un recurso ajeno lo valida contra `req.idPersona` antes de tocar nada:

- Transferir, depositar, actualizar alias: rechazan con `403` si la cuenta de origen no pertenece a la sesión.
- Preparar/cancelar préstamos, reservas, tarjetas: todas las queries filtran por `pr.id_persona = req.idPersona`, nunca por un id de producto que mande el cliente.
- Notificaciones: marcar como leída es ownership-scoped (devuelve `404`, no `403`, para no confirmar que la notificación existe).

## Validación cruzada de moneda en transferencias

`POST /api/transferencia` rechaza con `400` si la cuenta de origen y la de destino (cuando el destino es una cuenta propia de tuo) están en monedas distintas — antes esto se podía usar para acreditar, por ejemplo, 100 pesos como 100 dólares sin ninguna conversión real.

## Datos de tarjetas (CVV y número completo)

`GET /api/tarjetas` nunca devuelve el CVV y enmascara el número de tarjeta a los últimos 4 dígitos. El número y CVV completos solo se devuelven **una vez**, en la respuesta de `POST /api/tarjetas/emitir` — igual que una tarjeta física, que se puede leer entera solo cuando llega. Antes de este cambio, cada carga de la pantalla de Tarjetas devolvía el PAN y el CVV completos.

## Condición de carrera al emitir tarjeta

Emitir una tarjeta (débito o crédito) toma un `pg_advisory_xact_lock` por persona antes de chequear "¿ya tiene una?" — sin esto, dos clicks simultáneos podían crear dos tarjetas activas con el límite duplicado.

## XSS

Todo dato que viene del servidor o de otro usuario (nombre de contraparte, alias, descripción de una transferencia, nombre de quien lee un QR) pasa por `window.escapeHtml()` ([`public/tuo-i18n.js`](../public/tuo-i18n.js)) antes de insertarse en el DOM — nunca se usa `innerHTML` directo con ese tipo de datos.

## Inyección SQL

Todas las queries usan parámetros (`$1, $2, ...`), nunca interpolación de strings con datos del usuario. Las pocas interpolaciones de nombre de tabla que existen (ej. `Tarjetas_${tipo}` según si es débito o crédito) están siempre detrás de una validación por whitelist del valor (`tipoValido()`), no de lo que mande el cliente directamente.

## Dinero: operaciones atómicas

Todo movimiento de saldo usa `UPDATE ... SET saldo = saldo + $1 ... RETURNING saldo` directo en SQL ([`utils/moverSaldo.js`](../utils/moverSaldo.js)), nunca "leer el saldo en JS, calcular, pisar" — evita tanto errores de redondeo de punto flotante como condiciones de carrera entre dos operaciones simultáneas sobre la misma cuenta. Las operaciones que tocan dos cuentas a la vez (transferir, cambiar divisa) además usan `SELECT ... FOR UPDATE` dentro de una transacción para lockear ambas filas antes de mover nada.

## Puntos débiles conocidos (pendientes, no resueltos todavía)

- **Secretos históricamente expuestos**: el archivo `.env` se commiteó por error en un punto temprano del historial de git y luego se borró — pero el historial lo sigue teniendo. Esto expone (si alguien revisa el historial completo del repo): `JWT_SECRET`, la contraseña de la base (`DATABASE_URL`), `GMAIL_PASS` y `BANCO_TOKEN`. **Rotar estos 4 valores es la tarea de seguridad pendiente de mayor prioridad** — mientras `JWT_SECRET` no se rote en el entorno de producción, alguien con ese valor podría falsificar la cookie de sesión de cualquier usuario.
- **El JWT de sesión no se invalida en logout**, solo se borra la cookie del lado del cliente (ver arriba).
- **Si un registro falla después de dar de alta la persona en el Banco Central pero antes de guardarla en la base local**, ese DNI queda "atascado" — no hay ningún endpoint para borrar una persona ya creada en el Banco Central, hay que pedirle al profesor que lo haga manualmente.
- *A confirmar: no se corrió un escaneo de dependencias (`npm audit`) como parte de esta documentación — puede haber vulnerabilidades conocidas en paquetes de terceros sin revisar.*
