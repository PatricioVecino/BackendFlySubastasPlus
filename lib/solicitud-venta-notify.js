const ClientesAcceso = require("../models/clientes_acceso");
const { crearNotificacion } = require("./notificaciones-helper");
const { enviarNotificacionVenta } = require("./mailer");

// Crea la notificación in-app y manda el email. El email no rompe el flujo si falla.
async function notificarVenta(clienteId, {
  titulo,
  mensaje,
  accionUrl = null,
  emailSubject = null,
  emailParrafos = null,
}) {
  await crearNotificacion(clienteId, {
    tipo: "solicitud_venta",
    titulo,
    mensaje,
    accionUrl,
  });

  try {
    const acceso = await ClientesAcceso.findOne({ cliente: clienteId });
    if (acceso?.email) {
      await enviarNotificacionVenta(acceso.email, {
        subject: emailSubject || titulo,
        titulo,
        parrafos: emailParrafos || [mensaje],
      });
    }
  } catch (err) {
    console.error("[notificarVenta] email error:", err.message);
  }
}

module.exports = { notificarVenta };
