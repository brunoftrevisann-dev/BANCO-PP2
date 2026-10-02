const db = require('../config/db');

const QrLectura = {
  // QR de un solo uso (cuando el QR tiene jti): INSERT atómico contra el índice único
  // parcial de jti — la PRIMERA lectura gana la carrera y "cierra" el QR; cualquier otra
  // (de cualquier banco) choca contra el índice y nunca llega a insertar. Evita la
  // condición de carrera de "leer si existe, después insertar" con dos personas escaneando
  // a la vez: el ON CONFLICT lo resuelve en un solo round-trip a la base.
  intentarCerrarConJti: async ({ idPersona, cbu, jti, bancoLector, nombreLector }) => {
    const insert = await db.query(
      `INSERT INTO Qr_Lecturas (id_persona, cbu, jti, banco_lector, nombre_lector)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (jti) WHERE jti IS NOT NULL DO NOTHING
       RETURNING *`,
      [idPersona, cbu, jti, bancoLector, nombreLector || null]
    );
    if (insert.rows[0]) return { resultado: 'primera', fila: insert.rows[0] };

    const existente = await db.query(`SELECT * FROM Qr_Lecturas WHERE jti = $1 LIMIT 1`, [jti]);
    const fila = existente.rows[0];
    if (!fila) return { resultado: 'primera', fila: null }; // carrera rarísima, no debería pasar
    const mismoLector = fila.banco_lector === bancoLector && (fila.nombre_lector || null) === (nombreLector || null);
    return { resultado: mismoLector ? 'repetida_mismo_lector' : 'usado_por_otro', fila };
  },

  buscarPorJti: async (jti) => {
    const { rows } = await db.query(`SELECT * FROM Qr_Lecturas WHERE jti = $1 LIMIT 1`, [jti]);
    return rows[0] || null;
  },

  // QR sin jti (viejos): nunca se cierran, solo se ignoran repetidos de la misma cuenta +
  // banco dentro de los 30s (la cámara suele leer el mismo cuadro varias veces seguidas).
  yaAvisado: async ({ bancoLector, cbu }) => {
    const { rows } = await db.query(
      `SELECT 1 FROM Qr_Lecturas
       WHERE banco_lector = $1 AND cbu = $2
         AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`,
      [bancoLector, cbu]
    );
    return rows.length > 0;
  },

  registrar: async ({ idPersona, cbu, jti, bancoLector, nombreLector }) => {
    const { rows } = await db.query(
      `INSERT INTO Qr_Lecturas (id_persona, cbu, jti, banco_lector, nombre_lector)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [idPersona, cbu, jti || null, bancoLector, nombreLector || null]
    );
    return rows[0];
  }
};

module.exports = QrLectura;
