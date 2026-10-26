require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const app = express();
const personaController = require('./controllers/personaController');
const prestamoController = require('./controllers/prestamoController');
const cronController = require('./controllers/cronController');
const asistenteController = require('./controllers/asistenteController');
const notificacionController = require('./controllers/notificacionController');
const qrController = require('./controllers/qrController');
const reservaController = require('./controllers/reservaController');
const { requireAuth } = require('./utils/sesion');
const tarjetaController = require('./controllers/tarjetaController');

// Vercel Hobby no protege gratis el dominio de producción: esto pausa el sitio desde una variable de entorno.
app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE !== 'true') return next();
    // El cron sigue corriendo con el sitio pausado; su handler vuelve a validar el secreto.
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

// Los bancos de la cátedra esperan 200 en este preflight, no el 204 que manda cors().
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
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/registro', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

app.get('/api/personas/:id/productos', requireAuth, personaController.obtenerProductos);
app.post('/api/personas/login', personaController.login);
app.post('/api/personas/logout', personaController.logout);
app.post('/api/personas/registrar', personaController.registrarPersona);
app.get('/api/historial', requireAuth, personaController.obtenerHistorial);
app.get('/api/buscar-persona', requireAuth, personaController.buscarPersona);
app.get('/api/otra-moneda-persona', requireAuth, personaController.otraMonedaPersona);
app.post('/api/transferencia', requireAuth, personaController.transferir);
app.put('/api/actualizar-alias', requireAuth, personaController.actualizarAlias);
app.post('/api/verificar-cuenta', personaController.verificarCuenta);
app.post('/api/reenviar-codigo', personaController.reenviarCodigo);
app.post('/api/depositar', requireAuth, personaController.depositar);
app.post('/api/solicitar-cambio-password', personaController.solicitarCambioPassword);
app.put('/api/confirmar-cambio-password', personaController.confirmarCambioPassword);
app.get('/api/cotizacion-dolar', personaController.cotizacionDolar);
app.post('/api/cuenta-usd/solicitar-verificacion', requireAuth, personaController.solicitarAperturaUsd);
app.post('/api/cuenta-usd', requireAuth, personaController.abrirCuentaUsd);
app.post('/api/cambiar-divisa', requireAuth, personaController.cambiarDivisa);

app.get('/api/prestamos/tasas', prestamoController.obtenerTasas);
app.get('/api/prestamos/perfil-crediticio', requireAuth, prestamoController.perfilCrediticio);
app.post('/api/prestamos/simular', requireAuth, prestamoController.simular);
app.post('/api/prestamos/solicitar', requireAuth, prestamoController.solicitar);
app.get('/api/prestamos', requireAuth, prestamoController.listar);
app.get('/api/prestamos/proxima-cuota', requireAuth, prestamoController.proximaCuota);
app.get('/api/prestamos/:id/cuotas', requireAuth, prestamoController.cuotas);
app.post('/api/prestamos/:id/pagar-cuota', requireAuth, prestamoController.pagarCuota);
app.post('/api/prestamos/:id/cancelar', requireAuth, prestamoController.cancelarAnticipado);

app.get('/api/cron/prestamos-diario', cronController.diario);

app.post('/api/asistente/chat', requireAuth, asistenteController.chat);

app.get('/api/notificaciones', requireAuth, notificacionController.listar);
app.get('/api/notificaciones/no-leidas', requireAuth, notificacionController.noLeidas);
app.put('/api/notificaciones/:id/leer', requireAuth, notificacionController.marcarLeida);
app.put('/api/notificaciones/marcar-todas-leidas', requireAuth, notificacionController.marcarTodasLeidas);

app.get('/api/reservas/tasas', reservaController.tasas);
app.get('/api/reservas', requireAuth, reservaController.listar);
app.post('/api/reservas/simular', requireAuth, reservaController.simular);
app.post('/api/reservas/abrir', requireAuth, reservaController.abrir);
app.post('/api/reservas/:id/depositar', requireAuth, reservaController.depositarFrasco);
app.post('/api/reservas/:id/retirar', requireAuth, reservaController.retirarFrasco);

// tasas y simular son públicas: no exponen datos de ninguna persona.
app.get('/api/tarjetas', requireAuth, tarjetaController.listar);
app.get('/api/tarjetas/credito/tasas', tarjetaController.tasas);
app.post('/api/tarjetas/credito/simular', tarjetaController.simular);
app.post('/api/tarjetas/emitir', requireAuth, tarjetaController.emitir);
app.post('/api/tarjetas/credito/pagar', requireAuth, tarjetaController.pagar);
app.post('/api/tarjetas/:tipo/comprar', requireAuth, tarjetaController.comprar);
app.put('/api/tarjetas/:tipo/bloqueo', requireAuth, tarjetaController.bloquear);
app.post('/api/tarjetas/:tipo/datos', requireAuth, tarjetaController.verDatos);
app.get('/api/tarjetas/:tipo/movimientos', requireAuth, tarjetaController.movimientos);

const db = require('./config/db');
db.query(`
  ALTER TABLE Personas ADD COLUMN IF NOT EXISTS verificado BOOLEAN DEFAULT FALSE;
  ALTER TABLE Personas ADD COLUMN IF NOT EXISTS token_verificacion VARCHAR(6);
  ALTER TABLE Personas ADD COLUMN IF NOT EXISTS token_expira TIMESTAMPTZ;
`).catch(e => console.error('Error agregando columnas verificación:', e.message));

// Intentos fallidos de los códigos de 6 dígitos (verificación de email y reset de contraseña).
db.query(`ALTER TABLE Personas ADD COLUMN IF NOT EXISTS intentos_verificacion INTEGER NOT NULL DEFAULT 0`)
  .catch(e => console.error('Error agregando columna intentos_verificacion:', e.message));

db.query(`ALTER TABLE Transacciones ADD COLUMN IF NOT EXISTS descripcion TEXT`)
  .catch(e => console.error('Error agregando columna descripcion:', e.message));

// tipo distingue cambios de divisa y préstamos de las transferencias comunes.
db.query(`ALTER TABLE Transacciones ADD COLUMN IF NOT EXISTS tipo VARCHAR(20)`)
  .catch(e => console.error('Error agregando columna tipo:', e.message));

// 'otorgamiento_prestamo' tiene 21 caracteres: no entra en VARCHAR(20).
db.query(`ALTER TABLE Transacciones ALTER COLUMN tipo TYPE VARCHAR(30)`)
  .catch(e => console.error('Error ensanchando columna tipo:', e.message));

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

// Tope diario por persona para no agotar la cuota gratuita compartida de la IA.
db.query(`
  CREATE TABLE IF NOT EXISTS Asistente_Uso (
    id_persona INTEGER NOT NULL REFERENCES Personas(id),
    fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
    cantidad   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id_persona, fecha)
  )
`).catch(e => console.error('Error creando tabla Asistente_Uso:', e.message));

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

// Una sola cadena: las tablas tienen que existir antes de los ALTER e índices que dependen de ellas.
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
  await db.query(`
    ALTER TABLE Tarjetas_Credito ADD COLUMN IF NOT EXISTS saldo_financiado DECIMAL(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE Tarjetas_Credito ADD COLUMN IF NOT EXISTS fecha_ultimo_interes DATE DEFAULT CURRENT_DATE;
    ALTER TABLE Consumos_Tarjeta ADD COLUMN IF NOT EXISTS monto_cuota DECIMAL(15,2);
    ALTER TABLE Consumos_Tarjeta ADD COLUMN IF NOT EXISTS total DECIMAL(15,2);
    ALTER TABLE Consumos_Tarjeta ADD COLUMN IF NOT EXISTS tna DECIMAL(8,5);
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_consumos_tarjeta_producto ON Consumos_Tarjeta(id_producto, created_at DESC)`);
})().catch(e => console.error('Error creando tablas de tarjetas:', e.message));

// Solo registra quién leyó el QR para notificarlo; no mueve plata.
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
// La primera lectura de un QR con jti lo cierra; los QR sin jti admiten varias lecturas.
db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_lecturas_jti_unico ON Qr_Lecturas(jti) WHERE jti IS NOT NULL`)
  .catch(e => console.error('Error creando indice idx_qr_lecturas_jti_unico:', e.message));

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

app.post('/api/qr/firmar', requireAuth, qrController.firmar);
app.post('/api/qr/verificar', requireAuth, qrController.verificar);
// Lo llaman los otros bancos de la cátedra, por eso no pide login.
app.post('/api/qr/aviso-lectura', qrController.avisoLectura);
// Polling cada 2 s mientras el modal del QR está abierto, en lugar de Realtime.
app.get('/api/qr/estado', qrController.estado);

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
}

module.exports = app;