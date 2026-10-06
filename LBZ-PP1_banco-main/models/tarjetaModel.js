const db = require('../config/db');
const crypto = require('crypto');

// Límite de compra con el que se emite toda tarjeta de crédito nueva. No hay scoring propio
// todavía, así que es un valor fijo (igual que los montos mínimos de Reservas).
const LIMITE_CREDITO_INICIAL = 500000;
const MONTO_MINIMO_COMPRA = 1;
const CUOTAS_PERMITIDAS = [1, 3, 6, 12];
const ESTADO_ACTIVO = 'ACTIVO';
const ESTADO_BLOQUEADO = 'BLOQUEADO';

// BIN propio de tuo para cada producto (ficticios, solo tienen que ser de la marca correcta:
// 4 = Visa, 5 = Mastercard) + dígitos al azar + dígito verificador de Luhn, así el número
// pasa la validación de cualquier formulario de tarjeta.
const BIN = { DEBITO: '451761', CREDITO: '527504' };

function digitoLuhn(parcial) {
  let suma = 0;
  for (let i = 0; i < parcial.length; i++) {
    let d = Number(parcial[parcial.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
  }
  return String((10 - (suma % 10)) % 10);
}

function generarNumero(tipo) {
  let parcial = BIN[tipo];
  while (parcial.length < 15) parcial += crypto.randomInt(0, 10);
  return parcial + digitoLuhn(parcial);
}

const generarCvv = () => String(crypto.randomInt(0, 1000)).padStart(3, '0');

const round2 = (v) => Math.round(v * 100) / 100;

// Pago mínimo del resumen: 10% de la deuda con un piso de $1.000 (o la deuda entera si es menor).
const pagoMinimo = (deuda) => round2(Math.min(Number(deuda), Math.max(Number(deuda) * 0.10, 1000)));

const err = (msg, code) => Object.assign(new Error(msg), { code });

async function idTipoProducto(client, nombre) {
  const { rows } = await client.query(`SELECT id_tipo_producto FROM Tipos_Producto WHERE nombre = $1`, [nombre]);
  return rows[0].id_tipo_producto;
}

async function idEstadoProducto(client, nombre) {
  const { rows } = await client.query(`SELECT id_estado_producto FROM Estados_Producto WHERE nombre = $1`, [nombre]);
  return rows[0].id_estado_producto;
}

// Inserta con un número nuevo; si choca con el UNIQUE (casi imposible, pero posible) reintenta.
async function insertarConNumeroUnico(client, tipo, insertar) {
  for (let intento = 0; intento < 5; intento++) {
    const numero = generarNumero(tipo);
    await client.query('SAVEPOINT num_tarjeta');
    try {
      const r = await insertar(numero);
      await client.query('RELEASE SAVEPOINT num_tarjeta');
      return r;
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT num_tarjeta');
      if (e.code !== '23505') throw e;
    }
  }
  throw new Error('No se pudo generar un número de tarjeta único');
}

const Tarjeta = {
  LIMITE_CREDITO_INICIAL,
  CUOTAS_PERMITIDAS,
  pagoMinimo,

  // Devuelve las tarjetas de la persona (a lo sumo una de cada tipo) con el estado del producto.
  getTarjetasPersona: async (idPersona) => {
    const debito = await db.query(
      `SELECT td.*, ep.nombre AS estado, cb.cbu, cb.saldo AS saldo_cuenta
       FROM Tarjetas_Debito td
       JOIN Productos pr ON td.id_producto = pr.id_producto
       JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
       JOIN Cuentas_Bancarias cb ON td.id_cuenta = cb.id_cuenta
       WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'
       ORDER BY td.id_tarjeta DESC LIMIT 1`,
      [idPersona]
    );
    const credito = await db.query(
      `SELECT tc.*, ep.nombre AS estado
       FROM Tarjetas_Credito tc
       JOIN Productos pr ON tc.id_producto = pr.id_producto
       JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
       WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'
       ORDER BY tc.id_tarjeta DESC LIMIT 1`,
      [idPersona]
    );
    const tc = credito.rows[0];
    if (tc) {
      tc.disponible = round2(Number(tc.limite_compra) - Number(tc.deuda));
      tc.pago_minimo = pagoMinimo(tc.deuda);
    }
    return { debito: debito.rows[0] || null, credito: tc || null };
  },

  emitirDebito: async (idPersona, nombreTitular) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const existente = await client.query(
        `SELECT 1 FROM Tarjetas_Debito td
         JOIN Productos pr ON td.id_producto = pr.id_producto
         JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
         WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'`,
        [idPersona]
      );
      if (existente.rows.length) throw err('Ya tenés una tarjeta de débito', 'YA_TIENE');

      const cuentaResult = await client.query(
        `SELECT cb.id_cuenta FROM Cuentas_Bancarias cb
         JOIN Productos pr ON cb.id_producto = pr.id_producto
         WHERE pr.id_persona = $1 AND cb.moneda = 'ARS'`,
        [idPersona]
      );
      const cuenta = cuentaResult.rows[0];
      if (!cuenta) throw err('No se encontró tu caja de ahorro en ARS', 'NO_CUENTA');

      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto) VALUES ($1, $2, $3) RETURNING id_producto`,
        [idPersona, await idTipoProducto(client, 'TARJETA_DEBITO'), await idEstadoProducto(client, ESTADO_ACTIVO)]
      );
      const idProducto = productoResult.rows[0].id_producto;

      const tarjeta = await insertarConNumeroUnico(client, 'DEBITO', async (numero) => {
        const { rows } = await client.query(
          `INSERT INTO Tarjetas_Debito (id_producto, id_cuenta, numero_tarjeta, marca, nombre_titular, fecha_vencimiento, cvv)
           VALUES ($1, $2, $3, 'Visa', $4, (date_trunc('month', CURRENT_DATE) + INTERVAL '5 years')::date, $5)
           RETURNING *`,
          [idProducto, cuenta.id_cuenta, numero, nombreTitular, generarCvv()]
        );
        return rows[0];
      });

      await client.query('COMMIT');
      return tarjeta;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  emitirCredito: async (idPersona, nombreTitular) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const existente = await client.query(
        `SELECT 1 FROM Tarjetas_Credito tc
         JOIN Productos pr ON tc.id_producto = pr.id_producto
         JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
         WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'`,
        [idPersona]
      );
      if (existente.rows.length) throw err('Ya tenés una tarjeta de crédito', 'YA_TIENE');

      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto) VALUES ($1, $2, $3) RETURNING id_producto`,
        [idPersona, await idTipoProducto(client, 'TARJETA_CREDITO'), await idEstadoProducto(client, ESTADO_ACTIVO)]
      );
      const idProducto = productoResult.rows[0].id_producto;

      const tarjeta = await insertarConNumeroUnico(client, 'CREDITO', async (numero) => {
        const { rows } = await client.query(
          `INSERT INTO Tarjetas_Credito (id_producto, numero_tarjeta, marca, nombre_titular, fecha_vencimiento, limite_compra, dia_cierre, cvv, deuda)
           VALUES ($1, $2, 'Mastercard', $3, (date_trunc('month', CURRENT_DATE) + INTERVAL '5 years')::date, $4, 25, $5, 0)
           RETURNING *`,
          [idProducto, numero, nombreTitular, LIMITE_CREDITO_INICIAL, generarCvv()]
        );
        return rows[0];
      });

      await client.query('COMMIT');
      return tarjeta;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Bloquear/desbloquear: cambia el estado del Producto (ACTIVO <-> BLOQUEADO). Una tarjeta
  // bloqueada rechaza compras, pero el resumen de crédito se puede seguir pagando.
  cambiarEstado: async (idPersona, tipo, bloquear) => {
    const tabla = tipo === 'CREDITO' ? 'Tarjetas_Credito' : 'Tarjetas_Debito';
    const { rows } = await db.query(
      `UPDATE Productos pr SET id_estado_producto = (SELECT id_estado_producto FROM Estados_Producto WHERE nombre = $3)
       FROM ${tabla} t, Estados_Producto ep
       WHERE t.id_producto = pr.id_producto AND pr.id_estado_producto = ep.id_estado_producto
         AND pr.id_persona = $1 AND ep.nombre = $2
       RETURNING pr.id_producto`,
      [idPersona, bloquear ? ESTADO_ACTIVO : ESTADO_BLOQUEADO, bloquear ? ESTADO_BLOQUEADO : ESTADO_ACTIVO]
    );
    if (!rows.length) throw err(bloquear ? 'No tenés una tarjeta activa para bloquear' : 'No tenés una tarjeta bloqueada', 'NO_TARJETA');
    return { estado: bloquear ? ESTADO_BLOQUEADO : ESTADO_ACTIVO };
  },

  // Compra con débito: sale directo del saldo de la caja de ahorro en ARS, en el momento.
  compraDebito: async (idPersona, { comercio, monto }) => {
    if (!(Number(monto) >= MONTO_MINIMO_COMPRA)) throw err('Monto inválido', 'MONTO_INVALIDO');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const tarjetaResult = await client.query(
        `SELECT td.id_tarjeta, td.id_producto, ep.nombre AS estado, cb.id_cuenta, cb.saldo, cb.cbu
         FROM Tarjetas_Debito td
         JOIN Productos pr ON td.id_producto = pr.id_producto
         JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
         JOIN Cuentas_Bancarias cb ON td.id_cuenta = cb.id_cuenta
         WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'
         FOR UPDATE OF cb`,
        [idPersona]
      );
      const t = tarjetaResult.rows[0];
      if (!t) throw err('No tenés tarjeta de débito', 'NO_TARJETA');
      if (t.estado !== ESTADO_ACTIVO) throw err('Tu tarjeta de débito está bloqueada', 'BLOQUEADA');
      if (Number(t.saldo) < Number(monto)) throw err('Saldo insuficiente', 'SALDO_INSUFICIENTE');

      const nuevoSaldo = round2(Number(t.saldo) - Number(monto));
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoSaldo, t.id_cuenta]);
      const mov = await client.query(
        `INSERT INTO Consumos_Tarjeta (id_producto, tipo, comercio, monto, cuotas)
         VALUES ($1, 'COMPRA', $2, $3, 1) RETURNING *`,
        [t.id_producto, comercio, Number(monto)]
      );

      await client.query('COMMIT');
      return { movimiento: mov.rows[0], nuevoSaldo, cbu: t.cbu };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Compra con crédito: no toca la cuenta, consume límite disponible (el total de la compra,
  // aunque sea en cuotas — igual que una tarjeta real) y suma a la deuda del resumen.
  compraCredito: async (idPersona, { comercio, monto, cuotas }) => {
    if (!(Number(monto) >= MONTO_MINIMO_COMPRA)) throw err('Monto inválido', 'MONTO_INVALIDO');
    if (!CUOTAS_PERMITIDAS.includes(Number(cuotas))) throw err(`Las cuotas deben ser ${CUOTAS_PERMITIDAS.join(', ')}`, 'CUOTAS_INVALIDAS');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const tarjetaResult = await client.query(
        `SELECT tc.id_tarjeta, tc.id_producto, tc.limite_compra, tc.deuda, ep.nombre AS estado
         FROM Tarjetas_Credito tc
         JOIN Productos pr ON tc.id_producto = pr.id_producto
         JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
         WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'
         FOR UPDATE OF tc`,
        [idPersona]
      );
      const t = tarjetaResult.rows[0];
      if (!t) throw err('No tenés tarjeta de crédito', 'NO_TARJETA');
      if (t.estado !== ESTADO_ACTIVO) throw err('Tu tarjeta de crédito está bloqueada', 'BLOQUEADA');
      const disponible = Number(t.limite_compra) - Number(t.deuda);
      if (disponible < Number(monto)) throw err('Límite disponible insuficiente', 'LIMITE_INSUFICIENTE');

      const nuevaDeuda = round2(Number(t.deuda) + Number(monto));
      await client.query('UPDATE Tarjetas_Credito SET deuda = $1 WHERE id_tarjeta = $2', [nuevaDeuda, t.id_tarjeta]);
      const mov = await client.query(
        `INSERT INTO Consumos_Tarjeta (id_producto, tipo, comercio, monto, cuotas)
         VALUES ($1, 'COMPRA', $2, $3, $4) RETURNING *`,
        [t.id_producto, comercio, Number(monto), Number(cuotas)]
      );

      await client.query('COMMIT');
      return { movimiento: mov.rows[0], deuda: nuevaDeuda, disponible: round2(Number(t.limite_compra) - nuevaDeuda) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Pago del resumen de crédito desde la caja de ahorro en ARS: libera límite.
  pagarCredito: async (idPersona, monto) => {
    if (!(Number(monto) > 0)) throw err('Monto inválido', 'MONTO_INVALIDO');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const tarjetaResult = await client.query(
        `SELECT tc.id_tarjeta, tc.id_producto, tc.limite_compra, tc.deuda
         FROM Tarjetas_Credito tc
         JOIN Productos pr ON tc.id_producto = pr.id_producto
         JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
         WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'
         FOR UPDATE OF tc`,
        [idPersona]
      );
      const t = tarjetaResult.rows[0];
      if (!t) throw err('No tenés tarjeta de crédito', 'NO_TARJETA');
      if (Number(t.deuda) <= 0) throw err('No tenés deuda para pagar', 'SIN_DEUDA');
      if (Number(monto) > Number(t.deuda)) throw err('El monto supera la deuda de la tarjeta', 'MONTO_SUPERA_DEUDA');

      const cuentaResult = await client.query(
        `SELECT cb.id_cuenta, cb.saldo, cb.cbu FROM Cuentas_Bancarias cb
         JOIN Productos pr ON cb.id_producto = pr.id_producto
         WHERE pr.id_persona = $1 AND cb.moneda = 'ARS' FOR UPDATE`,
        [idPersona]
      );
      const cuenta = cuentaResult.rows[0];
      if (!cuenta) throw err('No se encontró tu caja de ahorro en ARS', 'NO_CUENTA');
      if (Number(cuenta.saldo) < Number(monto)) throw err('Saldo insuficiente', 'SALDO_INSUFICIENTE');

      const nuevoSaldo = round2(Number(cuenta.saldo) - Number(monto));
      const nuevaDeuda = round2(Number(t.deuda) - Number(monto));
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoSaldo, cuenta.id_cuenta]);
      await client.query('UPDATE Tarjetas_Credito SET deuda = $1 WHERE id_tarjeta = $2', [nuevaDeuda, t.id_tarjeta]);
      await client.query(
        `INSERT INTO Consumos_Tarjeta (id_producto, tipo, comercio, monto, cuotas)
         VALUES ($1, 'PAGO', 'Pago de resumen', $2, 1)`,
        [t.id_producto, Number(monto)]
      );

      await client.query('COMMIT');
      return { nuevoSaldo, deuda: nuevaDeuda, disponible: round2(Number(t.limite_compra) - nuevaDeuda), cbu: cuenta.cbu };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  getMovimientos: async (idPersona, tipo) => {
    const tabla = tipo === 'CREDITO' ? 'Tarjetas_Credito' : 'Tarjetas_Debito';
    const { rows } = await db.query(
      `SELECT m.* FROM Consumos_Tarjeta m
       JOIN ${tabla} t ON m.id_producto = t.id_producto
       JOIN Productos pr ON t.id_producto = pr.id_producto
       WHERE pr.id_persona = $1
       ORDER BY m.created_at DESC LIMIT 50`,
      [idPersona]
    );
    return rows;
  }
};

module.exports = Tarjeta;
