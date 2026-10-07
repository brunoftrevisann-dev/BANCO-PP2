const db = require('../config/db');

const WebauthnCredencial = {
  crear: async (idPersona, { credentialId, publicKey, counter, deviceLabel }) => {
    const { rows } = await db.query(
      `INSERT INTO Credenciales_Biometricas (id_persona, credential_id, public_key, counter, device_label)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [idPersona, credentialId, publicKey, counter, deviceLabel || null]
    );
    return rows[0];
  },

  getPorPersona: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT * FROM Credenciales_Biometricas WHERE id_persona = $1 ORDER BY created_at DESC`,
      [idPersona]
    );
    return rows;
  },

  // La identidad de quién está logueando sale de ACÁ (qué persona es dueña de este
  // credential_id), no del userHandle que manda el navegador — es la misma garantía y evita
  // tener que decodificar/validar ese campo por separado.
  getPorCredentialId: async (credentialId) => {
    const { rows } = await db.query(
      `SELECT * FROM Credenciales_Biometricas WHERE credential_id = $1`,
      [credentialId]
    );
    return rows[0] || null;
  },

  actualizarCounter: async (credentialId, counter) => {
    await db.query(`UPDATE Credenciales_Biometricas SET counter = $1 WHERE credential_id = $2`, [counter, credentialId]);
  },

  // Scoped por dueño: nunca deja borrar una credencial de otra persona.
  eliminar: async (idPersona, credentialId) => {
    const { rowCount } = await db.query(
      `DELETE FROM Credenciales_Biometricas WHERE id_persona = $1 AND credential_id = $2`,
      [idPersona, credentialId]
    );
    return rowCount > 0;
  }
};

module.exports = WebauthnCredencial;
