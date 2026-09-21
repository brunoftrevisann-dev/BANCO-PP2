const Persona = require('../models/personaModel');
const bancosConocidos = require('../config/bancosConocidosQr');
const { firmarQr, verificarQr } = require('../utils/qrJwt');

// Solo se firman QR de cuentas que realmente son de tuo, con el alias y la moneda que figuran en
// la base: si no, la firma de tuo serviría para respaldar un CBU ajeno o datos inventados.
exports.firmar = async (req, res) => {
  try {
    const { cbu, monto } = req.body;
    if (!cbu) return res.status(400).json({ error: 'cbu requerido' });
    if (monto !== undefined && !(Number(monto) > 0)) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const cuenta = await Persona.getByCbu(cbu);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const jwt = await firmarQr({
      cbu: cuenta.cbu,
      alias: cuenta.alias,
      moneda: cuenta.moneda,
      monto: monto !== undefined ? Number(monto) : undefined
    });
    res.json({ jwt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verificar = async (req, res) => {
  try {
    const resultado = await verificarQr(req.body.qr, bancosConocidos);
    if (resultado.tipo === 'error') return res.status(400).json({ tipo: 'error', error: 'Código QR no reconocido' });
    if (resultado.tipo === 'rechazado') {
      console.error('QR rechazado:', resultado.motivoInterno);
      return res.status(422).json({ tipo: 'rechazado', error: 'Este código no es válido o venció' });
    }
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
