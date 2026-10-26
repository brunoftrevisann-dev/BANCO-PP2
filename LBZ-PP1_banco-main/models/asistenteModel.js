const db = require('../config/db');

// Todo es de solo lectura y filtra por idPersona: la IA nunca puede ver datos de otra cuenta.

const Asistente = {
  obtenerCuentas: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT cb.moneda, cb.saldo, cb.cbu, cb.alias
       FROM Cuentas_Bancarias cb
       JOIN Productos pr ON cb.id_producto = pr.id_producto
       WHERE pr.id_persona = $1`,
      [idPersona]
    );
    const ars = rows.find(r => r.moneda === 'ARS');
    const usd = rows.find(r => r.moneda === 'USD');
    return {
      ars: ars ? { saldo: Number(ars.saldo), cbu: ars.cbu, alias: ars.alias } : null,
      usd: usd ? { saldo: Number(usd.saldo), cbu: usd.cbu, alias: usd.alias } : null
    };
  },

  buscarMovimientos: async (idPersona, limite = 10) => {
    const cuentasResult = await db.query(
      `SELECT cb.cbu, cb.moneda
       FROM Cuentas_Bancarias cb
       JOIN Productos pr ON cb.id_producto = pr.id_producto
       WHERE pr.id_persona = $1`,
      [idPersona]
    );
    const cbus = cuentasResult.rows.map(c => c.cbu);
    if (cbus.length === 0) return [];
    const monedaPorCbu = Object.fromEntries(cuentasResult.rows.map(c => [c.cbu, c.moneda]));

    const tope = Math.max(1, Math.min(Number(limite) || 10, 30));
    const { rows } = await db.query(
      `SELECT cbu_origen, cbu_destino, importe, estado, descripcion, tipo, created_at
       FROM Transacciones
       WHERE (cbu_origen = ANY($1) OR cbu_destino = ANY($1)) AND estado = 'aprobada'
       ORDER BY created_at DESC
       LIMIT $2`,
      [cbus, tope]
    );

    return rows.map(t => {
      const esEgreso = cbus.includes(t.cbu_origen);
      return {
        fecha: t.created_at,
        importe: Number(t.importe),
        moneda: monedaPorCbu[esEgreso ? t.cbu_origen : t.cbu_destino] || 'ARS',
        direccion: esEgreso ? 'egreso' : 'ingreso',
        tipo: t.tipo || 'transferencia',
        descripcion: t.descripcion || null
      };
    });
  },

  obtenerPrestamosActivos: async (idPersona) => {
    const { rows } = await db.query(
      `SELECT p.id_prestamo, p.monto, p.plazo_meses, p.cuota_monto, p.estado,
              (SELECT COUNT(*) FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo) AS total_cuotas,
              (SELECT COUNT(*) FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo
                 AND c.estado IN ('PAGADA', 'PAGADA_ANTICIPADA')) AS cuotas_pagadas,
              (SELECT MIN(c.fecha_vencimiento) FROM Cuotas c WHERE c.id_prestamo = p.id_prestamo
                 AND c.estado IN ('PENDIENTE', 'VENCIDA')) AS proxima_fecha_vencimiento
       FROM Prestamos p
       JOIN Productos prod ON p.id_producto = prod.id_producto
       WHERE prod.id_persona = $1 AND p.estado = 'ACTIVO'
       ORDER BY p.fecha_alta DESC`,
      [idPersona]
    );
    return rows.map(r => ({
      idPrestamo: r.id_prestamo,
      monto: Number(r.monto),
      plazoMeses: r.plazo_meses,
      cuotaMonto: Number(r.cuota_monto),
      totalCuotas: Number(r.total_cuotas),
      cuotasPagadas: Number(r.cuotas_pagadas),
      proximaFechaVencimiento: r.proxima_fecha_vencimiento
    }));
  },

  // Devuelve la cantidad usada hoy, ya contando este mensaje.
  registrarUsoDiario: async (idPersona) => {
    const { rows } = await db.query(
      `INSERT INTO Asistente_Uso (id_persona, fecha, cantidad)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (id_persona, fecha) DO UPDATE SET cantidad = Asistente_Uso.cantidad + 1
       RETURNING cantidad`,
      [idPersona]
    );
    return Number(rows[0].cantidad);
  }
};

module.exports = Asistente;
