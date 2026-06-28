const Notificaciones = require("../models/notificaciones");

// Inserta una notificación sin romper el flujo principal si falla.
async function crearNotificacion(clienteId, { tipo, titulo, mensaje, accionUrl = null }) {
  try {
    await Notificaciones.create({
      cliente: clienteId,
      tipo,
      titulo,
      mensaje,
      leida: "no",
      tiene_mensajes: "no",
      fecha: new Date().toISOString(),
      accion_url: accionUrl,
    });
  } catch (err) {
    console.error("[notificacion] error al crear:", err.message);
  }
}

module.exports = { crearNotificacion };
