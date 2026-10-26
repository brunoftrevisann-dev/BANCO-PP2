const db = require('../config/db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fetchConTimeout = require('../utils/fetchConTimeout');
const moverSaldo = require('../utils/moverSaldo');

const ES_HASH_BCRYPT = /^\$2[aby]\$/;

// Las cuentas viejas tienen la contraseña en texto plano: si coincide, se rehashea en el momento.
async function compararYMigrarPassword(password, guardado, idPersona) {
  if (ES_HASH_BCRYPT.test(guardado)) return bcrypt.compare(password, guardado);
  if (password !== guardado) return false;
  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE Personas SET password = $1 WHERE id = $2', [hash, idPersona]);
  return true;
}

function borrarUsuarioAuth(id) {
  return fetchConTimeout(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
}

// Si Supabase no respondió, el usuario pudo crearse igual; se reintenta una vez por si seguía procesando.
function limpiarUsuarioAuthHuerfano(id) {
  (async () => {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const res = await borrarUsuarioAuth(id);
        if (res.ok) return;
      } catch {}
      if (intento === 1) await new Promise(r => setTimeout(r, 5000));
    }
  })();
}

const Persona = {
  getProductos: async (id) => {
    const query = `
      SELECT pr.id_producto, tp.nombre AS tipo, ep.nombre AS estado, pr.fecha_alta,
             cb.cbu, cb.alias, cb.moneda, cb.saldo,
             tc.numero_tarjeta, tc.marca, tc.fecha_vencimiento, tc.limite_compra, tc.dia_cierre
      FROM Productos pr
      JOIN Tipos_Producto tp ON pr.id_tipo_producto = tp.id_tipo_producto
      JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
      LEFT JOIN Cuentas_Bancarias cb ON pr.id_producto = cb.id_producto
      LEFT JOIN Tarjetas_Credito tc ON pr.id_producto = tc.id_producto
      WHERE pr.id_persona = $1
    `;
    const { rows } = await db.query(query, [id]);
    return rows;
  },

  findByCredentials: async (email, password) => {
    // bcrypt no se puede comparar en el WHERE: se busca por email y se compara en JS.
    const query = `
      SELECT p.id, p.nombre, p.apellido, p.dni, p.email, p.telefono, p.direccion, p.password,
             cb.cbu, cb.alias, cb.saldo, cb.moneda,
             tp.nombre AS tipo_producto
      FROM Personas p
      LEFT JOIN Productos pr ON p.id = pr.id_persona
      LEFT JOIN Cuentas_Bancarias cb ON pr.id_producto = cb.id_producto AND cb.moneda = 'ARS'
      LEFT JOIN Tipos_Producto tp ON pr.id_tipo_producto = tp.id_tipo_producto
      WHERE p.email = $1 AND p.verificado = TRUE
      LIMIT 1
    `;
    const { rows } = await db.query(query, [email]);
    const persona = rows[0];
    if (!persona) return null;
    const valido = await compararYMigrarPassword(password, persona.password, persona.id);
    if (!valido) return null;
    delete persona.password; // nunca devolver el hash al cliente
    return persona;
  },

  getByCbu: async (cbu) => {
    const query = `
      SELECT cb.id_cuenta, cb.saldo, cb.alias, cb.cbu, cb.moneda,
             p.nombre, p.apellido, p.id AS id_persona, p.dni
      FROM Cuentas_Bancarias cb
      JOIN Productos pr ON cb.id_producto = pr.id_producto
      JOIN Personas p ON pr.id_persona = p.id
      WHERE cb.cbu = $1
    `;
    const { rows } = await db.query(query, [cbu]);
    return rows[0] || null;
  },

  // Un solo UPDATE relativo: dos acreditaciones simultáneas no se pisan.
  acreditar: async (cbu, importe) => {
    const { rows } = await db.query(
      'UPDATE Cuentas_Bancarias SET saldo = saldo + $1 WHERE cbu = $2 RETURNING saldo',
      [importe, cbu]
    );
    return rows[0] ? Number(rows[0].saldo) : null;
  },

  // Lockea las dos filas en una consulta y en orden por cbu, para que A→B y B→A simultáneas no hagan deadlock.
  debitarYAcreditar: async (cbuOrigen, cbuDestino, importe) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id_cuenta, cbu, saldo FROM Cuentas_Bancarias
         WHERE cbu IN ($1, $2) ORDER BY cbu FOR UPDATE`,
        [cbuOrigen, cbuDestino]
      );
      const origen  = rows.find(r => r.cbu === cbuOrigen);
      const destino = rows.find(r => r.cbu === cbuDestino);
      if (!origen) throw Object.assign(new Error('Cuenta origen no encontrada'), { code: 'NO_CUENTA' });
      if (Number(origen.saldo) < Number(importe))
        throw Object.assign(new Error('Saldo insuficiente'), { code: 'SALDO_INSUFICIENTE' });

      const nuevoSaldoOrigen = await moverSaldo(client, origen.id_cuenta, -Number(importe));

      let nuevoSaldoDestino = null;
      if (destino) {
        nuevoSaldoDestino = await moverSaldo(client, destino.id_cuenta, Number(importe));
      }

      await client.query('COMMIT');
      return { nuevoSaldoOrigen, nuevoSaldoDestino };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  updateAlias: async (cbu, nuevoAlias) => {
    await db.query('UPDATE Cuentas_Bancarias SET alias = $1 WHERE cbu = $2', [nuevoAlias, cbu]);
  },

  getDni: async (idPersona) => {
    const { rows } = await db.query('SELECT dni FROM Personas WHERE id = $1', [idPersona]);
    return rows[0]?.dni || null;
  },

  // tenia_dispositivos evita el aviso de "nuevo dispositivo" en el primer login de la cuenta.
  registrarDispositivo: async (idPersona, deviceId, descripcion) => {
    if (!deviceId) return { tenia_dispositivos: true, es_nuevo: false };
    const previosResult = await db.query(
      'SELECT 1 FROM Dispositivos_Conocidos WHERE id_persona = $1 LIMIT 1',
      [idPersona]
    );
    const teniaDispositivos = previosResult.rows.length > 0;
    const { rows } = await db.query(
      `INSERT INTO Dispositivos_Conocidos (id_persona, device_id, descripcion)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_persona, device_id) DO UPDATE SET ultimo_login = NOW(), descripcion = EXCLUDED.descripcion
       RETURNING (xmax = 0) AS es_nuevo`,
      [idPersona, deviceId, descripcion || null]
    );
    return { tenia_dispositivos: teniaDispositivos, es_nuevo: rows[0]?.es_nuevo || false };
  },

  getDatosBasicos: async (idPersona) => {
    const { rows } = await db.query('SELECT dni, nombre, apellido FROM Personas WHERE id = $1', [idPersona]);
    return rows[0] || null;
  },

  verificarDatosPersona: async (idPersona, dni, telefono, email) => {
    const { rows } = await db.query(
      `SELECT id FROM Personas WHERE id = $1 AND dni = $2 AND telefono = $3 AND LOWER(email) = LOWER($4)`,
      [idPersona, dni, telefono, email]
    );
    return !!rows[0];
  },

  limpiarTokenPorEmail: async (email) => {
    await db.query(
      `UPDATE Personas SET token_verificacion = NULL, token_expira = NULL WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
  },

  getCuentaPorMoneda: async (idPersona, moneda) => {
    const query = `
      SELECT cb.id_cuenta, cb.cbu, cb.alias, cb.moneda, cb.saldo
      FROM Cuentas_Bancarias cb
      JOIN Productos pr ON cb.id_producto = pr.id_producto
      WHERE pr.id_persona = $1 AND cb.moneda = $2
      LIMIT 1
    `;
    const { rows } = await db.query(query, [idPersona, moneda]);
    return rows[0] || null;
  },

  // La cuenta ya tiene que estar abierta en el Banco Central.
  crearCuentaUsd: async (idPersona, cbu, alias) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto)
         VALUES ($1, 1, 1) RETURNING *`,
        [idPersona]
      );
      const cuentaResult = await client.query(
        `INSERT INTO Cuentas_Bancarias (id_producto, cbu, alias, moneda, saldo)
         VALUES ($1, $2, $3, 'USD', 0) RETURNING *`,
        [productoResult.rows[0].id_producto, cbu, alias]
      );
      await client.query('COMMIT');
      return cuentaResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  cambiarDivisa: async (idPersona, direccion, importeUsd, tasaCompra, tasaVenta) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT cb.id_cuenta, cb.cbu, cb.moneda, cb.saldo
         FROM Cuentas_Bancarias cb
         JOIN Productos pr ON cb.id_producto = pr.id_producto
         WHERE pr.id_persona = $1 AND cb.moneda IN ('ARS', 'USD')
         FOR UPDATE`,
        [idPersona]
      );
      const ars = rows.find(r => r.moneda === 'ARS');
      const usd = rows.find(r => r.moneda === 'USD');
      if (!ars || !usd) throw Object.assign(new Error('Necesitás una caja en ARS y otra en USD para operar'), { code: 'NO_CUENTA' });

      // Se redondea a centavos porque es lo que se mueve y lo que se muestra.
      let importeArs, deltaArs, deltaUsd;
      if (direccion === 'compra') {
        importeArs = Math.round(importeUsd * tasaVenta * 100) / 100;
        if (Number(ars.saldo) < importeArs) throw Object.assign(new Error('Saldo insuficiente en ARS'), { code: 'SALDO_INSUFICIENTE' });
        deltaArs = -importeArs;
        deltaUsd = importeUsd;
      } else {
        importeArs = Math.round(importeUsd * tasaCompra * 100) / 100;
        if (Number(usd.saldo) < importeUsd) throw Object.assign(new Error('Saldo insuficiente en USD'), { code: 'SALDO_INSUFICIENTE' });
        deltaArs = importeArs;
        deltaUsd = -importeUsd;
      }
      const nuevoArs = await moverSaldo(client, ars.id_cuenta, deltaArs);
      const nuevoUsd = await moverSaldo(client, usd.id_cuenta, deltaUsd);
      await client.query('COMMIT');
      return { saldoArs: nuevoArs, saldoUsd: nuevoUsd, importeArs, cbuArs: ars.cbu, cbuUsd: usd.cbu };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  upsertTransaccion: async (tx) => {
    await db.query(
      `INSERT INTO Transacciones
         (tx_id, cbu_origen, cbu_destino, importe, estado, motivo_rechazo,
          bank_code_origen, bank_code_destino, persona_origen, persona_destino, created_at, descripcion, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tx_id) DO UPDATE SET
         estado          = EXCLUDED.estado,
         motivo_rechazo  = EXCLUDED.motivo_rechazo,
         persona_origen  = EXCLUDED.persona_origen,
         persona_destino = EXCLUDED.persona_destino,
         descripcion     = COALESCE(EXCLUDED.descripcion, Transacciones.descripcion)`,
      [
        tx._id,
        tx.cbuOrigen, tx.cbuDestino,
        tx.importe, tx.estado,
        tx.motivoRechazo || null,
        tx.bankCodeOrigen || null, tx.bankCodeDestino || null,
        JSON.stringify(tx.personaOrigen || null),
        JSON.stringify(tx.personaDestino || null),
        tx.createdAt || new Date().toISOString(),
        tx.descripcion || null,
        tx.tipo || null
      ]
    );
  },

  // Inserta el lote con ON CONFLICT DO NOTHING y solo acredita las nuevas que vienen de otro banco:
  // las transferencias tuo→tuo ya se acreditaron en transferir().
  sincronizarTransacciones: async (txs) => {
    if (!Array.isArray(txs) || txs.length === 0) return;
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const cols = 13;
      const values = [];
      const params = [];
      txs.forEach((tx, i) => {
        const base = i * cols;
        values.push(`(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(',')})`);
        params.push(
          tx._id,
          tx.cbuOrigen, tx.cbuDestino,
          tx.importe, tx.estado,
          tx.motivoRechazo || null,
          tx.bankCodeOrigen || null, tx.bankCodeDestino || null,
          JSON.stringify(tx.personaOrigen || null),
          JSON.stringify(tx.personaDestino || null),
          tx.createdAt || new Date().toISOString(),
          tx.descripcion || null,
          tx.tipo || null
        );
      });

      const { rows: nuevas } = await client.query(
        `INSERT INTO Transacciones
           (tx_id, cbu_origen, cbu_destino, importe, estado, motivo_rechazo,
            bank_code_origen, bank_code_destino, persona_origen, persona_destino, created_at, descripcion, tipo)
         VALUES ${values.join(',')}
         ON CONFLICT (tx_id) DO NOTHING
         RETURNING tx_id, cbu_origen, cbu_destino, importe, estado, persona_origen`,
        params
      );

      const acreditadas = [];
      const aprobadas = nuevas.filter(r => r.estado === 'aprobada');
      if (aprobadas.length > 0) {
        const origenes = [...new Set(aprobadas.map(r => r.cbu_origen))];
        const { rows: locales } = await client.query('SELECT cbu FROM Cuentas_Bancarias WHERE cbu = ANY($1)', [origenes]);
        const setLocales = new Set(locales.map(r => r.cbu));
        for (const r of aprobadas) {
          if (!setLocales.has(r.cbu_origen)) {
            await client.query('UPDATE Cuentas_Bancarias SET saldo = saldo + $1 WHERE cbu = $2', [r.importe, r.cbu_destino]);
            acreditadas.push(r);
          }
        }
      }

      await client.query('COMMIT');

      if (acreditadas.length > 0) {
        const { notificarTransferenciaRecibida } = require('../utils/notificaciones');
        const cbusDestino = [...new Set(acreditadas.map(r => r.cbu_destino))];
        db.query('SELECT cb.cbu, pr.id_persona AS "idPersona" FROM Cuentas_Bancarias cb JOIN Productos pr ON cb.id_producto = pr.id_producto WHERE cb.cbu = ANY($1)', [cbusDestino])
          .then(({ rows: cuentas }) => {
            const idPorCbu = Object.fromEntries(cuentas.map(c => [c.cbu, c.idPersona]));
            for (const r of acreditadas) {
              const idPersona = idPorCbu[r.cbu_destino];
              if (!idPersona) continue;
              const nombreOrigen = r.persona_origen ? `${r.persona_origen.nombre} ${r.persona_origen.apellido}` : 'otro banco';
              notificarTransferenciaRecibida(idPersona, { monto: r.importe, nombreOrigen })
                .catch(e => console.error('Error creando notificación de transferencia recibida:', e.message));
            }
          })
          .catch(e => console.error('Error resolviendo destinatarios para notificación de transferencia:', e.message));
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Exige los cbu de la propia persona: nunca devuelve movimientos de todo el banco.
  getTransaccionesPorCbu: async (cbus) => {
    const { rows } = await db.query(
      'SELECT * FROM Transacciones WHERE cbu_origen = ANY($1) OR cbu_destino = ANY($1) ORDER BY created_at DESC',
      [cbus]
    );
    return rows.map(r => ({
      _id:             r.tx_id,
      cbuOrigen:       r.cbu_origen,
      cbuDestino:      r.cbu_destino,
      importe:         Number(r.importe),
      estado:          r.estado,
      motivoRechazo:   r.motivo_rechazo,
      bankCodeOrigen:  r.bank_code_origen,
      bankCodeDestino: r.bank_code_destino,
      personaOrigen:   r.persona_origen,
      personaDestino:  r.persona_destino,
      createdAt:       r.created_at,
      descripcion:     r.descripcion || null,
      tipo:            r.tipo || null
    }));
  },

  verificarPasswordPorId: async (idPersona, password) => {
    const { rows } = await db.query('SELECT password FROM Personas WHERE id = $1', [idPersona]);
    if (!rows[0]) return false;
    return compararYMigrarPassword(password, rows[0].password, idPersona);
  },

  verificarPassword: async (email, password) => {
    const { rows } = await db.query(
      `SELECT id, password FROM Personas WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const persona = rows[0];
    if (!persona) return false;
    return compararYMigrarPassword(password, persona.password, persona.id);
  },

  generarTokenPassword: async (email) => {
    const token = crypto.randomInt(100000, 999999).toString();
    const expira = new Date(Date.now() + 5 * 60 * 1000);
    const { rows } = await db.query(
      `UPDATE Personas SET token_verificacion = $1, token_expira = $2, intentos_verificacion = 0
       WHERE LOWER(email) = LOWER($3)
       RETURNING nombre`,
      [token, expira, email]
    );
    if (!rows[0]) return null;
    return { nombre: rows[0].nombre, token };
  },

  // Busca solo por email para contar los intentos fallidos aunque el código no coincida.
  verificarTokenPassword: async (email, token) => {
    const { rows } = await db.query(
      `SELECT id, token_verificacion, token_expira, intentos_verificacion FROM Personas
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const persona = rows[0];
    if (!persona) return { ok: false, motivo: 'Código incorrecto' };
    if (persona.intentos_verificacion >= 5) return { ok: false, motivo: 'Demasiados intentos. Pedí un código nuevo.' };
    if (persona.token_verificacion !== token) {
      await db.query('UPDATE Personas SET intentos_verificacion = intentos_verificacion + 1 WHERE id = $1', [persona.id]);
      return { ok: false, motivo: 'Código incorrecto' };
    }
    if (new Date() > new Date(persona.token_expira)) return { ok: false, motivo: 'El código expiró. Solicitá uno nuevo.' };
    return { ok: true };
  },

  updatePassword: async (email, newPassword) => {
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await db.query(
      `UPDATE Personas
       SET password = $1, token_verificacion = NULL, token_expira = NULL
       WHERE LOWER(email) = LOWER($2)
       RETURNING id`,
      [hash, email]
    );
    return rows[0] || null;
  },

  reenviarToken: async (email) => {
    const token = crypto.randomInt(100000, 999999).toString();
    const expira = new Date(Date.now() + 5 * 60 * 1000);
    const { rows } = await db.query(
      `UPDATE Personas SET token_verificacion = $1, token_expira = $2, intentos_verificacion = 0
       WHERE email = $3 AND verificado = FALSE
       RETURNING nombre, token_verificacion AS token`,
      [token, expira, email]
    );
    return rows[0] || null;
  },

  // Busca solo por email para contar los intentos fallidos aunque el código no coincida.
  verificarToken: async (email, token) => {
    const { rows } = await db.query(
      'SELECT id, token_verificacion, token_expira, intentos_verificacion FROM Personas WHERE email = $1',
      [email]
    );
    const persona = rows[0];
    if (!persona) return { ok: false, motivo: 'Código incorrecto' };
    if (persona.intentos_verificacion >= 5) return { ok: false, motivo: 'Demasiados intentos. Registrate de nuevo.' };
    if (persona.token_verificacion !== token) {
      await db.query('UPDATE Personas SET intentos_verificacion = intentos_verificacion + 1 WHERE id = $1', [persona.id]);
      return { ok: false, motivo: 'Código incorrecto' };
    }
    if (new Date() > new Date(persona.token_expira)) return { ok: false, motivo: 'El código expiró. Registrate de nuevo.' };
    await db.query(
      'UPDATE Personas SET verificado = TRUE, token_verificacion = NULL, token_expira = NULL WHERE id = $1',
      [persona.id]
    );
    return { ok: true };
  },

  registrarConCuenta: async (data) => {
    const { nombre, apellido, dni, email, telefono, fecha_nac, domicilio, cbu, alias, password } = data;

    // El id se genera acá para poder borrar el usuario aunque Supabase no llegue a responder.
    const authId = crypto.randomUUID();
    let authRes;
    try {
      authRes = await fetchConTimeout(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: authId, email, password, email_confirm: true })
      });
    } catch (err) {
      limpiarUsuarioAuthHuerfano(authId);
      // Si no, registrarPersona lo reportaría como timeout del Banco Central, que ya respondió bien.
      if (err.name === 'AbortError') throw new Error('Supabase Auth tardó demasiado en responder. Intentá de nuevo.');
      throw err;
    }

    if (!authRes.ok) {
      const authError = await authRes.json().catch(() => ({}));
      throw new Error(authError.message || 'Error al crear usuario en Supabase Auth');
    }

    const authUser = await authRes.json();

    let client;
    try {
      client = await db.connect();
    } catch (error) {
      await borrarUsuarioAuth(authUser.id || authId).catch(() => {});
      throw error;
    }
    try {
      await client.query('BEGIN');

      // En Personas va el hash; la contraseña real es la que usa Supabase Auth.
      const passwordHash = await bcrypt.hash(password, 10);
      const personaResult = await client.query(
        `INSERT INTO Personas (nombre, apellido, dni, email, telefono, fecha_nac, direccion, password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [nombre, apellido, dni, email, telefono, fecha_nac, domicilio, passwordHash]
      );
      const persona = personaResult.rows[0];

      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto)
         VALUES ($1, 1, 1) RETURNING *`,
        [persona.id]
      );
      const producto = productoResult.rows[0];

      const cuentaResult = await client.query(
        `INSERT INTO Cuentas_Bancarias (id_producto, cbu, alias, saldo)
         VALUES ($1, $2, $3, 10000) RETURNING *`,
        [producto.id_producto, cbu, alias]
      );

      const token = crypto.randomInt(100000, 999999).toString();
      const expira = new Date(Date.now() + 5 * 60 * 1000);
      await client.query(
        'UPDATE Personas SET token_verificacion = $1, token_expira = $2 WHERE id = $3',
        [token, expira, persona.id]
      );

      await client.query('COMMIT');

      return {
        persona,
        producto,
        cuenta: cuentaResult.rows[0],
        token
      };
    } catch (error) {
      await client.query('ROLLBACK');
      await borrarUsuarioAuth(authUser.id || authId).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = Persona;
