const Notificacion = require('../models/notificacionModel');

exports.listar = async (req, res) => {
  try {
    const notificaciones = await Notificacion.listarPorPersona(req.idPersona);
    res.json(notificaciones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.noLeidas = async (req, res) => {
  try {
    const cantidad = await Notificacion.contarNoLeidas(req.idPersona);
    res.json({ cantidad });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.marcarLeida = async (req, res) => {
  try {
    const idNotificacion = parseInt(req.params.id);
    const actualizada = await Notificacion.marcarLeida(idNotificacion, req.idPersona);
    if (!actualizada) return res.status(404).json({ error: 'Notificación no encontrada' });
    res.json(actualizada);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.marcarTodasLeidas = async (req, res) => {
  try {
    await Notificacion.marcarTodasLeidas(req.idPersona);
    res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
