const db = require('../config/db');

const Prestamo = {
  // CBUs (ARS y USD si tiene) de una persona, para el cálculo de ingreso/egreso
  getCbusPersona: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT cb.cbu, cb.moneda
       FROM Cuentas_Bancarias cb
       JOIN Productos pr ON cb.id_producto = pr.id_producto
       WHERE pr.id_persona = $1`,
      [idPersona]
    );
    return rows;
  },

  // Ingreso mensual promedio de los últimos 6 meses (ARS + USD convertido a ARS con la
  // cotización MEP vigente). Deliberadamente NO resta los egresos: mide cuánto entra a las
  // cuentas propias (depósitos, transferencias recibidas), no un neto. Un gasto grande y
  // puntual (un traspaso de ahorros, comprar algo caro) no debería arruinar el cupo de
  // crédito por 6 meses — se parece más a cómo un banco real mide capacidad de pago
  // (el ingreso/sueldo declarado), no a un balance de caja. Transferencias entre las propias
  // cuentas (ej. cambio de divisa) no cuentan como ingreso: ambos lados son "propios".
  calcularIngresoPromedio: async (idPersona, tasaMepVenta) => {
    const cuentas = await Prestamo.getCbusPersona(idPersona);
    if (cuentas.length === 0) return 0;
    const cbus = cuentas.map(c => c.cbu);
    const monedaPorCbu = Object.fromEntries(cuentas.map(c => [c.cbu, c.moneda]));

    const { rows } = await db.query(
      `SELECT cbu_origen, cbu_destino, importe
       FROM Transacciones
       WHERE cbu_destino = ANY($1)
         AND estado = 'aprobada'
         AND created_at >= NOW() - INTERVAL '6 months'`,
      [cbus]
    );

    let ingresosArs = 0;
    for (const t of rows) {
      if (cbus.includes(t.cbu_origen)) continue; // viene de otra cuenta propia (ej. cambio de divisa): no cuenta
      if (t.cbu_origen === 'PRESTAMO') continue; // el otorgamiento de un préstamo no es "ingreso" — si contara,
      // pedir un préstamo inflaría el ingreso promedio y con eso el cupo para el próximo préstamo
      const moneda     = monedaPorCbu[t.cbu_destino] || 'ARS';
      const importeArs = moneda === 'USD' ? Number(t.importe) * tasaMepVenta : Number(t.importe);
      ingresosArs += importeArs;
    }
    return ingresosArs / 6;
  },

  // % de cuotas ya vencidas pagadas a tiempo o antes. null si nunca tuvo un préstamo
  // (para no penalizar a alguien sin historial en el cálculo del puntaje).
  calcularHistorialPagos: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (
                WHERE c.estado IN ('PAGADA', 'PAGADA_ANTICIPADA') AND c.fecha_pago::date <= c.fecha_vencimiento
              ) AS puntuales
       FROM Cuotas c
       JOIN Prestamos p ON c.id_prestamo = p.id_prestamo
       JOIN Productos prod ON p.id_producto = prod.id_producto
       WHERE prod.id_persona = $1 AND c.fecha_vencimiento <= CURRENT_DATE`,
      [idPersona]
    );
    const total = Number(rows[0]?.total || 0);
    if (total === 0) return null;
    return Number(rows[0].puntuales) / total;
  },

  // Crea el préstamo (Producto + Prestamo + todas sus Cuotas) en una sola transacción,
  // mismo patrón BEGIN/COMMIT que Persona.crearCuentaUsd en personaModel.js.
  crearPrestamoConCuotas: async (idPersona, { monto, plazoMeses, tna, cft, cuotaMonto, cuotas }) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const tipoResult = await client.query(`SELECT id_tipo_producto FROM Tipos_Producto WHERE nombre = 'PRESTAMO'`);
      const idTipoProducto = tipoResult.rows[0].id_tipo_producto;

      const productoResult = await client.query(
        `INSERT INTO Productos (id_persona, id_tipo_producto, id_estado_producto)
         VALUES ($1, $2, 1) RETURNING *`,
        [idPersona, idTipoProducto]
      );
      const idProducto = productoResult.rows[0].id_producto;

      const prestamoResult = await client.query(
        `INSERT INTO Prestamos (id_producto, monto, plazo_meses, tna, cft, cuota_monto)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [idProducto, monto, plazoMeses, tna, cft, cuotaMonto]
      );
      const idPrestamo = prestamoResult.rows[0].id_prestamo;

      // Acreditar el monto del préstamo en la caja de ahorro en ARS — sin esto el préstamo
      // se cobra en cuotas pero nunca se entregó la plata, algo que se nos pasó en la primera
      // versión y se detectó recién probando contra una cuenta real.
      const cuentaResult = await client.query(
        `UPDATE Cuentas_Bancarias cb SET saldo = saldo + $1
         FROM Productos pr
         WHERE cb.id_producto = pr.id_producto AND pr.id_persona = $2 AND cb.moneda = 'ARS'
         RETURNING cb.cbu, cb.saldo`,
        [monto, idPersona]
      );
      if (cuentaResult.rows.length === 0) {
        throw Object.assign(new Error('No se encontró tu caja de ahorro en ARS para acreditar el préstamo'), { code: 'NO_CUENTA' });
      }

      const cols = 6;
      const values = [];
      const params = [];
      cuotas.forEach((c, i) => {
        const base = i * cols;
        values.push(`(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(',')})`);
        params.push(idPrestamo, c.numero, c.capital, c.interes, c.monto, c.fechaVencimiento);
      });
      await client.query(
        `INSERT INTO Cuotas (id_prestamo, numero_cuota, capital, interes, monto, fecha_vencimiento)
         VALUES ${values.join(',')}`,
        params
      );

      await client.query('COMMIT');
      return { ...prestamoResult.rows[0], cbu: cuentaResult.rows[0].cbu, nuevoSaldo: Number(cuentaResult.rows[0].saldo) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Historial completo de préstamos de una persona (activos y cerrados), con progreso
  getPrestamosPersona: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo) AS total_cuotas,
              (SELECT COUNT(*) FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo
                 AND c.estado IN ('PAGADA', 'PAGADA_ANTICIPADA')) AS cuotas_pagadas,
              (SELECT MIN(c.fecha_vencimiento) FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo
                 AND c.estado IN ('PENDIENTE', 'VENCIDA')) AS proxima_fecha_vencimiento
       FROM Prestamos p
       JOIN Productos prod ON p.id_producto = prod.id_producto
       WHERE prod.id_persona = $1
       ORDER BY p.fecha_alta DESC`,
      [idPersona]
    );
    return rows;
  },

  getCuotasPrestamo: async (idPrestamo) => {
    const { rows } = await db.query(
      `SELECT * FROM Cuotas WHERE id_prestamo = $1 ORDER BY numero_cuota ASC`,
      [idPrestamo]
    );
    return rows;
  },

  // Un préstamo pertenece a la persona que lo pidió (para no dejar ver/operar el de otro)
  esDuenioPrestamo: async (idPrestamo, idPersona) => {
    const { rows } = await db.query(
      `SELECT 1 FROM Prestamos p
       JOIN Productos prod ON p.id_producto = prod.id_producto
       WHERE p.id_prestamo = $1 AND prod.id_persona = $2`,
      [idPrestamo, idPersona]
    );
    return rows.length > 0;
  },

  // La próxima cuota pendiente (de cualquier préstamo activo), para el banner del dashboard
  getProximaCuotaPersona: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT c.*, p.id_prestamo
       FROM Cuotas c
       JOIN Prestamos p ON c.id_prestamo = p.id_prestamo
       JOIN Productos prod ON p.id_producto = prod.id_producto
       WHERE prod.id_persona = $1 AND p.estado = 'ACTIVO' AND c.estado IN ('PENDIENTE', 'VENCIDA')
       ORDER BY c.fecha_vencimiento ASC
       LIMIT 1`,
      [idPersona]
    );
    return rows[0] || null;
  },

  // Cantidad de cuotas vencidas sin pagar, sumando todos los préstamos activos de la persona
  getCuotasVencidasPersona: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS vencidas
       FROM Cuotas c
       JOIN Prestamos p ON c.id_prestamo = p.id_prestamo
       JOIN Productos prod ON p.id_producto = prod.id_producto
       WHERE prod.id_persona = $1 AND p.estado = 'ACTIVO' AND c.estado = 'VENCIDA'`,
      [idPersona]
    );
    return Number(rows[0]?.vencidas || 0);
  },

  // Capital pendiente total (todos los préstamos activos) — lo que se reporta como "monto" al BC
  getMontoAdeudadoPersona: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(p.monto), 0) - COALESCE(SUM(cpag.capital_pagado), 0) AS monto_adeudado
       FROM Prestamos p
       JOIN Productos prod ON p.id_producto = prod.id_producto
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(capital), 0) AS capital_pagado
         FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo AND c.estado IN ('PAGADA', 'PAGADA_ANTICIPADA')
       ) cpag ON true
       WHERE prod.id_persona = $1 AND p.estado = 'ACTIVO'`,
      [idPersona]
    );
    return Number(rows[0]?.monto_adeudado || 0);
  },

  // Paga la próxima cuota pendiente (no se puede elegir una fuera de orden). Bloquea la cuenta
  // ARS y la cuota con FOR UPDATE, mismo patrón que Persona.cambiarDivisa en personaModel.js.
  pagarCuota: async (idPrestamo, idCuota, idPersona) => {
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

      const cuotaResult = await client.query(
        `SELECT c.* FROM Cuotas c
         JOIN Prestamos p ON c.id_prestamo = p.id_prestamo
         JOIN Productos prod ON p.id_producto = prod.id_producto
         WHERE c.id_cuota = $1 AND c.id_prestamo = $2 AND prod.id_persona = $3 FOR UPDATE`,
        [idCuota, idPrestamo, idPersona]
      );
      const cuota = cuotaResult.rows[0];
      if (!cuota) throw Object.assign(new Error('Cuota no encontrada'), { code: 'NO_CUOTA' });
      if (cuota.estado !== 'PENDIENTE' && cuota.estado !== 'VENCIDA')
        throw Object.assign(new Error('Esta cuota ya fue pagada o cancelada'), { code: 'CUOTA_INVALIDA' });

      const proximaResult = await client.query(
        `SELECT MIN(numero_cuota) AS proxima FROM Cuotas WHERE id_prestamo = $1 AND estado IN ('PENDIENTE', 'VENCIDA')`,
        [idPrestamo]
      );
      if (Number(proximaResult.rows[0].proxima) !== cuota.numero_cuota)
        throw Object.assign(new Error('Solo podés pagar la próxima cuota pendiente, no una fuera de orden'), { code: 'FUERA_DE_ORDEN' });

      if (Number(cuenta.saldo) < Number(cuota.monto))
        throw Object.assign(new Error('Saldo insuficiente'), { code: 'SALDO_INSUFICIENTE' });

      // cuota.fecha_vencimiento llega como objeto Date (columna DATE, pg lo parsea así), no
      // como string — concatenarle 'T23:59:59' con "+" llamaba a Date.toString() en vez de
      // toISOString(), daba una fecha inválida, y la comparación de abajo salía siempre false:
      // ninguna cuota se marcaba PAGADA_ANTICIPADA nunca, pagara cuando pagara.
      const finDelDiaVencimiento = new Date(cuota.fecha_vencimiento);
      finDelDiaVencimiento.setHours(23, 59, 59, 999);
      const pagadaAntes = new Date() < finDelDiaVencimiento;
      const nuevoEstado = pagadaAntes ? 'PAGADA_ANTICIPADA' : 'PAGADA';

      const nuevoSaldo = Number(cuenta.saldo) - Number(cuota.monto);
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoSaldo, cuenta.id_cuenta]);
      await client.query('UPDATE Cuotas SET estado = $1, fecha_pago = NOW() WHERE id_cuota = $2', [nuevoEstado, idCuota]);

      const restantesResult = await client.query(
        `SELECT COUNT(*) AS restantes FROM Cuotas WHERE id_prestamo = $1 AND estado IN ('PENDIENTE', 'VENCIDA')`,
        [idPrestamo]
      );
      const saldado = Number(restantesResult.rows[0].restantes) === 0;
      if (saldado) {
        await client.query(`UPDATE Prestamos SET estado = 'SALDADO' WHERE id_prestamo = $1`, [idPrestamo]);
      }

      await client.query('COMMIT');
      return { cbu: cuenta.cbu, monto: Number(cuota.monto), nuevoSaldo, saldado };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Cancelación anticipada total: solo se cobra el capital pendiente, sin los intereses
  // de las cuotas futuras (sin comisión, default v1). Marca todas las cuotas restantes
  // como CANCELADA y el préstamo como CANCELADO.
  cancelarAnticipado: async (idPrestamo, idPersona) => {
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

      const prestamoResult = await client.query(
        `SELECT p.* FROM Prestamos p
         JOIN Productos prod ON p.id_producto = prod.id_producto
         WHERE p.id_prestamo = $1 AND prod.id_persona = $2 FOR UPDATE`,
        [idPrestamo, idPersona]
      );
      const prestamo = prestamoResult.rows[0];
      if (!prestamo) throw Object.assign(new Error('Préstamo no encontrado'), { code: 'NO_PRESTAMO' });
      if (prestamo.estado !== 'ACTIVO')
        throw Object.assign(new Error('Este préstamo ya no está activo'), { code: 'PRESTAMO_INACTIVO' });

      const capitalPagadoResult = await client.query(
        `SELECT COALESCE(SUM(capital), 0) AS pagado FROM Cuotas
         WHERE id_prestamo = $1 AND estado IN ('PAGADA', 'PAGADA_ANTICIPADA')`,
        [idPrestamo]
      );
      const capitalPendiente = Number(prestamo.monto) - Number(capitalPagadoResult.rows[0].pagado);
      if (capitalPendiente <= 0)
        throw Object.assign(new Error('Este préstamo ya está saldado'), { code: 'YA_SALDADO' });
      if (Number(cuenta.saldo) < capitalPendiente)
        throw Object.assign(new Error('Saldo insuficiente para cancelar'), { code: 'SALDO_INSUFICIENTE' });

      const nuevoSaldo = Number(cuenta.saldo) - capitalPendiente;
      await client.query('UPDATE Cuentas_Bancarias SET saldo = $1 WHERE id_cuenta = $2', [nuevoSaldo, cuenta.id_cuenta]);
      await client.query(
        `UPDATE Cuotas SET estado = 'CANCELADA' WHERE id_prestamo = $1 AND estado IN ('PENDIENTE', 'VENCIDA')`,
        [idPrestamo]
      );
      await client.query(
        `UPDATE Prestamos SET estado = 'CANCELADO', fecha_cancelacion = NOW() WHERE id_prestamo = $1`,
        [idPrestamo]
      );

      await client.query('COMMIT');
      return { cbu: cuenta.cbu, monto: capitalPendiente, nuevoSaldo };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Usado por el cron: cuotas que vencen en exactamente 3 días, todavía pendientes,
  // con los datos de la persona para el mail de recordatorio.
  getCuotasPorVencerEn3Dias: async () => {
    const { rows } = await db.query(
      `SELECT c.*, per.id AS id_persona, per.email, per.nombre, per.dni
       FROM Cuotas c
       JOIN Prestamos p ON c.id_prestamo = p.id_prestamo
       JOIN Productos prod ON p.id_producto = prod.id_producto
       JOIN Personas per ON prod.id_persona = per.id
       WHERE c.estado = 'PENDIENTE'
         AND c.fecha_vencimiento = CURRENT_DATE + INTERVAL '3 days'
         AND p.estado = 'ACTIVO'`
    );
    return rows;
  },

  // Usado por el cron: marca como VENCIDA cualquier cuota PENDIENTE cuya fecha ya pasó,
  // y devuelve los datos necesarios para mandar el mail + reportar al Banco Central.
  marcarCuotasVencidasYObtener: async () => {
    const { rows } = await db.query(
      `UPDATE Cuotas c SET estado = 'VENCIDA'
       FROM Prestamos p, Productos prod, Personas per
       WHERE c.id_prestamo = p.id_prestamo AND p.id_producto = prod.id_producto AND prod.id_persona = per.id
         AND c.estado = 'PENDIENTE' AND c.fecha_vencimiento < CURRENT_DATE AND p.estado = 'ACTIVO'
       RETURNING c.*, per.id AS id_persona, per.email, per.nombre, per.dni`
    );
    return rows;
  }
};

module.exports = Prestamo;
