const Notificacion = require('../models/notificacionModel');

const fmtMonto = (v) => '$ ' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMontoUsd = (v) => 'US$ ' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (v) => new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

async function notificarTransferenciaRecibida(idPersona, { monto, nombreOrigen, moneda = 'ARS' }) {
  const montoFmt = moneda === 'USD' ? fmtMontoUsd(monto) : fmtMonto(monto);
  await Notificacion.crear(idPersona, {
    tipo: 'transferencia_recibida',
    titulo: 'Transferencia recibida',
    mensaje: `Recibiste ${montoFmt} de ${nombreOrigen || 'otra cuenta'}.`
  });
}

async function notificarDeposito(idPersona, { monto }) {
  await Notificacion.crear(idPersona, {
    tipo: 'deposito',
    titulo: 'Depósito acreditado',
    mensaje: `Se acreditó un depósito de ${fmtMonto(monto)} en tu cuenta.`
  });
}

async function notificarCambioDivisa(idPersona, { direccion, montoUsd }) {
  const accion = direccion === 'compra' ? 'Compraste' : 'Vendiste';
  await Notificacion.crear(idPersona, {
    tipo: 'cambio_divisa',
    titulo: direccion === 'compra' ? 'Compra de dólares' : 'Venta de dólares',
    mensaje: `${accion} ${fmtMontoUsd(montoUsd)}.`
  });
}

async function notificarPrestamoOtorgado(idPersona, { monto, plazoMeses }) {
  await Notificacion.crear(idPersona, {
    tipo: 'prestamo_otorgado',
    titulo: 'Préstamo otorgado',
    mensaje: `Te otorgamos un préstamo de ${fmtMonto(monto)} en ${plazoMeses} cuotas.`
  });
}

async function notificarCuotaPorVencer(idPersona, { monto, fechaVencimiento, numeroCuota }) {
  await Notificacion.crear(idPersona, {
    tipo: 'cuota_por_vencer',
    titulo: 'Cuota por vencer',
    mensaje: `La cuota N.º ${numeroCuota} de ${fmtMonto(monto)} vence el ${fmtFecha(fechaVencimiento)}.`
  });
}

async function notificarCuotaVencida(idPersona, { monto, fechaVencimiento }) {
  await Notificacion.crear(idPersona, {
    tipo: 'cuota_vencida',
    titulo: 'Cuota vencida',
    mensaje: `Tenés una cuota de ${fmtMonto(monto)} vencida desde el ${fmtFecha(fechaVencimiento)}.`
  });
}

async function notificarPrestamoSaldado(idPersona) {
  await Notificacion.crear(idPersona, {
    tipo: 'prestamo_saldado',
    titulo: 'Préstamo saldado',
    mensaje: 'Terminaste de pagar tu préstamo por completo. ¡Felicitaciones!'
  });
}

async function notificarPrestamoCancelado(idPersona, { monto }) {
  await Notificacion.crear(idPersona, {
    tipo: 'prestamo_cancelado',
    titulo: 'Préstamo cancelado',
    mensaje: `Cancelaste anticipadamente tu préstamo pagando ${fmtMonto(monto)}.`
  });
}

const NOMBRE_TIPO_RESERVA = { FIJO_MESES: 'una reserva fija', FIJO_DIAS: 'una reserva semanal', FRASCO: 'un frasco' };

async function notificarReservaAbierta(idPersona, { tipo, monto, tna }) {
  const pct = (Number(tna) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  await Notificacion.crear(idPersona, {
    tipo: 'reserva_abierta',
    titulo: 'Reserva abierta',
    mensaje: `Abriste ${NOMBRE_TIPO_RESERVA[tipo] || 'una reserva'} de ${fmtMonto(monto)} al ${pct}% TNA.`
  });
}

async function notificarReservaVencida(idPersona, { montoFinal, interes }) {
  await Notificacion.crear(idPersona, {
    tipo: 'reserva_vencida',
    titulo: 'Reserva vencida',
    mensaje: `Tu reserva venció y se acreditaron ${fmtMonto(montoFinal)} a tu cuenta (incluye ${fmtMonto(interes)} de interés).`
  });
}

async function notificarQrLeido(idPersona, { nombreLector, nombreBanco }) {
  const quien = nombreLector || 'Alguien';
  const sufijo = nombreBanco ? ` desde ${nombreBanco}` : '';
  await Notificacion.crear(idPersona, {
    tipo: 'qr_leido',
    titulo: 'Tu QR fue leído',
    mensaje: `${quien} escaneó tu QR${sufijo}.`
  });
}

async function notificarNuevoDispositivo(idPersona, { dispositivo }) {
  await Notificacion.crear(idPersona, {
    tipo: 'nuevo_dispositivo',
    titulo: 'Nuevo inicio de sesión',
    mensaje: `Detectamos un inicio de sesión desde un dispositivo nuevo${dispositivo ? ` (${dispositivo})` : ''}.`
  });
}

async function notificarPasswordCambiada(idPersona) {
  await Notificacion.crear(idPersona, {
    tipo: 'password_cambiada',
    titulo: 'Contraseña actualizada',
    mensaje: 'Tu contraseña se cambió correctamente.'
  });
}

async function notificarAliasCambiado(idPersona, { alias }) {
  await Notificacion.crear(idPersona, {
    tipo: 'alias_cambiado',
    titulo: 'Alias actualizado',
    mensaje: `Tu nuevo alias es ${alias}.`
  });
}

const NOMBRE_TIPO_TARJETA = { DEBITO: 'débito', CREDITO: 'crédito' };

async function notificarTarjetaEmitida(idPersona, { tipo, numero, limite }) {
  const extra = tipo === 'CREDITO' ? ` con un límite de ${fmtMonto(limite)}` : ', vinculada a tu caja de ahorro';
  await Notificacion.crear(idPersona, {
    tipo: 'tarjeta_emitida',
    titulo: `Tarjeta de ${NOMBRE_TIPO_TARJETA[tipo]} lista`,
    mensaje: `Tu tarjeta de ${NOMBRE_TIPO_TARJETA[tipo]} terminada en ${String(numero).slice(-4)} ya está activa${extra}.`
  });
}

async function notificarCompraTarjeta(idPersona, { tipo, comercio, monto, cuotas }) {
  const enCuotas = cuotas > 1 ? ` en ${cuotas} cuotas` : '';
  await Notificacion.crear(idPersona, {
    tipo: 'compra_tarjeta',
    titulo: `Compra con ${NOMBRE_TIPO_TARJETA[tipo]}`,
    mensaje: `Compraste ${fmtMonto(monto)}${enCuotas} en ${comercio}.`
  });
}

async function notificarPagoTarjeta(idPersona, { monto, deuda }) {
  await Notificacion.crear(idPersona, {
    tipo: 'pago_tarjeta',
    titulo: 'Pago de tarjeta acreditado',
    mensaje: `Pagaste ${fmtMonto(monto)} de tu tarjeta de crédito. ${Number(deuda) > 0 ? `Te quedan ${fmtMonto(deuda)} por pagar.` : 'No tenés deuda pendiente.'}`
  });
}

module.exports = {
  notificarTarjetaEmitida, notificarCompraTarjeta, notificarPagoTarjeta,
  notificarTransferenciaRecibida, notificarDeposito, notificarCambioDivisa,
  notificarPrestamoOtorgado, notificarCuotaPorVencer, notificarCuotaVencida,
  notificarPrestamoSaldado, notificarPrestamoCancelado, notificarNuevoDispositivo,
  notificarPasswordCambiada, notificarAliasCambiado,
  notificarReservaAbierta, notificarReservaVencida,
  notificarQrLeido
};
