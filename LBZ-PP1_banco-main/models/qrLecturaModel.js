const db = require('../config/db');

const QrLectura = {
  // Evita avisar dos veces la misma lectura: la cámara del banco lector suele leer el
  // mismo cuadro varias veces seguidas.
  // - Con jti: duplicado si ya existe un aviso con ese MISMO jti y el mismo banco en
  //   los últimos 30s (sin exigir que el aviso previo también tenga jti — si antes no
  //   lo llevaba y ahora sí, de cualquier forma coincide por banco+cuenta más abajo).
  // - Sin jti (el bug que corrigió Monix: comparar "jti = NULL" en SQL nunca matchea
  //   nada, así que dos escaneos seguidos de un QR sin jti generaban dos avisos):
  //   duplicado si ya existe un aviso para la MISMA CUENTA (el cbu del QR) y el mismo
  //   banco en los últimos 30s, sin importar si ese aviso anterior tenía jti o no.
  yaAvisado: async ({ bancoLector, jti, cbu }) => {
    const { rows } = jti
      ? await db.query(
          `SELECT 1 FROM Qr_Lecturas
           WHERE banco_lector = $1 AND jti = $2
             AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`,
          [bancoLector, jti]
        )
      : await db.query(
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
