# tuo — Banco Digital

Aplicación bancaria digital full-stack con frontend web, backend Node.js/Express, base de datos PostgreSQL en Supabase e integración con una API de Banco Central externa.

---

## Tabla de contenidos

- [Descripción general](#descripción-general)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación y configuración](#instalación-y-configuración)
- [Variables de entorno](#variables-de-entorno)
- [Base de datos](#base-de-datos)
- [API REST](#api-rest)
- [Frontend — Páginas](#frontend--páginas)
- [Sistema de internacionalización i18n](#sistema-de-internacionalización-i18n)
- [Sistema de temas y accesibilidad](#sistema-de-temas-y-accesibilidad)
- [Flujos principales](#flujos-principales)
- [Bugs corregidos](#bugs-corregidos)
- [Notas de seguridad](#notas-de-seguridad)
- [Despliegue en Vercel](#despliegue-en-vercel)
- [Datos de conexión al Banco Central](#datos-de-conexión-al-banco-central)

---

## Descripción general

**tuo** es una billetera digital / banco online que permite:

- Registrar usuarios con cuenta bancaria (CBU + alias) via Banco Central
- Iniciar sesión con verificación de email (código OTP de 6 dígitos)
- Transferir dinero a otros usuarios por CBU o alias
- Depositar fondos en efectivo
- Ver historial de transacciones con filtros
- Exportar comprobantes y estado de cuenta en PDF
- Cambiar contraseña con confirmación por email
- Actualizar alias bancario
- Ver estadísticas de movimientos
- Consultar productos y seguridad del banco
- Internacionalización completa ES/EN
- Tema claro/oscuro/automático
- Escalado de texto (S/M/L/XL)
- Vibración háptica (dispositivos móviles)

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express 5 |
| Base de datos | PostgreSQL via Supabase (pg pool) |
| Autenticación | Supabase Auth + tokens OTP propios |
| Email | Nodemailer + Gmail SMTP |
| Banco Central | API externa (`centralbank.brocoly.cc`) |
| Frontend | HTML5 + CSS3 + JavaScript vanilla |
| PDF | jsPDF (CDN, cargado con `defer`) |
| Hosting | Vercel (Node.js serverless) |

---

## Arquitectura

```
Browser (HTML/CSS/JS)
        │
        │  HTTP requests
        ▼
Express Server (app.js)
        │
        ├── controllers/personaController.js   ← lógica de negocio
        │           │
        │           ├── models/personaModel.js  ← queries SQL (pg)
        │           │           │
        │           │           └── config/db.js  ← PostgreSQL pool (Supabase)
        │           │
        │           ├── utils/mailer.js          ← emails via Gmail SMTP
        │           │
        │           └── fetch() → Banco Central API  ← transacciones, personas
        │
        └── controllers/tablaController.js  ← CRUD genérico de tablas
```

Las páginas HTML se sirven como archivos estáticos desde `/public`. Toda la lógica del cliente es JavaScript vanilla sin frameworks.

---

## Estructura del proyecto

```
LBZ-PP1_banco-main/
├── app.js                        # Entry point Express — rutas y middleware
├── package.json
├── vercel.json                   # Configuración de despliegue Vercel
├── .env                          # Variables de entorno (NO commitear)
├── .gitignore
│
├── config/
│   └── db.js                     # Pool de conexión PostgreSQL
│
├── controllers/
│   ├── personaController.js      # Toda la lógica de negocio
│   └── tablaController.js        # CRUD genérico para tablas
│
├── models/
│   ├── personaModel.js           # Queries SQL — personas, cuentas, transacciones
│   └── tablaModel.js             # Modelo genérico por tabla
│
├── utils/
│   └── mailer.js                 # Envío de emails (verificación, cambio password)
│
├── init/
│   ├── 01_schema.sql             # DDL — creación de tablas
│   ├── 02_data.sql               # Datos de ejemplo
│   └── 03_select.sql             # Consultas de muestra
│
├── files/
│   ├── DER.png                   # Diagrama entidad-relación
│   ├── docker-compose.yml        # Compose para desarrollo local con Docker
│   └── postman.collection.json   # Colección Postman con todos los endpoints
│
└── public/                       # Archivos estáticos del frontend
    ├── tuo-i18n.js               # Motor de traducciones ES/EN + fuente + vibración
    ├── landing.html              # Página de inicio
    ├── login.html                # Inicio de sesión
    ├── registro.html             # Registro de nuevo usuario
    ├── dashboard.html            # Panel principal del usuario
    ├── perfil.html               # Perfil y datos personales
    ├── depositar.html            # Depósito de dinero
    ├── contactos.html            # Lista de contactos/favoritos
    ├── estadisticas.html         # Estadísticas de movimientos
    ├── productos.html            # Información de productos bancarios
    ├── seguridad.html            # Información de seguridad del banco
    └── settings.html             # Configuración de la app
```

---

## Instalación y configuración

### Requisitos

- Node.js 18+
- Cuenta en Supabase (base de datos PostgreSQL)
- Cuenta de Gmail con App Password habilitado
- Acceso a la API del Banco Central (`centralbank.brocoly.cc`)

### Pasos

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd LBZ-PP1_banco-main

# 2. Instalar dependencias
npm install

# 3. Crear archivo .env (ver sección Variables de entorno)
# Editar .env con tus credenciales

# 4. Inicializar la base de datos (ejecutar en Supabase SQL editor)
# Correr init/01_schema.sql
# Correr init/02_data.sql (opcional, datos de ejemplo)

# 5. Iniciar el servidor
npm start          # producción
npm run dev        # desarrollo con hot-reload (node --watch)
```

El servidor levanta en `http://localhost:3001` por defecto.

Las tablas `Transacciones` y las columnas de verificación se crean automáticamente al arrancar si no existen.

---

## Variables de entorno

Crear un archivo `.env` en la raíz del proyecto:

```env
# Base de datos PostgreSQL (Supabase)
DATABASE_URL=postgresql://postgres.<proyecto>:<password>@<host>:6543/postgres

# Puerto del servidor Express
PORT=3001

# JWT (reservado para uso futuro)
JWT_SECRET=<string-aleatorio-largo>

# API del Banco Central
BANCO_TOKEN=<token-de-acceso>
BANCO_URL=https://centralbank.brocoly.cc/api
BANCO_ENV=test

# Supabase
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Gmail SMTP (usar App Password, no la contraseña normal)
GMAIL_USER=<email@gmail.com>
GMAIL_PASS=<app-password-de-16-caracteres>

# URL pública de la app (para links en emails)
APP_URL=http://localhost:3001
```

> **Importante:** Nunca commitear el archivo `.env`. Está incluido en `.gitignore`.

---

## Base de datos

### Diagrama entidad-relación

Ver `files/DER.png`. También podés importar `init/01_schema.sql` en [drawdb.app](https://drawdb.app) para visualizarlo.

### Relaciones clave

```
Personas ──< Roles_x_Personas >── Roles
Personas ──< Productos
Productos >── Tipos_Producto
Productos >── Estados_Producto
Productos ──o Cuentas_Bancarias   (1:1)
Productos ──o Tarjetas_Credito    (1:1)
Transacciones  (tabla independiente, sync con BC API)
```

### Tablas principales

#### Personas
```
id                  SERIAL PK
nombre              VARCHAR(255) NOT NULL
apellido            VARCHAR(255) NOT NULL
dni                 VARCHAR(20)  UNIQUE NOT NULL
email               VARCHAR(255) UNIQUE
telefono            VARCHAR(50)
fecha_nac           DATE
direccion           VARCHAR(255)
password            VARCHAR(255)
verificado          BOOLEAN DEFAULT FALSE
token_verificacion  VARCHAR(6)
token_expira        TIMESTAMPTZ
```

#### Productos
```
id_producto         SERIAL PK
id_persona          INTEGER → Personas(id)
id_tipo_producto    INTEGER → Tipos_Producto(id_tipo_producto)
id_estado_producto  INTEGER → Estados_Producto(id_estado_producto)
fecha_alta          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

#### Cuentas_Bancarias
```
id_cuenta    SERIAL PK
id_producto  INTEGER UNIQUE → Productos(id_producto)
cbu          VARCHAR(22) UNIQUE NOT NULL
alias        VARCHAR(50) UNIQUE
moneda       VARCHAR(10) DEFAULT 'ARS'
saldo        DECIMAL(15,2) DEFAULT 0
```

#### Transacciones (creada en runtime)
```
id                SERIAL PK
tx_id             VARCHAR(100) UNIQUE NOT NULL
cbu_origen        VARCHAR(22) NOT NULL
cbu_destino       VARCHAR(22) NOT NULL
importe           DECIMAL(15,2) NOT NULL
estado            VARCHAR(20) NOT NULL
motivo_rechazo    TEXT
bank_code_origen  INTEGER
bank_code_destino INTEGER
persona_origen    JSONB
persona_destino   JSONB
descripcion       TEXT
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### Tarjetas_Credito
```
id_tarjeta         SERIAL PK
id_producto        INTEGER UNIQUE → Productos(id_producto)
numero_tarjeta     VARCHAR(16) UNIQUE NOT NULL
marca              VARCHAR(50)
fecha_vencimiento  DATE NOT NULL
limite_compra      DECIMAL(15,2) NOT NULL
dia_cierre         INTEGER (1-31)
```

### Tipos de producto

| id | nombre |
|----|--------|
| 1 | CAJA_AHORRO |
| 2 | CUENTA_CORRIENTE |
| 3 | TARJETA_CREDITO |

### Estados de producto

| id | nombre |
|----|--------|
| 1 | ACTIVO |
| 2 | BLOQUEADO |
| 3 | CERRADO |

### Datos de ejemplo

Ver `init/02_data.sql`. Incluye 3 usuarios de prueba:

| Persona | DNI | Producto | Saldo |
|---------|-----|----------|-------|
| Juan Pérez | 35123456 | CAJA_AHORRO | $15.000 ARS |
| María García | 28999888 | CUENTA_CORRIENTE | $450.000 ARS |
| Ricardo Fort | 20111222 | CAJA_AHORRO | $99.999,99 USD |
| Ricardo Fort | 20111222 | TARJETA_CREDITO | Límite $2.500.000 |

---

## API REST

Base URL: `http://localhost:3001`

### Personas y autenticación

| Método | Ruta | Descripción | Body requerido |
|--------|------|-------------|----------------|
| `GET` | `/api/personas` | Lista todas las personas con productos | — |
| `GET` | `/api/personas/:id/roles` | Roles de una persona | — |
| `GET` | `/api/personas/:id/productos` | Productos y cuentas de una persona | — |
| `POST` | `/api/personas` | Crear persona básica | `{nombre, apellido, dni, email}` |
| `POST` | `/api/personas/login` | Iniciar sesión | `{email, password}` |
| `POST` | `/api/personas/registrar` | Registro completo con cuenta bancaria | Ver abajo |

#### POST `/api/personas/login` — Response exitoso `200`
```json
{
  "id": 1,
  "nombre": "Juan",
  "apellido": "Pérez",
  "email": "juan@mail.com",
  "cbu": "0000000000000000000001",
  "alias": "perro.gato.casa",
  "saldo": 15000.00,
  "moneda": "ARS"
}
```

#### POST `/api/personas/registrar` — Body completo
```json
{
  "nombre": "string",
  "apellido": "string",
  "dni": "string",
  "email": "string",
  "telefono": "string",
  "fecha_nac": "YYYY-MM-DD",
  "domicilio": "string",
  "cbu": "string (22 dígitos, del BC)",
  "alias": "string (del BC)",
  "password": "string"
}
```

**Flujo interno:**
1. Crea persona en Supabase Auth
2. Inserta en `Personas`, `Productos`, `Cuentas_Bancarias` dentro de una transacción SQL
3. Genera token OTP de 6 dígitos (expira en 5 minutos)
4. Envía email de verificación

---

### Verificación de cuenta

| Método | Ruta | Descripción | Body |
|--------|------|-------------|------|
| `POST` | `/api/verificar-cuenta` | Verificar con código OTP | `{email, token}` |
| `POST` | `/api/reenviar-codigo` | Reenviar código de verificación | `{email}` |

---

### Operaciones bancarias

| Método | Ruta | Descripción | Parámetros |
|--------|------|-------------|-----------|
| `GET` | `/api/historial` | Historial de transacciones | Query: `?minutos=30` |
| `GET` | `/api/buscar-persona` | Buscar por CBU o alias | Query: `?tipo=cbu&valor=...` |
| `POST` | `/api/transferencia` | Realizar transferencia | `{cbuOrigen, cbuDestino, importe, descripcion?}` |
| `POST` | `/api/depositar` | Depositar dinero | `{cbu, importe}` |
| `PUT` | `/api/actualizar-alias` | Cambiar alias de cuenta | `{cbu, alias}` |
| `PUT` | `/api/sincronizar-saldo` | Actualizar saldo local | `{cbu, nuevoSaldo}` |

#### GET `/api/historial` — Comportamiento
- Sincroniza transacciones recientes desde BC API (máximo 1440 minutos / 24h de sync)
- Devuelve **todas** las transacciones de la DB local sin límite de tiempo
- El parámetro `minutos` solo afecta la cantidad de datos que se sincroniza desde BC

#### POST `/api/transferencia` — Flujo
1. Valida campos, saldo suficiente, que origen ≠ destino
2. Envía la transacción al Banco Central
3. Si es aprobada, descuenta saldo de origen y acredita en destino (si es cuenta interna)
4. Guarda la descripción/mensaje en `Transacciones`

#### POST `/api/depositar` — Validaciones
- Importe mínimo: `$1`
- Importe máximo: `$1.000.000`
- Genera una transacción con `cbu_origen = 'DEPOSITO'`

---

### Cambio de contraseña

| Método | Ruta | Descripción | Body |
|--------|------|-------------|------|
| `POST` | `/api/solicitar-cambio-password` | Solicitar cambio (verifica contraseña actual) | `{email, passwordActual}` |
| `PUT` | `/api/confirmar-cambio-password` | Confirmar con código OTP | `{email, token, nuevaPassword}` |

La nueva contraseña debe tener al menos 8 caracteres.

---

### Proxy y utilidades

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/banco/:code` | Info de banco por código (proxy a BC API, timeout 8s) |
| `POST` | `/api/proxy-banco-central` | Proxy a BC API `/persons` para crear persona en BC |
| `GET` | `/api/tablas/:tabla` | Datos crudos de tablas para inspección |

#### Tablas disponibles en `/api/tablas/:tabla`

`personas`, `roles`, `roles_x_personas`, `tipos_producto`, `estados_producto`, `productos`, `cuentas_bancarias`, `tarjetas_credito`

---

## Frontend — Páginas

### landing.html
- Página de inicio pública con hero animado y tarjeta bancaria
- Grilla de características (transferencias, seguridad, transparencia)
- Si el usuario está logueado, redirige automáticamente al dashboard
- Splash screen con animación de entrada

### login.html
- Login con email y contraseña
- Toggle de tema claro/oscuro
- Botón de acceso biométrico (UI decorativa)
- Al loguearse exitosamente: guarda geolocalización en `localStorage` para el historial de accesos (`tuo_activity_{cbu}`)
- Animaciones de transición de página

### registro.html
- Registro en **3 pasos**:
  1. **Datos personales**: nombre, apellido, DNI, email, teléfono, fecha de nacimiento, domicilio
  2. **Seguridad**: contraseña con medidor de fortaleza (Muy débil → Muy fuerte)
  3. **Verificación**: código de 6 dígitos con timer de 5 minutos y botón de reenvío
- Integración con Banco Central para crear la cuenta (obtiene CBU + alias)
- Validaciones en tiempo real en cada campo

### dashboard.html
- Balance de cuenta con opción de ocultar saldo
- Acciones rápidas: Transferir, Depositar, Pagar, Más
- Historial de transacciones recientes (últimas N)
- Modal de historial completo con filtros (enviadas/recibidas/todas, rango de fechas)
- Detalle de transacción con descarga de comprobante en PDF
- Exportar estado de cuenta completo en PDF
- Auto-logout con countdown cuando la sesión está por vencer
- Menú lateral con navegación a todas las secciones

### perfil.html
- Datos personales del usuario (nombre, DNI, email, teléfono)
- Cambio de alias bancario (sincroniza con BC API)
- Cambio de contraseña con verificación por email (flujo OTP de 2 pasos)
- Historial de accesos recientes (dispositivo, ubicación, IP, fecha)

### depositar.html
- Formulario para depositar un monto a la propia cuenta
- Validación: mínimo $1, máximo $1.000.000
- Actualiza el saldo en tiempo real tras el depósito

### contactos.html
- Lista de contactos/favoritos guardados
- Búsqueda por nombre o CBU
- Acceso rápido para transferir a un contacto

### estadisticas.html
- Gráficos de movimientos (ingresos vs egresos)
- Resumen por período

### productos.html
- Descripción de los productos bancarios disponibles
- Beneficios y condiciones de cada producto

### seguridad.html
- Información sobre las medidas de seguridad del banco
- Consejos para usuarios
- Texto traducible via `data-i18n-html` (preserva HTML interno)

### settings.html

Organizado en secciones:

| Sección | Opciones |
|---------|---------|
| **General** | Idioma (ES/EN), Tamaño de texto (S/M/L/XL), Vibración |
| **Apariencia** | Tema (Claro/Oscuro/Automático), horario para modo auto |
| **Seguridad** | Auto-logout (1/5/15/30 min o nunca) |
| **Sonidos** | Toggle de sonidos de la app |
| **Privacidad** | Toggle de ocultar saldo en dashboard |
| **Acerca de** | Versión, términos y condiciones |

---

## Sistema de internacionalización i18n

Archivo: `public/tuo-i18n.js`

Incluido en el `<head>` de **todas** las páginas:
```html
<script src="tuo-i18n.js"></script>
```

### Uso en HTML — atributos data

```html
<!-- Texto simple -->
<span data-i18n="nav.dashboard">Panel</span>

<!-- Placeholder de input -->
<input data-i18n-placeholder="login.email_placeholder">

<!-- Atributo title (tooltip) -->
<button data-i18n-title="common.close">×</button>

<!-- HTML completo (preserva etiquetas <span>, <br>, etc.) -->
<h1 data-i18n-html="security.page.hero_title_html"></h1>
```

### Uso en JavaScript

```javascript
// Traducción simple
window.t('login.enter')        // → "Entrar" (es) o "Sign in" (en)

// IMPORTANTE: en callbacks donde 't' es variable local, usar window.t()
// Ej: forEach(t => { ... }) o const t = _txMap[id]
label.textContent = window.t('dashboard.tx.amount');

// API completa
window.tuoI18n.getLang()         // → 'es' o 'en'
window.tuoI18n.applyI18n()       // re-aplica todas las traducciones al DOM
window.tuoI18n.applyFontSize()   // re-aplica el tamaño de fuente
```

### Cómo funciona internamente

1. `applyFontSize()` se ejecuta **inmediatamente** al cargar el script (antes de DOMContentLoaded) — evita flash de tamaño incorrecto
2. `applyI18n()` se ejecuta en `DOMContentLoaded` para traducir todos los elementos `[data-i18n]`
3. Al cambiar idioma desde Settings, se llama `applyI18n()` de nuevo sobre el DOM existente
4. Idioma persistido en `localStorage` con clave `tuo_lang`

### Fallback de traducciones

```
1. Busca en dict del idioma actual (es/en)
2. Si no existe → fallback al español
3. Si no existe en español → devuelve la key literal
```

### localStorage keys

| Clave | Valores | Descripción |
|-------|---------|-------------|
| `tuo_lang` | `es`, `en` | Idioma de la interfaz |
| `tuo_font_size` | `sm`, `md`, `lg`, `xl` | Tamaño de texto |
| `tuo_vibration` | `1` (default), `0` | Vibración habilitada |
| `tuo-theme` | `light`, `dark`, `auto` | Tema visual |
| `tuo_dark_hours` | `HH:MM-HH:MM` | Rango horario para tema auto |
| `tuo_sonidos` | `1` (default), `0` | Sonidos de la app |
| `tuo_auto_logout` | minutos como string | Tiempo de auto-logout |
| `tuo_ocultar_saldo` | `1`, `0` | Ocultar saldo en dashboard |

### Escalas de fuente

| Valor | `font-size` en `<html>` | Efecto |
|-------|------------------------|--------|
| `sm` | 88% | Texto más pequeño |
| `md` | 100% | Tamaño por defecto |
| `lg` | 112% | Texto más grande |
| `xl` | 125% | Accesibilidad |

> El escalado afecta todos los valores en `rem`. Elementos con `px` no escalan.

### Funciones de vibración

```javascript
window.tuoI18n.vibrateLight()    // [10]               — feedback sutil
window.tuoI18n.vibrateMedium()   // [15, 8, 15]        — acción normal
window.tuoI18n.vibrateSuccess()  // [10, 5, 10, 5, 30] — confirmación
window.tuoI18n.vibrateError()    // [50, 10, 50]        — error
```

Requieren `tuo_vibration !== '0'` y soporte de `navigator.vibrate` (Android Chrome principalmente).

---

## Sistema de temas y accesibilidad

- **Tema claro/oscuro**: CSS variables en `:root` y `[data-theme="dark"]`
- **Tema automático**: cambia según el rango horario configurado en Settings (`tuo_dark_hours`)
- **Font scaling**: modifica `document.documentElement.style.fontSize` con porcentaje, escala todos los valores `rem`
- **Splash screen**: animación de carga al entrar a cada página (class `.loaded` en `body`)

---

## Flujos principales

### Registro de nuevo usuario

```
registro.html (paso 1: datos personales)
    → POST /api/proxy-banco-central        — BC crea persona, devuelve CBU + alias
    → registro.html (paso 2: contraseña)
    → POST /api/personas/registrar         — DB local: Persona + Producto + Cuenta
    → Email OTP enviado (6 dígitos, 5 min)
    → registro.html (paso 3: código)
    → POST /api/verificar-cuenta
    → Redirige a login.html
```

### Login

```
login.html
    → POST /api/personas/login
    → Guarda usuarioLogueado en localStorage
    → Registra geolocalización en tuo_activity_{cbu}
    → Redirige a dashboard.html
```

### Transferencia

```
dashboard.html (modal de transferencia)
    → GET /api/buscar-persona?tipo=alias&valor=...   — busca destinatario
    → POST /api/transferencia {cbuOrigen, cbuDestino, importe, descripcion}
        → BC API valida y ejecuta
        → DB local: actualiza saldo origen y destino
        → Guarda descripción en Transacciones
    → Toast de confirmación + vibrateSuccess()
```

### Cambio de contraseña

```
perfil.html
    → POST /api/solicitar-cambio-password {email, passwordActual}
        → Verifica contraseña actual
        → Genera OTP, envía email
    → PUT /api/confirmar-cambio-password {email, token, nuevaPassword}
        → Verifica OTP no expirado
        → Actualiza password en DB
    → Toast de confirmación
```

### Exportar PDF de estado de cuenta

```
dashboard.html → botón "Exportar PDF"
    → Si _todasPropias está vacío:
        GET /api/historial?minutos=525600   — carga todo el historial
    → Aplica filtros activos
    → Genera PDF con window.jspdf (jsPDF)
    → Descarga automática como tuo-estado-cuenta.pdf
```

---

## Bugs corregidos

| Archivo | Descripción |
|---------|-------------|
| `app.js` | Rutas `solicitar-cambio-password` y `confirmar-cambio-password` registradas **dos veces** — la segunda nunca se ejecutaba (dead code) |
| `config/db.js` | `console.log` exponía la DATABASE_URL completa con credenciales en logs de producción |
| `dashboard.html` | `exportarPDF()` mostraba "Abrí el historial primero" si no se había abierto el modal — ahora hace auto-fetch a `/api/historial` |
| `dashboard.html` | Typos en modal auto-logout: "Sesion" → "Sesión", "cerrara" → "cerrará" |
| `dashboard.html` | `renderHistorialFiltrado()` y `cargarRecentTx()` tenían strings hardcodeados en español — ahora usan `window.t()` |
| `dashboard.html` | `abrirDetalleTx()` usaba `const t = _txMap[id]` que sombreaba `window.t` — resuelto usando `window.t()` explícitamente |
| `login.html` | `btnLogin.textContent = 'Entrar'` hardcodeado al restaurar botón tras error — ahora usa `window.t('login.enter')` |
| `perfil.html` | Template literals del historial de actividad tenían strings en español — ahora usan `window.t()` |
| `tuo-i18n.js` | Keys faltantes agregadas: `dashboard.historial.no_results`, `no_transactions`, `unavailable`, `dashboard.tx.*` (15+ claves) |

---

## Notas de seguridad

### Para tener en cuenta en producción

| Severidad | Descripción | Solución recomendada |
|-----------|-------------|---------------------|
| Critico | Contraseñas almacenadas en **texto plano** | Implementar `bcrypt` con salt rounds >= 12 |
| Critico | `PUT /api/sincronizar-saldo` sin autenticación | Agregar middleware JWT que verifique que el CBU corresponde al usuario logueado |
| Critico | `GET /api/personas` expone todos los usuarios sin auth | Restringir a rol administrador con JWT |
| Alto | CORS abierto a `origin: '*'` | Restringir a dominios específicos del proyecto |
| Alto | Sin rate limiting en `/api/personas/login` | Implementar `express-rate-limit` |
| Alto | Sin middleware de autenticación en rutas protegidas | Implementar JWT en todos los endpoints `/api/*` salvo login y registro |
| Medio | `config/db.js` tiene credenciales hardcodeadas como fallback | Usar solo `DATABASE_URL` de env |
| Medio | `GET /api/tablas/:tabla` expone datos crudos | Eliminar o restringir en producción |

> Este proyecto es un prototipo académico. Las notas anteriores son para una eventual puesta en producción real.

---

## Despliegue en Vercel

### vercel.json

```json
{
  "version": 2,
  "builds": [{ "src": "app.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/app.js" }]
}
```

Todas las rutas pasan por `app.js`. Los archivos estáticos de `/public` son servidos por Express (`express.static`).

### Variables de entorno en Vercel

Configurar todas las variables del `.env` en el panel de Vercel → Settings → Environment Variables.

### Notas de despliegue

- La base de datos usa Supabase cloud — no se requiere DB adicional en Vercel
- Las tablas se crean automáticamente al arrancar si no existen (`CREATE TABLE IF NOT EXISTS`)
- Las columnas extra se agregan via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en el startup
- `npm start` ejecuta `node app.js`

---

## Datos de conexión al Banco Central

```json
{
  "bankId": "69f0199b1d01e4cfa6941868",
  "bankCode": 12,
  "name": "TUO-PRUEBA",
  "environment": "test"
}
```

### Headers requeridos para la API del Banco Central

| Header | Valor |
|--------|-------|
| `x-environment` | `test` |
| `x-api-key` | (ver variable de entorno `BANCO_TOKEN`) |

### Endpoints utilizados del BC

| Método | Path | Uso |
|--------|------|-----|
| `POST` | `/persons` | Crear persona al registrarse |
| `GET` | `/persons/:cbu` | Buscar por CBU |
| `GET` | `/persons/alias/:alias` | Buscar por alias |
| `PUT` | `/persons/:cbu/alias` | Actualizar alias |
| `POST` | `/transactions` | Ejecutar transferencia |
| `GET` | `/transactions?minutos=N` | Obtener transacciones recientes |
| `GET` | `/banks/:code` | Info de banco por código |

Todos los llamados al BC tienen un timeout configurado (8-12 segundos). Si el BC no responde, el sistema continúa con datos locales.

---

## Colección Postman

Ver `files/postman.collection.json` para importar todos los endpoints listos para probar en Postman o Bruno.
