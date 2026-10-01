const Reserva = require('../models/reservaModel');
const Persona = require('../models/personaModel');
const fetchBC = require('../utils/fetchConTimeout');
const { notificarReservaAbierta, notificarReservaVencida } = require('../utils/notificaciones');

const round2 = (v) => Math.round(v * 100) / 100;

// Diferencias propias de tuo, no vienen de ninguna API: ningún plazo fijo bancario real baja de
// 30 días (mínimo legal BCRA), así que la semanal y el frasco no tienen tasa de mercado posible.
// Naranja X real paga menos en sus productos cortos/flexibles que en el fijo largo, pero la
// diferencia real es chica (1-2 puntos porcentuales entre un plazo y el siguiente, no un porcentaje
// multiplicativo) — por eso son puntos porcentuales restados, no un factor como 0.70/0.45, que con
// una tasa base de ~20% abría una brecha de 6-11 puntos, mucho más de lo que se ve en la realidad.
const DIFERENCIA_SEMANAL_PP = 0.015; // 1.5 puntos porcentuales menos que la fija
const DIFERENCIA_FRASCO_PP = 0.03;   // 3 puntos porcentuales menos que la fija (1.5 menos que la semanal)
const TNA_MINIMA = 0.01;             // piso de seguridad, para que nunca quede negativa si la tasa base es muy baja

// Promedia la tnaClientes (o la banda de tasas[] que cubra el plazo pedido) de los bancos de
// api.argentinadatos.com — mismo criterio de "promedio, no una entidad puntual" que préstamos.
async function calcularTnaFijaReferencia(plazoDias) {
  const res = await fetchBC('https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo', {}, 10000);
  if (!res.ok) throw new Error('No se pudo obtener la tasa de referencia de plazo fijo');
  const entidades = await res.json();
  const tnas = [];
  for (const e of entidades) {
    const bandas = e.tasas;
    let tna = null;
    if (Array.isArray(bandas) && bandas.length) {
      const banda = bandas.find(b => plazoDias >= b.plazoMinDias && plazoDias <= b.plazoMaxDias);
      if (banda && typeof banda.tna === 'number') tna = banda.tna;
    }
    if (tna === null && typeof e.tnaClientes === 'number' && e.tnaClientes > 0) tna = e.tnaClientes;
    if (tna !== null) tnas.push(tna);
  }
  if (tnas.length === 0) throw new Error('No hay tasas de plazo fijo disponibles');
  return tnas.reduce((a, b) => a + b, 0) / tnas.length;
}

async function calcularTasas(plazoDiasFija = 30) {
  const tnaFija = await calcularTnaFijaReferencia(plazoDiasFija);
  return {
    FIJO_MESES: tnaFija,
    FIJO_DIAS: Math.max(tnaFija - DIFERENCIA_SEMANAL_PP, TNA_MINIMA),
    FRASCO: Math.max(tnaFija - DIFERENCIA_FRASCO_PP, TNA_MINIMA)
  };
}

exports.tasas = async (req, res) => {
  try {
    res.json(await calcularTasas());
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
};

exports.listar = async (req, res) => {
  try {
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    res.json(await Reserva.getReservasPersona(idPersona));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.simular = async (req, res) => {
  try {
    const { tipo, monto, plazoDias, plazoMeses } = req.body;
    if (!tipo || !monto) return res.status(400).json({ error: 'tipo y monto son requeridos' });

    const plazoDiasEquivalente = tipo === 'FIJO_MESES' ? Number(plazoMeses) * 30 : (tipo === 'FIJO_DIAS' ? Number(plazoDias) : 30);
    const tasas = await calcularTasas(plazoDiasEquivalente);
    const tna = tasas[tipo];
    if (tna === undefined) return res.status(400).json({ error: 'tipo inválido' });

    const dias = tipo === 'FIJO_MESES' ? Number(plazoMeses) * 30 : (tipo === 'FIJO_DIAS' ? Number(plazoDias) : 30);
    const interes = round2(Number(monto) * tna * dias / 365);
    res.json({ tna, interesProyectado: interes, montoFinal: round2(Number(monto) + interes) });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
};

exports.abrir = async (req, res) => {
  try {
    const { idPersona, tipo, monto, plazoDias, plazoMeses, nombre } = req.body;
    if (!idPersona || !tipo || !monto) return res.status(400).json({ error: 'idPersona, tipo y monto son requeridos' });
    if (!['FIJO_MESES', 'FIJO_DIAS', 'FRASCO'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
    if (tipo === 'FIJO_MESES' && ![1, 2, 3].includes(Number(plazoMeses))) return res.status(400).json({ error: 'plazoMeses debe ser 1, 2 o 3' });
    if (tipo === 'FIJO_DIAS' && ![7, 14, 21, 28].includes(Number(plazoDias))) return res.status(400).json({ error: 'plazoDias debe ser 7, 14, 21 o 28' });

    // La tasa nunca se confía del cliente: se vuelve a calcular acá, igual que cambiarDivisa con el MEP.
    const plazoDiasEquivalente = tipo === 'FIJO_MESES' ? Number(plazoMeses) * 30 : (tipo === 'FIJO_DIAS' ? Number(plazoDias) : 30);
    const tasas = await calcularTasas(plazoDiasEquivalente);
    const tna = tasas[tipo];

    const reserva = await Reserva.abrirReserva(idPersona, { tipo, monto: Number(monto), tna, plazoDias, plazoMeses, nombre });

    await Persona.upsertTransaccion({
      _id: 'RESERVA-' + require('crypto').randomUUID(),
      cbuOrigen: reserva.cbu, cbuDestino: 'RESERVA',
      importe: Number(monto), estado: 'aprobada',
      descripcion: `Apertura de reserva ${tipo === 'FRASCO' ? '(frasco)' : `a ${tipo === 'FIJO_MESES' ? plazoMeses + (Number(plazoMeses) === 1 ? ' mes' : ' meses') : plazoDias + ' días'}`}`,
      tipo: 'apertura_reserva', createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando apertura de reserva en el historial:', e.message));

    notificarReservaAbierta(idPersona, { tipo, monto: Number(monto), tna })
      .catch(e => console.error('Error creando notificación de apertura de reserva:', e.message));

    res.status(201).json(reserva);
  } catch (error) {
    if (['MONTO_MINIMO', 'NO_CUENTA', 'SALDO_INSUFICIENTE'].includes(error.code)) return res.status(422).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.depositarFrasco = async (req, res) => {
  try {
    const idReserva = parseInt(req.params.id);
    const { idPersona, monto } = req.body;
    if (!idPersona || !monto) return res.status(400).json({ error: 'idPersona y monto son requeridos' });

    const resultado = await Reserva.depositarFrasco(idPersona, idReserva, Number(monto));

    const cuenta = await Persona.getCuentaPorMoneda(idPersona, 'ARS');
    await Persona.upsertTransaccion({
      _id: 'RESERVA-' + require('crypto').randomUUID(),
      cbuOrigen: cuenta?.cbu || 'ARS', cbuDestino: 'RESERVA',
      importe: Number(monto), estado: 'aprobada', descripcion: 'Depósito a frasco',
      tipo: 'deposito_frasco', createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando depósito a frasco en el historial:', e.message));

    res.json(resultado);
  } catch (error) {
    if (['NO_RESERVA', 'NO_ES_FRASCO', 'MONTO_MINIMO', 'NO_CUENTA', 'SALDO_INSUFICIENTE'].includes(error.code)) return res.status(422).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};

exports.retirarFrasco = async (req, res) => {
  try {
    const idReserva = parseInt(req.params.id);
    const { idPersona, monto } = req.body;
    if (!idPersona || !monto) return res.status(400).json({ error: 'idPersona y monto son requeridos' });

    const resultado = await Reserva.retirarFrasco(idPersona, idReserva, Number(monto));

    const cuenta = await Persona.getCuentaPorMoneda(idPersona, 'ARS');
    await Persona.upsertTransaccion({
      _id: 'RESERVA-' + require('crypto').randomUUID(),
      cbuOrigen: 'RESERVA', cbuDestino: cuenta?.cbu || 'ARS',
      importe: Number(monto), estado: 'aprobada', descripcion: 'Retiro de frasco',
      tipo: 'retiro_frasco', createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando retiro de frasco en el historial:', e.message));

    res.json(resultado);
  } catch (error) {
    if (['NO_RESERVA', 'NO_ES_FRASCO', 'SALDO_INSUFICIENTE', 'NO_CUENTA'].includes(error.code)) return res.status(422).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
};
