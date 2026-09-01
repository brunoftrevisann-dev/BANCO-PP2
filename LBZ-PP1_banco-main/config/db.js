const { Pool } = require('pg');
require('dotenv').config();

// DATABASE_URL debe ir con los caracteres especiales de la contraseña percent-encoded
// (%23 para '#', %25 para '%', etc.) — pg los decodifica solo al separar user/password/host.
// Decodificarlos a mano antes de pasarlos rompe el parseo (un '#' literal corta la URL ahí).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;