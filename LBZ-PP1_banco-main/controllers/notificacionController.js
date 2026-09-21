const Notificacion = require('../models/notificacionModel');

exports.listar = async (req, res) => {
  try {
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    const notificaciones = await Notificacion.listarPorPersona(idPersona);
    res.json(notificaciones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.noLeidas = async (req, res) => {
  try {
    const idPersona = parseInt(req.query.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    const cantidad = await Notificacion.contarNoLeidas(idPersona);
    res.json({ cantidad });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.marcarLeida = async (req, res) => {
  try {
    const idNotificacion = parseInt(req.params.id);
    const idPersona = parseInt(req.body.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    const actualizada = await Notificacion.marcarLeida(idNotificacion, idPersona);
    if (!actualizada) return res.status(404).json({ error: 'Notificación no encontrada' });
    res.json(actualizada);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.marcarTodasLeidas = async (req, res) => {
  try {
    const idPersona = parseInt(req.body.idPersona);
    if (!idPersona) return res.status(400).json({ error: 'idPersona requerido' });
    await Notificacion.marcarTodasLeidas(idPersona);
    res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
