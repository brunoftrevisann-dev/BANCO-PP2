const Prestamo = require('../models/prestamoModel');
const { enviarRecordatorioCuota, enviarCuotaVencida } = require('../utils/mailer');
const { situacionPorVencidas, reportarSituacionBC } = require('./prestamoController')._internos;

// Corre una vez por día (Vercel Cron, ver vercel.json): manda los recordatorios de cuota
// por vencer, escala a "vencida" lo que ya pasó de fecha, y reporta la nueva situación al
// Banco Central (una vez por persona afectada, no una vez por cuota).
exports.diario = async (req, res) => {
  // Defensa en profundidad: el middleware de mantenimiento ya chequea esto mismo, pero el
  // endpoint no debe quedar público una vez que se saque el mantenimiento.
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
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
