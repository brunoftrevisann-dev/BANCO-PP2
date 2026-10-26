# tuo — Banco Digital

**tuo** es un homebanking completo: cuenta bancaria con CBU real (vía la API de Banco Central de la cátedra), transferencias, tarjetas de débito y crédito, préstamos personales, plazo fijo/ahorro flexible, compra/venta de dólares, QR de cobro interbancario, notificaciones y un asistente de IA que responde sobre tu propia cuenta. Proyecto académico de Bruno y Sebastián.

Desplegado en: **banco-tuo.vercel.app**

## Tabla de contenidos

- [Tecnologías](#tecnologías)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Cómo ejecutarlo](#cómo-ejecutarlo)
- [Documentación completa](#documentación-completa)

## Tecnologías

| Capa | Tecnología |
|---|---|
| Backend | Node.js + Express 5 |
| Base de datos | PostgreSQL (Supabase), vía `pg`, sin ORM |
| Sesiones | JWT propio (`jose`) en cookie httpOnly |
| Contraseñas | `bcryptjs` |
| Autenticación de registro | Supabase Auth (solo para el alta, no para las sesiones) |
| Email | Nodemailer + Gmail SMTP |
| Asistente de IA | Google Gemini (`@google/genai`), con tool-use real |
| Banco Central | API externa de la cátedra |
| Cotización dólar / tasas | dolarapi.com, api.argentinadatos.com |
| Frontend | HTML5 + CSS3 + JavaScript vanilla, sin build ni framework |
| Hosting | Vercel (serverless) |

## Requisitos previos

- Node.js 18 o superior
- Una cuenta en Supabase (base PostgreSQL + Auth)
- Una cuenta de Gmail con [contraseña de aplicación](https://myaccount.google.com/apppasswords) habilitada
- El token de acceso a la API del Banco Central (lo da la cátedra)
- Una API key de Google Gemini (gratuita) si querés probar el asistente de IA

## Instalación

```bash
git clone <url-del-repo>
cd LBZ-PP1_banco-main
npm install
```

Crear el archivo `.env` en la raíz (ver sección siguiente), y correr `init/01_schema.sql` en el SQL editor de Supabase para crear las tablas base. El resto de las tablas (`Transacciones`, `Prestamos`, `Cuotas`, `Reservas`, `Tarjetas_*`, `Notificaciones`, etc.) se crean solas la primera vez que arranca el servidor — no hace falta correr nada más a mano.

## Variables de entorno

```env
# Base de datos (Supabase)
DATABASE_URL=postgresql://postgres.<proyecto>:<password>@<host>:6543/postgres
PORT=3001

# Sesiones (JWT)
JWT_SECRET=<string aleatorio largo>

# Banco Central (la da la cátedra)
BANCO_TOKEN=<token>
BANCO_URL=https://<host-del-banco-central>/api
BANCO_ENV=test
BANK_CODE=<código de banco asignado a "tuo">

# Supabase Auth (solo para el alta de usuarios)
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Email (Gmail con contraseña de aplicación, no la contraseña normal)
GMAIL_USER=<email@gmail.com>
GMAIL_PASS=<contraseña de aplicación de 16 caracteres>

# Asistente de IA
GEMINI_API_KEY=<api-key-de-gemini>

# Cron diario de préstamos (lo llama Vercel Cron)
CRON_SECRET=<string aleatorio>

# QR interbancario firmado
QR_KID=tuo-1
QR_FIRMAR_INTERNAL_SECRET=<string aleatorio>
```

> **Nunca commitear `.env`.** Ya está en `.gitignore`. Si alguna vez quedó commiteado por error en el historial de git, hay que rotar esos valores — ver [docs/seguridad.md](docs/seguridad.md).
>
> `MAINTENANCE_MODE=true` (opcional) muestra una pantalla de mantenimiento a todo el que no sea el cron.

## Cómo ejecutarlo

```bash
npm start      # producción
npm run dev    # desarrollo, con recarga automática (node --watch)
```

El servidor levanta en `http://localhost:3001`.

## Documentación completa

Esta documentación vive en [`docs/`](docs/):

- [**Arquitectura**](docs/arquitectura.md) — capas del sistema, estructura de carpetas, diagrama de secuencia de una request real.
- [**Funcionalidades**](docs/funcionalidades.md) — qué hace cada feature (registro, transferencias, préstamos, reservas, tarjetas, QR, IA), paso a paso.
- [**Modelo de datos**](docs/modelo-de-datos.md) — todas las tablas, sus relaciones, y el diagrama entidad-relación.
- [**Seguridad**](docs/seguridad.md) — cómo se maneja la sesión y las contraseñas, qué validaciones hay, y qué puntos débiles siguen pendientes.
- [**API**](docs/api.md) — cada endpoint, con método, parámetros y ejemplos reales.
- [**Manual de usuario**](docs/manual-de-usuario.md) — guía sin tecnicismos, para alguien que solo quiere usar el banco.
