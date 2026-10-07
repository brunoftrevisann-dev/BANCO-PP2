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

// Pago mínimo del resumen: 10% de lo que vence con un piso de $1.000 (o el total si es menor).
const pagoMinimo = (aPagar) => round2(Math.min(Number(aPagar), Math.max(Number(aPagar) * 0.10, 1000)));

const err = (msg, code) => Object.assign(new Error(msg), { code });

// Compra en cuotas: 1 cuota sin interés; 3, 6 y 12 con la TNA de tarjetas, en sistema francés
// (cuota fija, mismo cálculo que Préstamos). La deuda suma el total con interés incluido.
function calcularFinanciacion(monto, cuotas, tna) {
  const n = Number(cuotas);
  const tnaAplicada = n > 1 ? Number(tna) : 0;
  const i = tnaAplicada / 12;
  const cuota = i === 0 ? monto / n : (monto * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
  const montoCuota = round2(cuota);
  const total = round2(montoCuota * n);
  return { tna: tnaAplicada, montoCuota, total, interes: round2(total - monto) };
}

// Cuotas que todavía no vencieron (de compras en cuotas): no entran en el resumen del mes
// aunque ya ocupen límite. La primera cuota vence en el resumen del mes de la compra.
async function pendienteEnCuotas(client, idProducto) {
  const { rows } = await client.query(
    `SELECT monto, cuotas, monto_cuota, created_at FROM Consumos_Tarjeta
     WHERE id_producto = $1 AND tipo = 'COMPRA' AND cuotas > 1
       AND created_at > NOW() - INTERVAL '13 months'`,
    [idProducto]
  );
  const hoy = new Date();
  let pendiente = 0;
  for (const c of rows) {
    const f = new Date(c.created_at);
    const meses = (hoy.getFullYear() - f.getFullYear()) * 12 + (hoy.getMonth() - f.getMonth());
    const vencidas = Math.min(c.cuotas, meses + 1);
    const montoCuota = c.monto_cuota !== null ? Number(c.monto_cuota) : Number(c.monto) / c.cuotas;
    pendiente += (c.cuotas - vencidas) * montoCuota;
  }
  return round2(pendiente);
}

// Devenga el interés del saldo financiado (lo que quedó sin pagar del resumen) desde la última
// vez, a la TNA de tarjetas — mismo criterio "lazy" que los frascos de Reservas: se calcula al
// leer u operar, sin cron. Recibe la fila de la tarjeta ya lockeada y la devuelve actualizada.
async function devengarInteres(client, t, tna) {
  const { rows } = await client.query(
    `SELECT (CURRENT_DATE - COALESCE(fecha_ultimo_interes, CURRENT_DATE)) AS dias FROM Tarjetas_Credito WHERE id_tarjeta = $1`,
    [t.id_tarjeta]
  );
  const dias = Number(rows[0].dias);
  if (!(Number(t.saldo_financiado) > 0) || dias <= 0) return t;

  const interes = round2(Number(t.saldo_financiado) * Number(tna) * dias / 365);
  if (interes <= 0) return t;
  const upd = await client.query(
    `UPDATE Tarjetas_Credito SET deuda = deuda + $1, saldo_financiado = saldo_financiado + $1, fecha_ultimo_interes = CURRENT_DATE
     WHERE id_tarjeta = $2 RETURNING deuda, saldo_financiado`,
    [interes, t.id_tarjeta]
  );
  await client.query(
    `INSERT INTO Consumos_Tarjeta (id_producto, tipo, comercio, monto, cuotas, tna)
     VALUES ($1, 'INTERES', $2, $3, 1, $4)`,
    [t.id_producto, `Intereses por saldo financiado (${dias} ${dias === 1 ? 'día' : 'días'})`, interes, tna]
  );
  return { ...t, deuda: upd.rows[0].deuda, saldo_financiado: upd.rows[0].saldo_financiado };
}

async function resumenCredito(client, t) {
  const pendiente = await pendienteEnCuotas(client, t.id_producto);
  const aPagar = round2(Math.max(0, Number(t.deuda) - pendiente));
  return {
    a_pagar: aPagar,
    cuotas_pendientes: round2(Math.min(pendiente, Number(t.deuda))),
    pago_minimo: pagoMinimo(aPagar),
    disponible: round2(Math.max(0, Number(t.limite_compra) - Number(t.deuda)))
  };
}

const SELECT_CREDITO_LOCK = `
  SELECT tc.*, ep.nombre AS estado
  FROM Tarjetas_Credito tc
  JOIN Productos pr ON tc.id_producto = pr.id_producto
  JOIN Estados_Producto ep ON pr.id_estado_producto = ep.id_estado_producto
  WHERE pr.id_persona = $1 AND ep.nombre != 'CERRADO'
  ORDER BY tc.id_tarjeta DESC LIMIT 1
  FOR UPDATE OF tc`;

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
  calcularFinanciacion,

  // Devuelve las tarjetas de la persona (a lo sumo una de cada tipo) con el estado del producto.
  // En crédito, antes de devolverla devenga el interés pendiente del saldo financiado.
  getTarjetasPersona: async (idPersona, tna) => {
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
    let tc = null;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(SELECT_CREDITO_LOCK, [idPersona]);
      if (rows[0]) {
        const t = await devengarInteres(client, rows[0], tna);
        tc = { ...t, ...(await resumenCredito(client, t)) };
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { debito: debito.rows[0] || null, credito: tc };
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

  // Compra con crédito: no toca la cuenta, consume límite disponible por el total financiado
  // (capital + interés de las cuotas, aunque se pague mes a mes — igual que una tarjeta real).
  // La TNA la pasa el controller, recién obtenida del BCRA: nunca viene del cliente.
  compraCredito: async (idPersona, { comercio, monto, cuotas, tna }) => {
    if (!(Number(monto) >= MONTO_MINIMO_COMPRA)) throw err('Monto inválido', 'MONTO_INVALIDO');
    if (!CUOTAS_PERMITIDAS.includes(Number(cuotas))) throw err(`Las cuotas deben ser ${CUOTAS_PERMITIDAS.join(', ')}`, 'CUOTAS_INVALIDAS');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(SELECT_CREDITO_LOCK, [idPersona]);
      if (!rows[0]) throw err('No tenés tarjeta de crédito', 'NO_TARJETA');
      if (rows[0].estado !== ESTADO_ACTIVO) throw err('Tu tarjeta de crédito está bloqueada', 'BLOQUEADA');
      const t = await devengarInteres(client, rows[0], tna);

      const fin = calcularFinanciacion(Number(monto), Number(cuotas), tna);
      const disponible = Number(t.limite_compra) - Number(t.deuda);
      if (disponible < fin.total) throw err('Límite disponible insuficiente', 'LIMITE_INSUFICIENTE');

      const nuevaDeuda = round2(Number(t.deuda) + fin.total);
      await client.query('UPDATE Tarjetas_Credito SET deuda = $1 WHERE id_tarjeta = $2', [nuevaDeuda, t.id_tarjeta]);
      const mov = await client.query(
        `INSERT INTO Consumos_Tarjeta (id_producto, tipo, comercio, monto, cuotas, monto_cuota, total, tna)
         VALUES ($1, 'COMPRA', $2, $3, $4, $5, $6, $7) RETURNING *`,
        [t.id_producto, comercio, Number(monto), Number(cuotas), fin.montoCuota, fin.total, fin.tna]
      );

      const resumen = await resumenCredito(client, { ...t, deuda: nuevaDeuda });
      await client.query('COMMIT');
      return { movimiento: mov.rows[0], financiacion: fin, deuda: nuevaDeuda, ...resumen };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Pago del resumen de crédito desde la caja de ahorro en ARS: libera límite. Se puede pagar
  // hasta la deuda total (adelantando cuotas). Lo que quede sin pagar del resumen del mes pasa
  // a ser saldo financiado y genera interés diario a la TNA de tarjetas.
  pagarCredito: async (idPersona, monto, tna) => {
    if (!(Number(monto) > 0)) throw err('Monto inválido', 'MONTO_INVALIDO');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(SELECT_CREDITO_LOCK, [idPersona]);
      if (!rows[0]) throw err('No tenés tarjeta de crédito', 'NO_TARJETA');
      const t = await devengarInteres(client, rows[0], tna);
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
      const resumen = await resumenCredito(client, { ...t, deuda: nuevaDeuda });
      await client.query(
        `UPDATE Tarjetas_Credito SET deuda = $1, saldo_financiado = $2, fecha_ultimo_interes = CURRENT_DATE WHERE id_tarjeta = $3`,
        [nuevaDeuda, resumen.a_pagar, t.id_tarjeta]
      );
      await client.query(
        `INSERT INTO Consumos_Tarjeta (id_producto, tipo, comercio, monto, cuotas)
         VALUES ($1, 'PAGO', 'Pago de resumen', $2, 1)`,
        [t.id_producto, Number(monto)]
      );

      await client.query('COMMIT');
      return { nuevoSaldo, deuda: nuevaDeuda, saldoFinanciado: resumen.a_pagar, ...resumen, cbu: cuenta.cbu };
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
