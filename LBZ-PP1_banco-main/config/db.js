const { Pool } = require('pg');
require('dotenv').config();

// La contraseña va percent-encoded en DATABASE_URL (%23 = '#'): pg la decodifica, no hacerlo a mano.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;