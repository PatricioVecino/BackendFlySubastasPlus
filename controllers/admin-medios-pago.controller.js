const MediosPago = require("../models/medios_pago");
const HttpError = require("../lib/http-error");
const { medioPagoShape } = require("../lib/medio-pago-shape");
const { evaluarYActualizarCategoria } = require("../lib/categoria-upgrade");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// POST /admin/medios-pago/:id/verificar
exports.verificar = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const medio = await MediosPago.findById(id);
  if (!medio) {
    throw new HttpError(404, "PAGO_NO_ENCONTRADO", "El medio de pago no existe.");
  }
  if (medio.verificado === "si") {
    throw new HttpError(409, "PAGO_YA_VERIFICADO", "El medio de pago ya está verificado.");
  }

  const updated = await MediosPago.update(id, { verificado: "si" });
  await evaluarYActualizarCategoria(medio.cliente);
  res.json(medioPagoShape(updated));
});
