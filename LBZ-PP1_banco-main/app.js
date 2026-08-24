require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const personaController = require('./controllers/personaController');
const tablaController = require('./controllers/tablaController');

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

// Endpoints sin joins (tablas crudas)
app.get('/api/tablas/:tabla', tablaController.obtenerTabla);

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

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
}

module.exports = app;