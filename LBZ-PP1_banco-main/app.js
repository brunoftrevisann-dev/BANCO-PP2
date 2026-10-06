require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const personaController = require('./controllers/personaController');
const prestamoController = require('./controllers/prestamoController');
const cronController = require('./controllers/cronController');
const asistenteController = require('./controllers/asistenteController');
const notificacionController = require('./controllers/notificacionController');
const qrController = require('./controllers/qrController');
const reservaController = require('./controllers/reservaController');
const tarjetaController = require('./controllers/tarjetaController');

// Interruptor de mantenimiento: con MAINTENANCE_MODE=true en las variables de entorno,
// la app le devuelve esta pantalla a cualquiera en vez de servir el banco. Pensado para
// Vercel Hobby, donde "Deployment Protection: All Deployments" es una función paga y
// "Standard Protection" no cubre el dominio de producción.
app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE !== 'true') return next();
    // Excepción: el cron diario de préstamos tiene que poder correr aunque el sitio
    // esté pausado. Solo pasa si además trae el secreto correcto (el propio handler
    // lo vuelve a chequear, así esto no queda como una puerta trasera pública).
    if (process.env.CRON_SECRET && req.path.startsWith('/api/cron/') && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`) {
        return next();
    }
    res.status(503).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>tuo — En mantenimiento</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111113;color:#F0F0F0;font-family:-apple-system,sans-serif;text-align:center;padding:24px;">
<div><div style="font-size:2rem;font-weight:800;letter-spacing:-0.05em;color:#3D7BFF;margin-bottom:16px;">tuo</div>
<h1 style="font-size:1.2rem;margin:0 0 8px;">Estamos en mantenimiento</h1>
<p style="color:#9C9C9F;font-size:0.9rem;margin:0;">Volvemos enseguida. Gracias por tu paciencia.</p></div></body></html>`);
});

// El preflight del aviso de lectura (prompt-aviso-lectura-qr.md) tiene que devolver 200
// exacto, igual que en los otros bancos de la cátedra — no el 204 que manda por defecto
// el middleware cors() de abajo para el resto de la app. Va antes para que lo intercepte
// primero.
app.options('/api/qr/aviso-lectura', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'content-type');
    res.sendStatus(200);
});

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'x-environment']
}));

app.use(express.json());

// Servir archivos estáticos desde public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Ruta específica para login.html
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta específica para registro.html
app.get('/registro', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

// Proxy hacia API del Banco Central (evita CORS)
app.post('/api/proxy-banco-central', async (req, res) => {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);
    const response = await fetch(`${process.env.BANCO_URL}/persons`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-environment': process.env.BANCO_ENV,
        'Content-Type': 'application/json',
        'x-api-key': process.env.BANCO_TOKEN
      },
      body: JSON.stringify(req.body)
    });
    clearTimeout(tid);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    const msg = error.name === 'AbortError' ? 'Timeout: la API externa tardó demasiado' : error.message;
    res.status(504).json({ error: msg });
  }
});

// Endpoints con joins
app.get('/api/personas', personaController.obtenerPersonas);
app.get('/api/personas/:id/roles', personaController.obtenerRoles);
app.get('/api/personas/:id/productos', personaController.obtenerProductos);
app.post('/api/personas/login', personaController.login);
app.post('/api/personas', personaController.crearPersona);
app.post('/api/personas/registrar', personaController.registrarPersona);
app.get('/api/historial', personaController.obtenerHistorial);
app.get('/api/buscar-persona', personaController.buscarPersona);
app.get('/api/otra-moneda-persona', personaController.otraMonedaPersona);
app.post('/api/transferencia', personaController.transferir);
app.put('/api/actualizar-alias', personaController.actualizarAlias);
app.put('/api/sincronizar-saldo', personaController.sincronizarSaldo);
app.post('/api/verificar-cuenta', personaController.verificarCuenta);
app.post('/api/reenviar-codigo', personaController.reenviarCodigo);
app.post('/api/depositar', personaController.depositar);
app.post('/api/solicitar-cambio-password', personaController.solicitarCambioPassword);
app.put('/api/confirmar-cambio-password', personaController.confirmarCambioPassword);
app.get('/api/cotizacion-dolar', personaController.cotizacionDolar);
app.post('/api/cuenta-usd/solicitar-verificacion', personaController.solicitarAperturaUsd);
app.post('/api/cuenta-usd', personaController.abrirCuentaUsd);
app.post('/api/cambiar-divisa', personaController.cambiarDivisa);

// Préstamos
app.get('/api/prestamos/tasas', prestamoController.obtenerTasas);
app.get('/api/prestamos/perfil-crediticio', prestamoController.perfilCrediticio);
app.post('/api/prestamos/simular', prestamoController.simular);
app.post('/api/prestamos/solicitar', prestamoController.solicitar);
app.get('/api/prestamos', prestamoController.listar);
app.get('/api/prestamos/proxima-cuota', prestamoController.proximaCuota);
app.get('/api/prestamos/:id/cuotas', prestamoController.cuotas);
app.post('/api/prestamos/:id/pagar-cuota', prestamoController.pagarCuota);
app.post('/api/prestamos/:id/cancelar', prestamoController.cancelarAnticipado);

// Cron diario (recordatorios de cuota + escalada a Central de Deudores)
app.get('/api/cron/prestamos-diario', cronController.diario);

// Asistente de IA (atención al cliente)
app.post('/api/asistente/chat', asistenteController.chat);

// Notificaciones
app.get('/api/notificaciones', notificacionController.listar);
app.get('/api/notificaciones/no-leidas', notificacionController.noLeidas);
app.put('/api/notificaciones/:id/leer', notificacionController.marcarLeida);
app.put('/api/notificaciones/marcar-todas-leidas', notificacionController.marcarTodasLeidas);

// Reservas (plazo fijo y frasco, estilo Naranja X)
app.get('/api/reservas/tasas', reservaController.tasas);
app.get('/api/reservas', reservaController.listar);
app.post('/api/reservas/simular', reservaController.simular);
app.post('/api/reservas/abrir', reservaController.abrir);
app.post('/api/reservas/:id/depositar', reservaController.depositarFrasco);
app.post('/api/reservas/:id/retirar', reservaController.retirarFrasco);

// Tarjetas (débito vinculada a la caja de ahorro en ARS y crédito con límite)
app.get('/api/tarjetas', tarjetaController.listar);
app.post('/api/tarjetas/emitir', tarjetaController.emitir);
app.post('/api/tarjetas/credito/pagar', tarjetaController.pagar);
app.post('/api/tarjetas/:tipo/comprar', tarjetaController.comprar);
app.put('/api/tarjetas/:tipo/bloqueo', tarjetaController.bloquear);
app.get('/api/tarjetas/:tipo/movimientos', tarjetaController.movimientos);

// Columnas de verificación de email
const db = require('./config/db');
db.query(`
  ALTER TABLE Personas ADD COLUMN IF NOT EXISTS verificado BOOLEAN DEFAULT FALSE;
  ALTER TABLE Personas ADD COLUMN IF NOT EXISTS token_verificacion VARCHAR(6);
  ALTER TABLE Personas ADD COLUMN IF NOT EXISTS token_expira TIMESTAMPTZ;
`).catch(e => console.error('Error agregando columnas verificación:', e.message));

// Agregar columna descripcion si no existe (mensajes en transferencias)
db.query(`ALTER TABLE Transacciones ADD COLUMN IF NOT EXISTS descripcion TEXT`)
  .catch(e => console.error('Error agregando columna descripcion:', e.message));

// Agregar columna tipo si no existe (para distinguir compra/venta de USD de las transferencias normales)
db.query(`ALTER TABLE Transacciones ADD COLUMN IF NOT EXISTS tipo VARCHAR(20)`)
  .catch(e => console.error('Error agregando columna tipo:', e.message));

// Ensanchar tipo: 'otorgamiento_prestamo' tiene 21 caracteres y no entraba en VARCHAR(20) — el INSERT
// fallaba en silencio (el .catch de upsertTransaccion se comía el error) desde que existe Préstamos,
// así que ningún préstamo otorgado quedó nunca registrado en el historial de movimientos.
db.query(`ALTER TABLE Transacciones ALTER COLUMN tipo TYPE VARCHAR(30)`)
  .catch(e => console.error('Error ensanchando columna tipo:', e.message));

// Crear tabla Transacciones si no existe (historial persistente)
db.query(`
  CREATE TABLE IF NOT EXISTS Transacciones (
    id                SERIAL PRIMARY KEY,
    tx_id             VARCHAR(100) UNIQUE NOT NULL,
    cbu_origen        VARCHAR(22) NOT NULL,
    cbu_destino       VARCHAR(22) NOT NULL,
    importe           DECIMAL(15,2) NOT NULL,
    estado            VARCHAR(20) NOT NULL,
    motivo_rechazo    TEXT,
    bank_code_origen  INTEGER,
    bank_code_destino INTEGER,
    persona_origen    JSONB,
    persona_destino   JSONB,
    created_at        TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('Error creando tabla Transacciones:', e.message));

// Préstamos: tipo de producto nuevo + tablas de préstamos/cuotas
db.query(`INSERT INTO Tipos_Producto (nombre) VALUES ('PRESTAMO') ON CONFLICT (nombre) DO NOTHING`)
  .catch(e => console.error('Error agregando tipo de producto PRESTAMO:', e.message));

db.query(`
  CREATE TABLE IF NOT EXISTS Prestamos (
    id_prestamo       SERIAL PRIMARY KEY,
    id_producto       INTEGER NOT NULL UNIQUE REFERENCES Productos(id_producto),
    monto             DECIMAL(15,2) NOT NULL,
    plazo_meses       INTEGER NOT NULL,
    tna               DECIMAL(8,5) NOT NULL,
    cft               DECIMAL(8,5),
    cuota_monto       DECIMAL(15,2) NOT NULL,
    estado            VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    fecha_alta        TIMESTAMP DEFAULT NOW(),
    fecha_cancelacion TIMESTAMP
  )
`).catch(e => console.error('Error creando tabla Prestamos:', e.message));

db.query(`
  CREATE TABLE IF NOT EXISTS Cuotas (
    id_cuota          SERIAL PRIMARY KEY,
    id_prestamo       INTEGER NOT NULL REFERENCES Prestamos(id_prestamo),
    numero_cuota      INTEGER NOT NULL,
    capital           DECIMAL(15,2) NOT NULL,
    interes           DECIMAL(15,2) NOT NULL,
    monto             DECIMAL(15,2) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    estado            VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    fecha_pago        TIMESTAMP,
    UNIQUE(id_prestamo, numero_cuota)
  )
`).catch(e => console.error('Error creando tabla Cuotas:', e.message));

db.query(`CREATE INDEX IF NOT EXISTS idx_cuotas_estado_venc ON Cuotas(estado, fecha_vencimiento)`)
  .catch(e => console.error('Error creando indice idx_cuotas_estado_venc:', e.message));
db.query(`CREATE INDEX IF NOT EXISTS idx_cuotas_prestamo ON Cuotas(id_prestamo)`)
  .catch(e => console.error('Error creando indice idx_cuotas_prestamo:', e.message));

// Dispositivos conocidos, para el aviso de "nuevo inicio de sesión desde otro dispositivo"
db.query(`
  CREATE TABLE IF NOT EXISTS Dispositivos_Conocidos (
    id            SERIAL PRIMARY KEY,
    id_persona    INTEGER NOT NULL REFERENCES Personas(id),
    device_id     VARCHAR(100) NOT NULL,
    descripcion   VARCHAR(100),
    primer_login  TIMESTAMP DEFAULT NOW(),
    ultimo_login  TIMESTAMP DEFAULT NOW(),
    UNIQUE(id_persona, device_id)
  )
`).catch(e => console.error('Error creando tabla Dispositivos_Conocidos:', e.message));

// Uso diario del asistente de IA por persona, para no agotar el tope gratuito compartido
db.query(`
  CREATE TABLE IF NOT EXISTS Asistente_Uso (
    id_persona INTEGER NOT NULL REFERENCES Personas(id),
    fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
    cantidad   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id_persona, fecha)
  )
`).catch(e => console.error('Error creando tabla Asistente_Uso:', e.message));

// Centro de notificaciones in-app
db.query(`
  CREATE TABLE IF NOT EXISTS Notificaciones (
    id_notificacion SERIAL PRIMARY KEY,
    id_persona      INTEGER NOT NULL REFERENCES Personas(id),
    tipo            VARCHAR(30) NOT NULL,
    titulo          VARCHAR(120) NOT NULL,
    mensaje         TEXT NOT NULL,
    leida           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('Error creando tabla Notificaciones:', e.message));
db.query(`CREATE INDEX IF NOT EXISTS idx_notificaciones_persona ON Notificaciones(id_persona, leida, created_at DESC)`)
  .catch(e => console.error('Error creando indice idx_notificaciones_persona:', e.message));

// Reservas: tipo de producto nuevo + tabla de reservas (fija por meses, fija por días, frasco)
db.query(`INSERT INTO Tipos_Producto (nombre) VALUES ('RESERVA') ON CONFLICT (nombre) DO NOTHING`)
  .catch(e => console.error('Error agregando tipo de producto RESERVA:', e.message));

db.query(`
  CREATE TABLE IF NOT EXISTS Reservas (
    id_reserva           SERIAL PRIMARY KEY,
    id_producto          INTEGER NOT NULL UNIQUE REFERENCES Productos(id_producto),
    tipo                 VARCHAR(20) NOT NULL,
    nombre               VARCHAR(50),
    saldo                DECIMAL(15,2) NOT NULL DEFAULT 0,
    tna                  DECIMAL(8,5) NOT NULL,
    plazo_dias           INTEGER,
    plazo_meses          INTEGER,
    fecha_alta           TIMESTAMP DEFAULT NOW(),
    fecha_vencimiento    DATE,
    fecha_ultimo_interes DATE DEFAULT CURRENT_DATE,
    estado               VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
    interes_pagado       DECIMAL(15,2) NOT NULL DEFAULT 0
  )
`).catch(e => console.error('Error creando tabla Reservas:', e.message));

// Tarjetas: tipos/estados de producto + tabla de débito + columnas nuevas en crédito + movimientos.
// Va en una sola cadena para que las tablas existan antes de los ALTER/índices que dependen de ellas.
(async () => {
  await db.query(`INSERT INTO Tipos_Producto (nombre) VALUES ('TARJETA_CREDITO'), ('TARJETA_DEBITO') ON CONFLICT (nombre) DO NOTHING`);
  await db.query(`INSERT INTO Estados_Producto (nombre) VALUES ('ACTIVO'), ('BLOQUEADO'), ('CERRADO') ON CONFLICT (nombre) DO NOTHING`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS Tarjetas_Credito (
      id_tarjeta        SERIAL PRIMARY KEY,
      id_producto       INTEGER NOT NULL UNIQUE REFERENCES Productos(id_producto),
      numero_tarjeta    VARCHAR(16) UNIQUE NOT NULL,
      marca             VARCHAR(50),
      fecha_vencimiento DATE NOT NULL,
      limite_compra     DECIMAL(15,2) NOT NULL,
      dia_cierre        INTEGER CHECK (dia_cierre BETWEEN 1 AND 31)
    )
  `);
  await db.query(`
    ALTER TABLE Tarjetas_Credito ADD COLUMN IF NOT EXISTS cvv VARCHAR(3);
    ALTER TABLE Tarjetas_Credito ADD COLUMN IF NOT EXISTS nombre_titular VARCHAR(60);
    ALTER TABLE Tarjetas_Credito ADD COLUMN IF NOT EXISTS deuda DECIMAL(15,2) NOT NULL DEFAULT 0;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS Tarjetas_Debito (
      id_tarjeta        SERIAL PRIMARY KEY,
      id_producto       INTEGER NOT NULL UNIQUE REFERENCES Productos(id_producto),
      id_cuenta         INTEGER NOT NULL REFERENCES Cuentas_Bancarias(id_cuenta),
      numero_tarjeta    VARCHAR(16) UNIQUE NOT NULL,
      marca             VARCHAR(50),
      nombre_titular    VARCHAR(60),
      fecha_vencimiento DATE NOT NULL,
      cvv               VARCHAR(3) NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS Consumos_Tarjeta (
      id_movimiento SERIAL PRIMARY KEY,
      id_producto   INTEGER NOT NULL REFERENCES Productos(id_producto),
      tipo          VARCHAR(10) NOT NULL,
      comercio      VARCHAR(80) NOT NULL,
      monto         DECIMAL(15,2) NOT NULL,
      cuotas        INTEGER NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_consumos_tarjeta_producto ON Consumos_Tarjeta(id_producto, created_at DESC)`);
})().catch(e => console.error('Error creando tablas de tarjetas:', e.message));

// Aviso de lectura del QR interbancario: registro de quién leyó el QR de quién
// (prompt-aviso-lectura-qr.md) — no mueve plata, solo dispara la notificación
// "Fulano escaneó tu QR".
db.query(`
  CREATE TABLE IF NOT EXISTS Qr_Lecturas (
    id            SERIAL PRIMARY KEY,
    id_persona    INTEGER NOT NULL REFERENCES Personas(id),
    cbu           VARCHAR(22) NOT NULL,
    jti           VARCHAR(100),
    banco_lector  INTEGER NOT NULL,
    nombre_lector VARCHAR(40),
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('Error creando tabla Qr_Lecturas:', e.message));
db.query(`CREATE INDEX IF NOT EXISTS idx_qr_lecturas_dedupe ON Qr_Lecturas(id_persona, banco_lector, jti, created_at DESC)`)
  .catch(e => console.error('Error creando indice idx_qr_lecturas_dedupe:', e.message));
// QR de un solo uso (prompt-aviso-lectura-qr.md v2): con jti, la PRIMERA lectura "cierra"
// el QR — ninguna otra puede insertar el mismo jti de nuevo. Índice único parcial (solo
// alcanza a las filas con jti, las sin jti siguen permitiendo varias dentro de los 30s).
db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_lecturas_jti_unico ON Qr_Lecturas(jti) WHERE jti IS NOT NULL`)
  .catch(e => console.error('Error creando indice idx_qr_lecturas_jti_unico:', e.message));

// Proxy para obtener nombre de banco por código
app.get('/api/banco/:code', async (req, res) => {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${process.env.BANCO_URL}/banks/${req.params.code}`, {
      signal: ctrl.signal,
      headers: { 'x-api-key': process.env.BANCO_TOKEN, 'x-environment': process.env.BANCO_ENV }
    });
    clearTimeout(tid);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message;
    res.status(504).json({ error: msg });
  }
});

// QR interbancario firmado (JWT ES256)
app.post('/api/qr/firmar', qrController.firmar);
app.post('/api/qr/verificar', qrController.verificar);
// Aviso de lectura (rol emisor): lo llaman los otros bancos de la cátedra, sin login.
app.post('/api/qr/aviso-lectura', qrController.avisoLectura);
// Polling del QR propio (cada 2s mientras el modal está abierto) para saber si ya lo
// escanearon y cerrarlo en pantalla — alternativa a Realtime, ver plan en memoria.
app.get('/api/qr/estado', qrController.estado);

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
}

module.exports = app;