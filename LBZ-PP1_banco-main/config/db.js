const { Pool } = require('pg');
require('dotenv').config();

// Decodificar la URL para que los caracteres especiales (%23, %25) se conviertan correctamente
let databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  databaseUrl = databaseUrl.replace(/%23/g, '#').replace(/%25/g, '%');
}

// El problema es que el # en la contraseña interrumpe la conexión de pg
// Vamos a usar configuración por componentes
const pool = new Pool({
  host: 'aws-1-us-west-2.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.bjpgdcgloinsjogpwwgm',
  password: '#VyjbJC-L%TEk4n',
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;