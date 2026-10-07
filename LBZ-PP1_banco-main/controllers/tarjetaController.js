const crypto = require('crypto');
const db = require('../config/db');
const Tarjeta = require('../models/tarjetaModel');
const Persona = require('../models/personaModel');
const { obtenerTasasTarjeta } = require('../utils/tasaTarjeta');
const { notificarTarjetaEmitida, notificarCompraTarjeta, notificarPagoTarjeta } = require('../utils/notificaciones');

const TIPOS = ['DEBITO', 'CREDITO'];
const ERRORES_NEGOCIO = [
  'YA_TIENE', 'NO_CUENTA', 'NO_TARJETA', 'BLOQUEADA', 'SALDO_INSUFICIENTE', 'LIMITE_INSUFICIENTE',
  'MONTO_INVALIDO', 'CUOTAS_INVALIDAS', 'SIN_DEUDA', 'MONTO_SUPERA_DEUDA'
];

const responderError = (res, error) => {
  if (ERRORES_NEGOCIO.includes(error.code)) return res.status(422).json({ error: error.message });
  res.status(500).json({ error: error.message });
};

const tipoValido = (tipo) => TIPOS.includes(String(tipo || '').toUpperCase()) ? String(tipo).toUpperCase() : null;

exports.listar = async (req, res) => {
  try {
    const tasas = await obtenerTasasTarjeta();
    const tarjetas = await Tarjeta.getTarjetasPersona(req.idPersona, tasas.tna);
    res.json({ ...tarjetas, tasas });
  } catch (error) {
    responderError(res, error);
  }
};

exports.tasas = async (req, res) => {
  try {
    res.json(await obtenerTasasTarjeta());
  } catch (error) {
    responderError(res, error);
  }
};

// Simulación de una compra en cuotas con crédito: lo que se mostraría antes de confirmar.
exports.simular = async (req, res) => {
  try {
    const monto = Number(req.body.monto);
    const cuotas = Number(req.body.cuotas || 1);
    if (!(monto > 0)) return res.status(400).json({ error: 'monto inválido' });
    if (!Tarjeta.CUOTAS_PERMITIDAS.includes(cuotas)) return res.status(400).json({ error: `Las cuotas deben ser ${Tarjeta.CUOTAS_PERMITIDAS.join(', ')}` });
    const tasas = await obtenerTasasTarjeta();
    res.json({ ...Tarjeta.calcularFinanciacion(monto, cuotas, tasas.tna), tasas });
  } catch (error) {
    responderError(res, error);
  }
};

exports.emitir = async (req, res) => {
  try {
    const idPersona = req.idPersona;
    const tipo = tipoValido(req.body.tipo);
    if (!tipo) return res.status(400).json({ error: 'tipo (DEBITO o CREDITO) es requerido' });

    const { rows } = await db.query('SELECT nombre, apellido FROM Personas WHERE id = $1', [idPersona]);
    if (!rows[0]) return res.status(404).json({ error: 'Persona no encontrada' });
    const nombreTitular = `${rows[0].nombre} ${rows[0].apellido}`.toUpperCase().slice(0, 26);

    const tarjeta = tipo === 'CREDITO'
      ? await Tarjeta.emitirCredito(idPersona, nombreTitular)
      : await Tarjeta.emitirDebito(idPersona, nombreTitular);

    notificarTarjetaEmitida(idPersona, { tipo, numero: tarjeta.numero_tarjeta, limite: tarjeta.limite_compra })
      .catch(e => console.error('Error creando notificación de tarjeta emitida:', e.message));

    res.status(201).json(tarjeta);
  } catch (error) {
    responderError(res, error);
  }
};

exports.bloquear = async (req, res) => {
  try {
    const { bloquear } = req.body;
    const tipo = tipoValido(req.params.tipo);
    if (!tipo) return res.status(400).json({ error: 'tipo es requerido' });
    res.json(await Tarjeta.cambiarEstado(req.idPersona, tipo, bloquear !== false));
  } catch (error) {
    responderError(res, error);
  }
};

exports.comprar = async (req, res) => {
  try {
    const idPersona = req.idPersona;
    const { monto, cuotas } = req.body;
    const tipo = tipoValido(req.params.tipo);
    const comercio = String(req.body.comercio || '').trim().slice(0, 80);
    if (!tipo || !monto || !comercio) return res.status(400).json({ error: 'comercio y monto son requeridos' });

    if (tipo === 'DEBITO') {
      const r = await Tarjeta.compraDebito(idPersona, { comercio, monto: Number(monto) });
      // La compra con débito sale de la caja de ahorro, así que también va al historial de
      // movimientos de la cuenta (con el CBU sentinela "TARJETA", mismo criterio que Reservas).
      await Persona.upsertTransaccion({
        _id: 'TARJETA-' + crypto.randomUUID(),
        cbuOrigen: r.cbu, cbuDestino: 'TARJETA',
        importe: Number(monto), estado: 'aprobada',
        descripcion: `Compra con débito en ${comercio}`,
        tipo: 'compra_debito', createdAt: new Date().toISOString()
      }).catch(e => console.error('Error registrando compra con débito en el historial:', e.message));
      notificarCompraTarjeta(idPersona, { tipo, comercio, monto: Number(monto) })
        .catch(e => console.error('Error creando notificación de compra con débito:', e.message));
      return res.status(201).json(r);
    }

    const { tna } = await obtenerTasasTarjeta();
    const r = await Tarjeta.compraCredito(idPersona, { comercio, monto: Number(monto), cuotas: Number(cuotas || 1), tna });
    notificarCompraTarjeta(idPersona, { tipo, comercio, monto: Number(monto), cuotas: Number(cuotas || 1), montoCuota: r.financiacion.montoCuota, tna: r.financiacion.tna })
      .catch(e => console.error('Error creando notificación de compra con crédito:', e.message));
    res.status(201).json(r);
  } catch (error) {
    responderError(res, error);
  }
};

exports.pagar = async (req, res) => {
  try {
    const idPersona = req.idPersona;
    const { monto } = req.body;
    if (!monto) return res.status(400).json({ error: 'monto es requerido' });

    const { tna } = await obtenerTasasTarjeta();
    const r = await Tarjeta.pagarCredito(idPersona, Number(monto), tna);

    await Persona.upsertTransaccion({
      _id: 'TARJETA-' + crypto.randomUUID(),
      cbuOrigen: r.cbu, cbuDestino: 'TARJETA',
      importe: Number(monto), estado: 'aprobada',
      descripcion: 'Pago de resumen de tarjeta de crédito',
      tipo: 'pago_tarjeta_credito', createdAt: new Date().toISOString()
    }).catch(e => console.error('Error registrando pago de tarjeta en el historial:', e.message));
    notificarPagoTarjeta(idPersona, { monto: Number(monto), deuda: r.deuda, saldoFinanciado: r.saldoFinanciado, tna })
      .catch(e => console.error('Error creando notificación de pago de tarjeta:', e.message));

    res.json(r);
  } catch (error) {
    responderError(res, error);
  }
};

exports.movimientos = async (req, res) => {
  try {
    const tipo = tipoValido(req.params.tipo);
    if (!tipo) return res.status(400).json({ error: 'tipo es requerido' });
    res.json(await Tarjeta.getMovimientos(req.idPersona, tipo));
  } catch (error) {
    responderError(res, error);
  }
};
