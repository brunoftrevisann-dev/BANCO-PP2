const db = require('../config/db');
const crypto = require('crypto');

const Persona = {
  getAll: async () => {
    const query = `
      SELECT p.id, p.nombre, p.apellido, p.dni,
             tp.nombre AS producto, ep.nombre AS estado,
             cb.saldo, tc.limite_compra
      FROM Personas p
      LEFT JOIN Productos pr ON p.id = pr.id_persona
      LEFT JOIN Tipos_Producto tp ON pr.id_tipo_producto = tp.id_tipo_producto
      LEFT JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
      LEFT JOIN Cuentas_Bancarias cb ON pr.id_producto = cb.id_producto
      LEFT JOIN Tarjetas_Credito tc ON pr.id_producto = tc.id_producto;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  getRoles: async (id) => {
    const query = `
      SELECT r.id_rol, r.nombre_rol, r.descripcion, r.activo
      FROM Roles r
      JOIN Roles_x_Personas rxp ON r.id_rol = rxp.id_rol
      WHERE rxp.id_persona = $1
    `;
    const { rows } = await db.query(query, [id]);
    return rows;
  },

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

  create: async (data) => {
    const { nombre, apellido, dni, email } = data;
    const query = 'INSERT INTO Personas (nombre, apellido, dni, email) VALUES ($1, $2, $3, $4) RETURNING *';
    const { rows } = await db.query(query, [nombre, apellido, dni, email]);
    return rows[0];
  },

  findByCredentials: async (email, password) => {
    const query = `
      SELECT p.id, p.nombre, p.apellido, p.dni, p.email, p.telefono, p.direccion,
             cb.cbu, cb.alias, cb.saldo, cb.moneda,
             tp.nombre AS tipo_producto
      FROM Personas p
      LEFT JOIN Productos pr ON p.id = pr.id_persona
      LEFT JOIN Cuentas_Bancarias cb ON pr.id_producto = cb.id_producto AND cb.moneda = 'ARS'
      LEFT JOIN Tipos_Producto tp ON pr.id_tipo_producto = tp.id_tipo_producto
      WHERE p.email = $1 AND p.password = $2 AND p.verificado = TRUE
      LIMIT 1
    `;
    const { rows } = await db.query(query, [email, password]);
    return rows[0] || null;
  },

  getByCbu: async (cbu) => {
    const query = `
      SELECT cb.id_cuenta, cb.saldo, cb.alias, cb.cbu,
             p.nombre, p.apellido, p.id AS id_persona, p.dni
      FROM Cuentas_Bancarias cb
      JOIN Productos pr ON cb.id_producto = pr.id_producto
      JOIN Personas p ON pr.id_persona = p.id
      WHERE cb.cbu = $1
    `;
    const { rows } = await db.query(query, [cbu]);
    return rows[0] || null;
  },

  updateSaldo: async (cbu, nuevoSaldo) => {
    await db.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE cbu = $2', [nuevoSaldo, cbu]);
  },

  updateAlias: async (cbu, nuevoAlias) => {
    await db.query('UPDATE Cuentas_Bancarias SET alias = $1 WHERE cbu = $2', [nuevoAlias, cbu]);
  },

  getDni: async (idPersona) => {
    const { rows } = await db.query('SELECT dni FROM Personas WHERE id = $1', [idPersona]);
    return rows[0]?.dni || null;
  },

  getDatosBasicos: async (idPersona) => {
    const { rows } = await db.query('SELECT dni, nombre, apellido FROM Personas WHERE id = $1', [idPersona]);
    return rows[0] || null;
  },

  // Verifica que dni/telefono/email coincidan exactamente con los datos ya registrados de esa persona
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

  // Crea la caja de ahorro en USD localmente (la cuenta ya fue abierta en el Banco Central antes de llamar esto)
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

  // Compra o vende USD moviendo saldo entre la caja ARS y la caja USD de la misma persona
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

      let nuevoArs, nuevoUsd, importeArs;
      if (direccion === 'compra') {
        importeArs = importeUsd * tasaVenta;
        if (Number(ars.saldo) < importeArs) throw Object.assign(new Error('Saldo insuficiente en ARS'), { code: 'SALDO_INSUFICIENTE' });
        nuevoArs = Number(ars.saldo) - importeArs;
        nuevoUsd = Number(usd.saldo) + importeUsd;
      } else {
        importeArs = importeUsd * tasaCompra;
        if (Number(usd.saldo) < importeUsd) throw Object.assign(new Error('Saldo insuficiente en USD'), { code: 'SALDO_INSUFICIENTE' });
        nuevoArs = Number(ars.saldo) + importeArs;
        nuevoUsd = Number(usd.saldo) - importeUsd;
      }
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoArs, ars.id_cuenta]);
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoUsd, usd.id_cuenta]);
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

  // Se usa al sincronizar el lote de transacciones que llegan del Banco Central en cada poll de
  // /api/historial. Antes se procesaba una por una (una conexión + varias consultas cada una, incluso
  // para las cientos que ya conocíamos de polls anteriores) y eso volvía la carga del historial muy
  // lenta. Ahora: 1) inserta todo el lote en una sola sentencia, ON CONFLICT DO NOTHING así las que ya
  // existían no vuelven a tocarse; 2) de las que resultaron genuinamente nuevas, en un solo query
  // adicional averigua cuáles NO vinieron de una cuenta propia (o sea, llegaron de otro banco) y
  // recién a esas les acredita el saldo — así nunca se acredita una transferencia tuo→tuo dos veces
  // (esas ya se acreditan al toque en transferir()) ni se vuelve a acreditar algo ya visto.
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
         RETURNING tx_id, cbu_origen, cbu_destino, importe, estado`,
        params
      );

      const aprobadas = nuevas.filter(r => r.estado === 'aprobada');
      if (aprobadas.length > 0) {
        const origenes = [...new Set(aprobadas.map(r => r.cbu_origen))];
        const { rows: locales } = await client.query('SELECT cbu FROM Cuentas_Bancarias WHERE cbu = ANY($1)', [origenes]);
        const setLocales = new Set(locales.map(r => r.cbu));
        for (const r of aprobadas) {
          if (!setLocales.has(r.cbu_origen)) {
            // El origen no es una cuenta nuestra: vino de otro banco. Acreditamos al destino.
            await client.query('UPDATE Cuentas_Bancarias SET saldo = saldo + $1 WHERE cbu = $2', [r.importe, r.cbu_destino]);
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  getAllTransacciones: async () => {
    const { rows } = await db.query('SELECT * FROM Transacciones ORDER BY created_at DESC');
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

  verificarPassword: async (email, password) => {
    const { rows } = await db.query(
      `SELECT p.id FROM Personas p
       WHERE LOWER(p.email) = LOWER($1) AND p.password = $2`,
      [email, password]
    );
    return !!rows[0];
  },

  generarTokenPassword: async (email) => {
    const token = crypto.randomInt(100000, 999999).toString();
    const expira = new Date(Date.now() + 5 * 60 * 1000);
    const { rows } = await db.query(
      `UPDATE Personas SET token_verificacion = $1, token_expira = $2
       WHERE LOWER(email) = LOWER($3)
       RETURNING nombre`,
      [token, expira, email]
    );
    if (!rows[0]) return null;
    return { nombre: rows[0].nombre, token };
  },

  verificarTokenPassword: async (email, token) => {
    const { rows } = await db.query(
      `SELECT id, token_expira FROM Personas
       WHERE LOWER(email) = LOWER($1) AND token_verificacion = $2`,
      [email, token]
    );
    if (rows.length === 0) return { ok: false, motivo: 'Código incorrecto' };
    if (new Date() > new Date(rows[0].token_expira)) return { ok: false, motivo: 'El código expiró. Solicitá uno nuevo.' };
    return { ok: true };
  },

  updatePassword: async (email, newPassword) => {
    await db.query(
      `UPDATE Personas
       SET password = $1, token_verificacion = NULL, token_expira = NULL
       WHERE LOWER(email) = LOWER($2)`,
      [newPassword, email]
    );
  },

  reenviarToken: async (email) => {
    const token = crypto.randomInt(100000, 999999).toString();
    const expira = new Date(Date.now() + 5 * 60 * 1000);
    const { rows } = await db.query(
      `UPDATE Personas SET token_verificacion = $1, token_expira = $2
       WHERE email = $3 AND verificado = FALSE
       RETURNING nombre, token_verificacion AS token`,
      [token, expira, email]
    );
    return rows[0] || null;
  },

  verificarToken: async (email, token) => {
    const { rows } = await db.query(
      'SELECT id, token_expira FROM Personas WHERE email = $1 AND token_verificacion = $2',
      [email, token]
    );
    if (rows.length === 0) return { ok: false, motivo: 'Código incorrecto' };
    if (new Date() > new Date(rows[0].token_expira)) return { ok: false, motivo: 'El código expiró. Registrate de nuevo.' };
    await db.query(
      'UPDATE Personas SET verificado = TRUE, token_verificacion = NULL, token_expira = NULL WHERE id = $1',
      [rows[0].id]
    );
    return { ok: true };
  },

  // Registrar persona con cuenta bancaria (CBU del Banco Central)
  registrarConCuenta: async (data) => {
    const { nombre, apellido, dni, email, telefono, fecha_nac, domicilio, cbu, alias, password } = data;

    // 1. Crear usuario en Supabase Auth (aparece en el panel de Autenticación)
    const authRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password, email_confirm: true })
    });

    if (!authRes.ok) {
      const authError = await authRes.json();
      throw new Error(authError.message || 'Error al crear usuario en Supabase Auth');
    }

    const authUser = await authRes.json();

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 2. Insertar persona en la tabla Personas
      const personaResult = await client.query(
        `INSERT INTO Personas (nombre, apellido, dni, email, telefono, fecha_nac, direccion, password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [nombre, apellido, dni, email, telefono, fecha_nac, domicilio, password]
      );
      const persona = personaResult.rows[0];

      // 3. Crear producto (Caja de Ahorro) - id_tipo_producto = 1, id_estado_producto = 1
      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto)
         VALUES ($1, 1, 1) RETURNING *`,
        [persona.id]
      );
      const producto = productoResult.rows[0];

      // 4. Crear cuenta bancaria con CBU y alias
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
      // Si la transacción DB falló, eliminar el usuario de Auth para no dejar huérfanos
      await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
        method: 'DELETE',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = Persona;
