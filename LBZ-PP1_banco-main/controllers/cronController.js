const Prestamo = require('../models/prestamoModel');
const { enviarRecordatorioCuota, enviarCuotaVencida } = require('../utils/mailer');
const { situacionPorVencidas, reportarSituacionBC } = require('../utils/centralDeudores');
const { notificarCuotaPorVencer, notificarCuotaVencida } = require('../utils/notificaciones');

// Vercel Cron (vercel.json): reporta al Banco Central una vez por persona afectada, no por cuota.
exports.diario = async (req, res) => {
  // El middleware de mantenimiento ya lo chequea, pero el endpoint no puede depender de eso.
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  let recordatorios = 0;
  let vencidas = 0;
  let bcReportadas = 0;

  try {
    const porVencer = await Prestamo.getCuotasPorVencerEn3Dias();
    for (const c of porVencer) {
      try {
        await enviarRecordatorioCuota(c.email, c.nombre, {
          monto: c.monto, fechaVencimiento: c.fecha_vencimiento, numeroCuota: c.numero_cuota
        });
        notificarCuotaPorVencer(c.id_persona, {
          monto: c.monto, fechaVencimiento: c.fecha_vencimiento, numeroCuota: c.numero_cuota
        }).catch(e => console.error('Error creando notificación de cuota por vencer:', e.message));
        recordatorios++;
      } catch (e) {
        console.error('Error enviando recordatorio de cuota:', e.message);
      }
    }
  } catch (e) {
    console.error('Error buscando cuotas por vencer:', e.message);
  }

  try {
    const recienVencidas = await Prestamo.marcarCuotasVencidasYObtener();
    vencidas = recienVencidas.length;

    for (const c of recienVencidas) {
      try {
        await enviarCuotaVencida(c.email, c.nombre, { monto: c.monto, fechaVencimiento: c.fecha_vencimiento });
        notificarCuotaVencida(c.id_persona, { monto: c.monto, fechaVencimiento: c.fecha_vencimiento })
          .catch(e => console.error('Error creando notificación de cuota vencida:', e.message));
      } catch (e) {
        console.error('Error enviando aviso de cuota vencida:', e.message);
      }
    }

    const personasAfectadas = [...new Map(recienVencidas.map(c => [c.id_persona, c.dni])).entries()];
    for (const [idPersona, dni] of personasAfectadas) {
      if (!dni) continue;
      try {
        const totalVencidas = await Prestamo.getCuotasVencidasPersona(idPersona);
        const montoAdeudado = await Prestamo.getMontoAdeudadoPersona(idPersona);
        await reportarSituacionBC(dni, montoAdeudado, situacionPorVencidas(totalVencidas));
        bcReportadas++;
      } catch (e) {
        console.error(`Error reportando situación BC para dni ${dni}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Error marcando cuotas vencidas:', e.message);
  }

  console.log(`Cron préstamos diario: ${recordatorios} recordatorios, ${vencidas} cuotas vencidas, ${bcReportadas} reportes al Banco Central`);
  res.json({ recordatorios, vencidas, bcReportadas });
};
