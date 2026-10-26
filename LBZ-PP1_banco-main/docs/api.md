# API

Base URL local: `http://localhost:3001`. Todas las rutas devuelven JSON salvo las que sirven páginas HTML.

**Autenticación**: las rutas marcadas 🔒 requieren la cookie de sesión `tuo_session` (httpOnly, se obtiene al loguearse). No se pasa ningún token en headers ni en el body — el navegador la manda solo en requests same-origin. Si falta o es inválida, responden `401 {"error":"No autenticado"}`. Ver [seguridad.md](seguridad.md).

Convención de errores: `4xx`/`5xx` con body `{"error": "mensaje en español"}`. Algunos devuelven un campo extra (`montoMaximo`, `estado`, etc.) junto al error.

---

## Personas y sesión

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/personas/registrar` | — | Da de alta la persona en el Banco Central (consigue el CBU), crea el usuario en Supabase Auth y la fila en `Personas`, manda el código de verificación por email. |
| POST | `/api/verificar-cuenta` | — | Confirma el código de 6 dígitos del registro. Bloquea tras 5 intentos fallidos. |
| POST | `/api/reenviar-codigo` | — | Reenvía el código de verificación de cuenta. |
| POST | `/api/personas/login` | — | Valida email/password (bcrypt) y devuelve la cookie de sesión. |
| POST | `/api/personas/logout` | — | Limpia la cookie de sesión. |
| GET | `/api/personas/:id/productos` | 🔒 | Devuelve los productos (cuentas, tarjetas, etc.) de la **sesión actual** — el `:id` de la URL se ignora a propósito. |
| GET | `/api/historial` | 🔒 | `?cbu=<uno o varios, separados por coma>`. Historial de movimientos de esos CBU, siempre acotado a la sesión. |
| GET | `/api/buscar-persona` | 🔒 | `?tipo=cbu\|alias&valor=...&moneda=ARS\|USD`. Busca una cuenta destino contra el Banco Central (más datos locales si están). |
| GET | `/api/otra-moneda-persona` | 🔒 | `?cbu=...&monedaActual=ARS\|USD`. Dice si ese mismo titular tiene también cuenta en la otra moneda. |
| POST | `/api/transferencia` | 🔒 | `{cbuOrigen, cbuDestino, importe, descripcion?}`. Transferencia real vía Banco Central + movimiento atómico local. Rechaza si `cbuOrigen` no es tuyo, si no alcanza el saldo, o si origen y destino son de monedas distintas. |
| PUT | `/api/actualizar-alias` | 🔒 | `{cbu, alias, moneda?}`. Solo sobre una cuenta propia. |
| POST | `/api/depositar` | 🔒 | `{cbu, importe}` (máx. $1.000.000). Acredita en el momento, solo en cuenta propia. |
| POST | `/api/solicitar-cambio-password` | — | `{email, passwordActual}`. Manda código de 6 dígitos si la contraseña actual es correcta. |
| PUT | `/api/confirmar-cambio-password` | — | `{email, token, nuevaPassword}` (mín. 8 caracteres). |
| GET | `/api/cotizacion-dolar` | — | Oficial/blue/MEP, vía dolarapi.com. |
| POST | `/api/cuenta-usd/solicitar-verificacion` | 🔒 | `{dni, telefono, email}` — deben coincidir con los datos ya registrados. Manda código. |
| POST | `/api/cuenta-usd` | 🔒 | `{email, token}`. Abre la caja de ahorro en USD. |
| POST | `/api/cambiar-divisa` | 🔒 | `{direccion:'compra'\|'venta', importeUsd}`. Compra/venta de USD a cotización MEP. |

## Préstamos

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/prestamos/tasas` | — | TNA/CFT de referencia (promedio BCRA vía api.argentinadatos.com). |
| GET | `/api/prestamos/perfil-crediticio` | 🔒 | Score 0-100 y `montoMaximo` disponible para pedir. |
| POST | `/api/prestamos/simular` | 🔒 | `{monto, plazoMeses}`. Devuelve cuota, CFT, total a pagar — no pide nada todavía. |
| POST | `/api/prestamos/solicitar` | 🔒 | `{monto, plazoMeses}`. Re-evalúa el perfil crediticio en el servidor, acredita el monto si aprueba. |
| GET | `/api/prestamos` | 🔒 | Lista todos los préstamos de la sesión (activos e históricos). |
| GET | `/api/prestamos/proxima-cuota` | 🔒 | La próxima cuota a vencer, para el banner del dashboard. |
| GET | `/api/prestamos/:id/cuotas` | 🔒 | Cronograma completo de un préstamo propio. |
| POST | `/api/prestamos/:id/pagar-cuota` | 🔒 | `{idCuota}` (camelCase). Paga una cuota puntual. |
| POST | `/api/prestamos/:id/cancelar` | 🔒 | Cancelación anticipada — cobra solo el capital pendiente, no las cuotas a valor nominal. |
| GET | `/api/cron/prestamos-diario` | `Authorization: Bearer <CRON_SECRET>` | Disparado por Vercel Cron: recordatorios de cuota + reporte a Central de Deudores. No lo llama el frontend. |

## Reservas (plazo fijo / frasco)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/reservas/tasas` | — | TNA de fija/semanal/frasco. |
| GET | `/api/reservas` | 🔒 | Lista las reservas propias; liquida/devenga intereses al leer (sin cron). |
| POST | `/api/reservas/simular` | 🔒 | `{tipo, monto, plazoDias?, plazoMeses?}`. |
| POST | `/api/reservas/abrir` | 🔒 | Abre una reserva nueva (mínimo $1.000). Debita de la cuenta ARS. |
| POST | `/api/reservas/:id/depositar` | 🔒 | Solo tipo `FRASCO`. `{monto}`. |
| POST | `/api/reservas/:id/retirar` | 🔒 | Solo tipo `FRASCO`. `{monto}`, rechaza si supera el saldo del frasco. |

## Tarjetas

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/tarjetas` | 🔒 | Tarjetas de débito/crédito propias. El número viene **enmascarado** y nunca incluye el CVV (ver seguridad.md). |
| GET | `/api/tarjetas/credito/tasas` | — | TNA/TEA/CFT de financiación. |
| POST | `/api/tarjetas/credito/simular` | — | `{monto, cuotas}`. |
| POST | `/api/tarjetas/emitir` | 🔒 | `{tipo:'DEBITO'\|'CREDITO'}`. Devuelve el número y CVV completos **solo esta vez**. |
| POST | `/api/tarjetas/credito/pagar` | 🔒 | `{monto}`. Paga el resumen desde la cuenta ARS. |
| POST | `/api/tarjetas/:tipo/comprar` | 🔒 | `{comercio, monto, cuotas?}` (crédito admite cuotas). |
| PUT | `/api/tarjetas/:tipo/bloqueo` | 🔒 | `{bloquear:true\|false}`. |
| GET | `/api/tarjetas/:tipo/movimientos` | 🔒 | Últimos 50 movimientos de esa tarjeta. |

## Notificaciones

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/notificaciones` | 🔒 | Listado completo. |
| GET | `/api/notificaciones/no-leidas` | 🔒 | Solo el contador, para el badge. |
| PUT | `/api/notificaciones/:id/leer` | 🔒 | Marca una como leída (ownership-scoped). |
| PUT | `/api/notificaciones/marcar-todas-leidas` | 🔒 | — |

## Asistente de IA

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/asistente/chat` | 🔒 | `{mensaje, historial}`. Chat con tool-use real (Gemini) acotado siempre a los datos de la sesión — tope de 30 mensajes/persona/día. |

## QR de cobro (propio e interbancario)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/banco/:code` | — | Nombre del banco dado su código, proxy al Banco Central. |
| POST | `/api/qr/firmar` | 🔒 | `{cbu, monto?}`. Devuelve un JWT (ES256) firmado con la clave del propio banco. |
| POST | `/api/qr/verificar` | 🔒 | `{qr}`. Verifica un QR firmado (propio o de otro banco), o lo toma como CBU plano si no es un JWT. |
| POST | `/api/qr/aviso-lectura` | — (público, lo llaman otros bancos) | Notifica al dueño de un QR que alguien lo escaneó. |
| GET | `/api/qr/estado` | — | `?jti=...`. Polling para saber si un QR propio ya fue usado. |

---

## Ejemplo real: login

```http
POST /api/personas/login
Content-Type: application/json

{"email": "usuario@ejemplo.com", "password": "contraseña123"}
```

Respuesta `200`:
```json
{
  "id": 1, "nombre": "...", "apellido": "...", "dni": "...",
  "email": "usuario@ejemplo.com", "telefono": "...", "direccion": "...",
  "cbu": "0120001012345678900123", "alias": "mi.alias.tuo",
  "saldo": "125400.00", "moneda": "ARS", "tipo_producto": "CAJA_AHORRO"
}
```
y el header `Set-Cookie: tuo_session=...; HttpOnly; Path=/; Max-Age=2592000`.

Respuesta `401` (password incorrecta o email inexistente — mismo mensaje en los dos casos, para no filtrar si un email existe):
```json
{"error": "Email o contraseña incorrectos"}
```

## Ejemplo real: transferencia

```http
POST /api/transferencia
Content-Type: application/json
Cookie: tuo_session=...

{"cbuOrigen": "0120...123", "cbuDestino": "0120...456", "importe": 5000, "descripcion": "Alquiler"}
```

Respuesta `201`:
```json
{"message": "Transacción aprobada", "transaccionId": "...", "estado": "aprobada", "nuevoSaldo": 120400}
```

Errores posibles: `400` (datos faltantes, auto-transferencia, monedas distintas), `403` (`cbuOrigen` no es tuyo), `404` (CBU destino no encontrado), `422` (saldo insuficiente, rechazada por el Banco Central).

*A confirmar: no hay una especificación OpenAPI/Swagger generada — esta tabla se armó leyendo cada controller a mano. Si se agrega un endpoint nuevo, hay que actualizar esta tabla manualmente.*
