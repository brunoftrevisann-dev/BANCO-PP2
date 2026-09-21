const db = require('../config/db');

const Notificacion = {
  crear: async (idPersona, { tipo, titulo, mensaje }) => {
    const { rows } = await db.query(
      `INSERT INTO Notificaciones (id_persona, tipo, titulo, mensaje)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [idPersona, tipo, titulo, mensaje]
    );
    return rows[0];
  },

  listarPorPersona: async (idPersona, limit = 30) => {
    const { rows } = await db.query(
      `SELECT id_notificacion, tipo, titulo, mensaje, leida, created_at
       FROM Notificaciones
       WHERE id_persona = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [idPersona, limit]
    );
    return rows;
  },

  contarNoLeidas: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS cantidad FROM Notificaciones WHERE id_persona = $1 AND leida = FALSE`,
      [idPersona]
    );
    return rows[0].cantidad;
  },

  marcarLeida: async (idNotificacion, idPersona) => {
    const { rows } = await db.query(
      `UPDATE Notificaciones SET leida = TRUE
       WHERE id_notificacion = $1 AND id_persona = $2 RETURNING *`,
      [idNotificacion, idPersona]
    );
    return rows[0] || null;
  },

  marcarTodasLeidas: async (idPersona) => {
    await db.query(
      `UPDATE Notificaciones SET leida = TRUE WHERE id_persona = $1 AND leida = FALSE`,
      [idPersona]
    );
  }
};

module.exports = Notificacion;
