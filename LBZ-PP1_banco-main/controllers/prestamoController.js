const Prestamo = require('../models/prestamoModel');
const Persona = require('../models/personaModel');
const fetchBC = require('../utils/fetchConTimeout');
const { consultarSituacionBC, reportarSituacionBC, situacionPorVencidas } = require('../utils/centralDeudores');

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Reglas de negocio confirmadas con el usuario (ver memoria del proyecto, new_requirements_roadmap.md)
const REFERENCIA_INGRESO_MENSUAL = 1500000; // ARS/mes para los 60 puntos completos de capacidad de pago
const PISO_RECHAZO_MORA = 100000;           // monto máximo permitido igual con situación BC 3+
const TOPE_ABSOLUTO_PRESTAMO = 15000000;    // techo fijo de "tuo" (banco digital, entre lo que presta
                                             // una billetera virtual —Ualá $5-12M— y un banco tradicional
                                             // grande —$40-100M—) sin importar cuánto dé la fórmula por ingreso
const MULTIPLICADORES_BUCKET = { alto: 3, medio: 1.5, bajo: 0.5 };
const ORDEN_BUCKET = { bajo: 0, medio: 1, alto: 2 };
const peorBucket = (a, b) => (ORDEN_BUCKET[a] <= ORDEN_BUCKET[b] ? a : b);

async function obtenerTasaMepVenta() {
  try {
    const res = await fetchBC('https://dolarapi.com/v1/dolares/bolsa', {}, 8000);
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.venta) || 0;
  } catch {
    return 0;
  }
}

// Promedia la TNA de todos los bancos de api.argentinadatos.com para el plazo pedido
// (default confirmado con el usuario: promedio, no una entidad puntual).
async function calcularTasaReferencia(plazoMeses) {
  const res = await fetchBC('https://api.argentinadatos.com/v1/finanzas/creditos/prestamosPersonales', {}, 10000);
  if (!res.ok) throw new Error('No se pudo obtener la tasa de referencia de préstamos');
  const entidades = await res.json();
  const tnas = [];
  for (const e of entidades) {
    const bandas = e.metadata?.tasasPorPlazo;
    if (Array.isArray(bandas) && bandas.length) {
      const banda = bandas.find(b => plazoMeses >= b.plazoMinMeses && plazoMeses <= b.plazoMaxMeses);
      if (banda && typeof banda.tna === 'number') tnas.push(banda.tna);
    } else if (typeof e.tna === 'number') {
      tnas.push(e.tna);
    }
  }
  if (tnas.length === 0) throw new Error('No hay tasas disponibles para ese plazo');
  const tna = tnas.reduce((a, b) => a + b, 0) / tnas.length;
  return { tna, cft: null };
}

// Sistema francés: cuota fija, cada una con su desglose capital/interés (necesario para
// poder calcular después el pago de una cancelación anticipada).
function calcularAmortizacion(monto, tna, plazoMeses) {
  const i = tna / 12;
  const n = plazoMeses;
  const cuotaMonto = i === 0
    ? monto / n
    : (monto * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);

  const cuotas = [];
  let saldo = monto;
  const hoy = new Date();
  for (let k = 1; k <= n; k++) {
    const interes = saldo * i;
    let capital = cuotaMonto - interes;
    if (k === n) capital = saldo; // ajuste de redondeo: la última cuota cierra el saldo en $0
    const montoCuota = capital + interes;
    saldo -= capital;
    const fechaVencimiento = new Date(hoy.getFullYear(), hoy.getMonth() + k, hoy.getDate());
    cuotas.push({
      numero: k,
      capital: round2(capital),
      interes: round2(interes),
      monto: round2(montoCuota),
      fechaVencimiento: fechaVencimiento.toISOString().slice(0, 10)
    });
  }
  return { cuotaMonto: round2(cuotaMonto), cuotas };
}

// Puntaje interno (0-100) + tope externo de la Central de Deudores. montoSolicitado se usa
// solo para decidir un eventual rechazo directo en mora seria (situación 3+); pasar 0 al
// consultar el perfil "en general" (pantalla de perfil crediticio, sin un pedido concreto).
async function calcularPerfil(idPersona, montoSolicitado) {
  const dni = await Persona.getDni(idPersona);
  const tasaMep = await obtenerTasaMepVenta();
  const ingresoPromedioArs = await Prestamo.calcularIngresoPromedio(idPersona, tasaMep);
  const historial = await Prestamo.calcularHistorialPagos(idPersona);

  const puntosFinancieros = clamp((ingresoPromedioArs / REFERENCIA_INGRESO_MENSUAL) * 60, 0, 60);
  const puntosHistorial = historial === null ? 40 : clamp(historial * 40, 0, 40);
  const total = puntosFinancieros + puntosHistorial;
  const bucketInterno = total <= 40 ? 'bajo' : total <= 70 ? 'medio' : 'alto';

  let situacionBC = null;
  if (dni) {
    try {
      const data = await consultarSituacionBC(dni);
      situacionBC = data?.situacion ?? null;
    } catch {
      situacionBC = null; // Banco Central caído: seguimos solo con el puntaje interno
    }
  }

  let bucketFinal = bucketInterno;
  let rechazoDirecto = false;
  let motivoRechazo = null;
  if (situacionBC === 2) {
    bucketFinal = peorBucket(bucketInterno, 'medio');
  } else if (situacionBC >= 3) {
    bucketFinal = 'bajo';
    if (montoSolicitado > PISO_RECHAZO_MORA) {
      rechazoDirecto = true;
      motivoRechazo = `Tu situación en la Central de Deudores no permite aprobar montos mayores a $${PISO_RECHAZO_MORA.toLocaleString('es-AR')}`;
    }
  }

  const montoMaximo = Math.min(TOPE_ABSOLUTO_PRESTAMO, Math.max(0, round2(ingresoPromedioArs * MULTIPLICADORES_BUCKET[bucketFinal])));

  return {
    ingresoPromedioArs: round2(ingresoPromedioArs),
    puntosFinancieros: round2(puntosFinancieros),
    puntosHistorial: round2(puntosHistorial),
    total: round2(total),
    bucketInterno,
    situacionBC,
    bucketFinal,
    montoMaximo,
    rechazoDirecto,
    motivoRechazo
  };
}

exports.obtenerTasas = async (req, res) => {
  try {
    const plazoMeses = parseInt(req.query.plazo) || 12;
    const { tna, cft } = await calcularTasaReferencia(plazoMeses);
    res.json({ plazoMeses, tna, cft });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
};

exports.perfilCrediticio = async (req, res) => {
  try {
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    const perfil = await calcularPerfil(idPersona, 0);
    res.json(perfil);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.simular = async (req, res) => {
  try {
    const { idPersona, monto, plazoMeses } = req.body;
    if (!idPersona || !monto || !plazoMeses)
      return res.status(400).json({ error: 'idPersona, monto y plazoMeses son requeridos' });
    if (Number(monto) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    if (Number(plazoMeses) <= 0) return res.status(400).json({ error: 'El plazo debe ser mayor a 0' });

    const { tna, cft } = await calcularTasaReferencia(Number(plazoMeses));
    const { cuotaMonto, cuotas } = calcularAmortizacion(Number(monto), tna, Number(plazoMeses));
    const totalAPagar = round2(cuotas.reduce((s, c) => s + c.monto, 0));
    const perfil = await calcularPerfil(idPersona, Number(monto));

    res.json({
      cuotaMensual: cuotaMonto,
      tna, cft, totalAPagar,
      excedeCupo: Number(monto) > perfil.montoMaximo,
      montoMaximo: perfil.montoMaximo,
      bucket: perfil.bucketFinal
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.solicitar = async (req, res) => {
  try {
    const { idPersona, monto, plazoMeses } = req.body;
    if (!idPersona || !monto || !plazoMeses)
      return res.status(400).json({ error: 'idPersona, monto y plazoMeses son requeridos' });
    if (Number(monto) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    if (Number(plazoMeses) <= 0) return res.status(400).json({ error: 'El plazo debe ser mayor a 0' });

    // Nunca confiar en un cálculo hecho en el cliente: se re-evalúa todo acá.
    const perfil = await calcularPerfil(idPersona, Number(monto));
    if (perfil.rechazoDirecto) {
      return res.status(422).json({ error: perfil.motivoRechazo });
    }
    if (Number(monto) > perfil.montoMaximo) {
      return res.status(422).json({
        error: `El monto máximo disponible para vos es $${perfil.montoMaximo.toLocaleString('es-AR')}`,
        montoMaximo: perfil.montoMaximo
      });
    }

    const { tna, cft } = await calcularTasaReferencia(Number(plazoMeses));
    const { cuotaMonto, cuotas } = calcularAmortizacion(Number(monto), tna, Number(plazoMeses));

    const prestamo = await Prestamo.crearPrestamoConCuotas(idPersona, {
      monto: Number(monto), plazoMeses: Number(plazoMeses), tna, cft, cuotaMonto, cuotas
    });

    await Persona.upsertTransaccion({
      _id: 'PRESTAMO-' + require('crypto').randomUUID(),
      cbuOrigen: 'PRESTAMO',
      cbuDestino: prestamo.cbu,
      importe: Number(monto),
      estado: 'aprobada',
      descripcion: `Préstamo otorgado en ${plazoMeses} cuotas`,
      tipo: 'otorgamiento_prestamo',
      createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando otorgamiento de préstamo en el historial:', e.message));

    const dni = await Persona.getDni(idPersona);
    if (dni) {
      const montoAdeudado = await Prestamo.getMontoAdeudadoPersona(idPersona);
      reportarSituacionBC(dni, montoAdeudado, 1)
        .catch(e => console.error('Error reportando situación BC al otorgar préstamo:', e.message));
    }

    res.status(201).json(prestamo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listar = async (req, res) => {
  try {
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    const prestamos = await Prestamo.getPrestamosPersona(idPersona);
    res.json(prestamos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.proximaCuota = async (req, res) => {
  try {
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    const cuota = await Prestamo.getProximaCuotaPersona(idPersona);
    res.json(cuota);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.cuotas = async (req, res) => {
  try {
    const idPrestamo = parseInt(req.params.id);
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    if (!(await Prestamo.esDuenioPrestamo(idPrestamo, idPersona)))
      return res.status(404).json({ error: 'Préstamo no encontrado' });
    const cuotas = await Prestamo.getCuotasPrestamo(idPrestamo);
    res.json(cuotas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.pagarCuota = async (req, res) => {
  try {
    const idPrestamo = parseInt(req.params.id);
    const { idPersona, idCuota } = req.body;
    if (!idPersona || !idCuota) return res.status(400).json({ error: 'idPersona e idCuota son requeridos' });

    const resultado = await Prestamo.pagarCuota(idPrestamo, idCuota, idPersona);

    const dni = await Persona.getDni(idPersona);
    if (dni) {
      const vencidas = await Prestamo.getCuotasVencidasPersona(idPersona);
      const montoAdeudado = await Prestamo.getMontoAdeudadoPersona(idPersona);
      reportarSituacionBC(dni, montoAdeudado, situacionPorVencidas(vencidas))
        .catch(e => console.error('Error reportando situación BC al pagar cuota:', e.message));
    }

    await Persona.upsertTransaccion({
      _id: 'CUOTA-' + require('crypto').randomUUID(),
      cbuOrigen: resultado.cbu,
      cbuDestino: 'PRESTAMO',
      importe: resultado.monto,
      estado: 'aprobada',
      descripcion: 'Pago de cuota de préstamo',
      tipo: 'pago_cuota',
      createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando pago de cuota en el historial:', e.message));

    res.json(resultado);
  } catch (error) {
    if (['NO_CUENTA', 'NO_CUOTA', 'CUOTA_INVALIDA', 'FUERA_DE_ORDEN', 'SALDO_INSUFICIENTE'].includes(error.code))
      return res.status(422).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.cancelarAnticipado = async (req, res) => {
  try {
    const idPrestamo = parseInt(req.params.id);
    const { idPersona } = req.body;
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });

    const resultado = await Prestamo.cancelarAnticipado(idPrestamo, idPersona);

    const dni = await Persona.getDni(idPersona);
    if (dni) {
      const vencidas = await Prestamo.getCuotasVencidasPersona(idPersona);
      const montoAdeudado = await Prestamo.getMontoAdeudadoPersona(idPersona);
      reportarSituacionBC(dni, montoAdeudado, situacionPorVencidas(vencidas))
        .catch(e => console.error('Error reportando situación BC al cancelar préstamo:', e.message));
    }

    await Persona.upsertTransaccion({
      _id: 'CANCELACION-' + require('crypto').randomUUID(),
      cbuOrigen: resultado.cbu,
      cbuDestino: 'PRESTAMO',
      importe: resultado.monto,
      estado: 'aprobada',
      descripcion: 'Cancelación anticipada de préstamo',
      tipo: 'cancelacion_prestamo',
      createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando cancelación en el historial:', e.message));

    res.json(resultado);
  } catch (error) {
    if (['NO_CUENTA', 'NO_PRESTAMO', 'PRESTAMO_INACTIVO', 'YA_SALDADO', 'SALDO_INSUFICIENTE'].includes(error.code))
      return res.status(422).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};
