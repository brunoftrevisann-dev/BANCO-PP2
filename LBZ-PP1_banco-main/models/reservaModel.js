const db = require('../config/db');
const crypto = require('crypto');
const Persona = require('./personaModel');
const { notificarReservaVencida } = require('../utils/notificaciones');

const MONTO_MINIMO = 1000;

const Reserva = {
  // Crea el producto + la reserva en una transacción, debitando la caja de ahorro en ARS.
  // Mismo patrón FOR UPDATE que Prestamo.pagarCuota: hay que leer el saldo actual para decidir
  // si alcanza, así que no se puede hacer con un UPDATE relativo sin lock.
  abrirReserva: async (idPersona, { tipo, monto, tna, plazoDias, plazoMeses, nombre }) => {
    if (Number(monto) < MONTO_MINIMO)
      throw Object.assign(new Error(`El monto mínimo es $${MONTO_MINIMO.toLocaleString('es-AR')}`), { code: 'MONTO_MINIMO' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const cuentaResult = await client.query(
        `SELECT cb.id_cuenta, cb.saldo, cb.cbu
         FROM Cuentas_Bancarias cb
         JOIN Productos pr ON cb.id_producto = pr.id_producto
         WHERE pr.id_persona = $1 AND cb.moneda = 'ARS' FOR UPDATE`,
        [idPersona]
      );
      const cuenta = cuentaResult.rows[0];
      if (!cuenta) throw Object.assign(new Error('No se encontró tu caja de ahorro en ARS'), { code: 'NO_CUENTA' });
      if (Number(cuenta.saldo) < Number(monto))
        throw Object.assign(new Error('Saldo insuficiente'), { code: 'SALDO_INSUFICIENTE' });

      const tipoResult = await client.query(`SELECT id_tipo_producto FROM Tipos_Producto WHERE nombre = 'RESERVA'`);
      const idTipoProducto = tipoResult.rows[0].id_tipo_producto;

      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto) VALUES ($1, $2, 1) RETURNING id_producto`,
        [idPersona, idTipoProducto]
      );
      const idProducto = productoResult.rows[0].id_producto;

      const fechaVencimiento = tipo === 'FRASCO'
        ? null
        : tipo === 'FIJO_MESES'
          ? `CURRENT_DATE + INTERVAL '${Number(plazoMeses)} months'`
          : `CURRENT_DATE + INTERVAL '${Number(plazoDias)} days'`;

      const reservaResult = await client.query(
        `INSERT INTO Reservas (id_producto, tipo, nombre, saldo, tna, plazo_dias, plazo_meses, fecha_vencimiento)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${fechaVencimiento ? fechaVencimiento : 'NULL'})
         RETURNING *`,
        [idProducto, tipo, nombre || null, Number(monto), tna, plazoDias || null, plazoMeses || null]
      );

      const nuevoSaldo = Number(cuenta.saldo) - Number(monto);
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoSaldo, cuenta.id_cuenta]);

      await client.query('COMMIT');
      return { ...reservaResult.rows[0], cbu: cuenta.cbu, nuevoSaldo };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Liquida (paga capital+interés) una reserva fija vencida. Se llama de a una, con su propio
  // FOR UPDATE, desde getReservasPersona — nunca se expone como endpoint propio.
  _liquidarFija: async (idReserva) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const reservaResult = await client.query(
        `SELECT r.*, prod.id_persona FROM Reservas r
         JOIN Productos prod ON r.id_producto = prod.id_producto
         WHERE r.id_reserva = $1 AND r.estado = 'ACTIVA' FOR UPDATE`,
        [idReserva]
      );
      const reserva = reservaResult.rows[0];
      if (!reserva) { await client.query('ROLLBACK'); return; }

      const diasResult = await client.query(
        `SELECT (fecha_vencimiento - fecha_alta::date) AS dias FROM Reservas WHERE id_reserva = $1`,
        [idReserva]
      );
      const dias = Number(diasResult.rows[0].dias);
      const interes = round2(Number(reserva.saldo) * Number(reserva.tna) * dias / 365);
      const montoFinal = Number(reserva.saldo) + interes;

      const cuentaResult = await client.query(
        `UPDATE Cuentas_Bancarias cb SET saldo = saldo + $1
         FROM Productos pr WHERE cb.id_producto = pr.id_producto AND pr.id_persona = $2 AND cb.moneda = 'ARS'
         RETURNING cb.cbu`,
        [montoFinal, reserva.id_persona]
      );
      await client.query(
        `UPDATE Reservas SET estado = 'LIQUIDADA', interes_pagado = $1 WHERE id_reserva = $2`,
        [interes, idReserva]
      );

      await client.query('COMMIT');

      const cbu = cuentaResult.rows[0]?.cbu;
      notificarReservaVencida(reserva.id_persona, { montoFinal, interes })
        .catch(e => console.error('Error creando notificación de reserva vencida:', e.message));
      if (cbu) {
        Persona.upsertTransaccion({
          _id: 'RESERVA-' + crypto.randomUUID(),
          cbuOrigen: 'RESERVA', cbuDestino: cbu,
          importe: montoFinal, estado: 'aprobada',
          descripcion: `Vencimiento de reserva (incluye $${interes.toLocaleString('es-AR')} de interés)`,
          tipo: 'vencimiento_reserva', createdAt: new Date().toISOString()
        }).catch(e => console.error('Error registrando vencimiento de reserva en el historial:', e.message));
      }

      return { idPersona: reserva.id_persona, tipo: reserva.tipo, montoFinal, interes };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Acredita al saldo del frasco el interés devengado desde la última vez que se tocó.
  _acreditarInteresFrasco: async (idReserva) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT *, (CURRENT_DATE - fecha_ultimo_interes) AS dias FROM Reservas
         WHERE id_reserva = $1 AND tipo = 'FRASCO' AND estado = 'ACTIVA' FOR UPDATE`,
        [idReserva]
      );
      const reserva = result.rows[0];
      if (!reserva || Number(reserva.dias) <= 0) { await client.query('ROLLBACK'); return; }

      const interes = round2(Number(reserva.saldo) * Number(reserva.tna) * Number(reserva.dias) / 365);
      await client.query(
        `UPDATE Reservas SET saldo = saldo + $1, interes_pagado = interes_pagado + $1, fecha_ultimo_interes = CURRENT_DATE
         WHERE id_reserva = $2`,
        [interes, idReserva]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Punto de entrada de lectura: antes de devolver la lista, liquida las fijas vencidas y
  // acredita el interés pendiente de los frascos — así el usuario siempre ve el estado real
  // sin necesidad de que corra ningún cron.
  getReservasPersona: async (idPersona) => {
    const { rows: pendientes } = await db.query(
      `SELECT r.id_reserva, r.tipo FROM Reservas r
       JOIN Productos prod ON r.id_producto = prod.id_producto
       WHERE prod.id_persona = $1 AND r.estado = 'ACTIVA'
         AND ((r.tipo != 'FRASCO' AND r.fecha_vencimiento <= CURRENT_DATE)
              OR (r.tipo = 'FRASCO' AND r.fecha_ultimo_interes < CURRENT_DATE))`,
      [idPersona]
    );
    for (const r of pendientes) {
      if (r.tipo === 'FRASCO') await Reserva._acreditarInteresFrasco(r.id_reserva);
      else await Reserva._liquidarFija(r.id_reserva);
    }

    const { rows } = await db.query(
      `SELECT r.* FROM Reservas r
       JOIN Productos prod ON r.id_producto = prod.id_producto
       WHERE prod.id_persona = $1
       ORDER BY r.fecha_alta DESC`,
      [idPersona]
    );
    return rows;
  },

  depositarFrasco: async (idPersona, idReserva, monto) => {
    if (Number(monto) < MONTO_MINIMO)
      throw Object.assign(new Error(`El monto mínimo es $${MONTO_MINIMO.toLocaleString('es-AR')}`), { code: 'MONTO_MINIMO' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const reservaResult = await client.query(
        `SELECT r.*, prod.id_persona FROM Reservas r
         JOIN Productos prod ON r.id_producto = prod.id_producto
         WHERE r.id_reserva = $1 AND prod.id_persona = $2 FOR UPDATE`,
        [idReserva, idPersona]
      );
      const reserva = reservaResult.rows[0];
      if (!reserva) throw Object.assign(new Error('Reserva no encontrada'), { code: 'NO_RESERVA' });
      if (reserva.tipo !== 'FRASCO' || reserva.estado !== 'ACTIVA')
        throw Object.assign(new Error('Esta reserva no admite depósitos'), { code: 'NO_ES_FRASCO' });

      const cuentaResult = await client.query(
        `SELECT id_cuenta, saldo FROM Cuentas_Bancarias cb
         JOIN Productos pr ON cb.id_producto = pr.id_producto
         WHERE pr.id_persona = $1 AND cb.moneda = 'ARS' FOR UPDATE`,
        [idPersona]
      );
      const cuenta = cuentaResult.rows[0];
      if (!cuenta) throw Object.assign(new Error('No se encontró tu caja de ahorro en ARS'), { code: 'NO_CUENTA' });
      if (Number(cuenta.saldo) < Number(monto))
        throw Object.assign(new Error('Saldo insuficiente'), { code: 'SALDO_INSUFICIENTE' });

      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [Number(cuenta.saldo) - Number(monto), cuenta.id_cuenta]);
      await client.query('UPDATE Reservas SET saldo = saldo + $1 WHERE id_reserva = $2', [Number(monto), idReserva]);

      await client.query('COMMIT');
      return { nuevoSaldoFrasco: Number(reserva.saldo) + Number(monto) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  retirarFrasco: async (idPersona, idReserva, monto) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const reservaResult = await client.query(
        `SELECT r.*, prod.id_persona FROM Reservas r
         JOIN Productos prod ON r.id_producto = prod.id_producto
         WHERE r.id_reserva = $1 AND prod.id_persona = $2 FOR UPDATE`,
        [idReserva, idPersona]
      );
      const reserva = reservaResult.rows[0];
      if (!reserva) throw Object.assign(new Error('Reserva no encontrada'), { code: 'NO_RESERVA' });
      if (reserva.tipo !== 'FRASCO' || reserva.estado !== 'ACTIVA')
        throw Object.assign(new Error('Esta reserva no admite retiros'), { code: 'NO_ES_FRASCO' });
      if (Number(reserva.saldo) < Number(monto))
        throw Object.assign(new Error('El frasco no tiene ese saldo'), { code: 'SALDO_INSUFICIENTE' });

      const cuentaResult = await client.query(
        `SELECT id_cuenta, saldo FROM Cuentas_Bancarias cb
         JOIN Productos pr ON cb.id_producto = pr.id_producto
         WHERE pr.id_persona = $1 AND cb.moneda = 'ARS' FOR UPDATE`,
        [idPersona]
      );
      const cuenta = cuentaResult.rows[0];
      if (!cuenta) throw Object.assign(new Error('No se encontró tu caja de ahorro en ARS'), { code: 'NO_CUENTA' });

      await client.query('UPDATE Reservas SET saldo = saldo - $1 WHERE id_reserva = $2', [Number(monto), idReserva]);
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [Number(cuenta.saldo) + Number(monto), cuenta.id_cuenta]);

      await client.query('COMMIT');
      return { nuevoSaldoFrasco: Number(reserva.saldo) - Number(monto), nuevoSaldoArs: Number(cuenta.saldo) + Number(monto) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

function round2(v) { return Math.round(v * 100) / 100; }

module.exports = Reserva;
