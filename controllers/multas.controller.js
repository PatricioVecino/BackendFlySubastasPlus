const supabase = require("../supabase-client");
const Multas = require("../models/multas");
const RegistroDeSubasta = require("../models/registro_de_subasta");
const RegistroSubastaExtension = require("../models/registro_subasta_extension");
const MediosPago = require("../models/medios_pago");
const Asistentes = require("../models/asistentes");
const AsistentesExtension = require("../models/asistentes_extension");
const HttpError = require("../lib/http-error");
const { montoDisponible } = require("../lib/medio-pago-shape");
const { crearNotificacion } = require("../lib/notificaciones-helper");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function multaShape(m) {
  return {
    id: String(m.identificador),
    compraId: m.registro != null ? String(m.registro) : null,
    piezaId: m._reg?.producto != null ? String(m._reg.producto) : null,
    subastaId: m._reg?.subasta != null ? String(m._reg.subasta) : null,
    montoOriginal: m.monto_original != null ? Number(m.monto_original) : null,
    montoMulta: m.monto_multa != null ? Number(m.monto_multa) : null,
    moneda: m.moneda || "ARS",
    estado: m.estado,
    fechaCreacion: m.fecha_creacion || null,
  };
}

// las multas no tienen FK directa al cliente; las traemos indirectamente a través de sus registros de subasta
async function multasDelUsuario(clienteId) {
  const { data: registros } = await supabase
    .from("registro_de_subasta")
    .select("identificador, producto, subasta")
    .eq("cliente", clienteId);
  const regIds = (registros || []).map((r) => r.identificador);
  if (!regIds.length) return [];
  const regMap = Object.fromEntries((registros || []).map((r) => [r.identificador, r]));
  const { data: multas } = await supabase
    .from("multas")
    .select("*")
    .in("registro", regIds)
    .order("identificador", { ascending: false });
  return (multas || []).map((m) => ({ ...m, _reg: regMap[m.registro] || {} }));
}

// GET /multas
exports.listar = asyncHandler(async (req, res) => {
  const all = await multasDelUsuario(req.user.sub);
  // "Activas" = pendiente o derivada_justicia. Devolvemos todas; el cliente filtra.
  res.json(all.map(multaShape));
});

// POST /multas/:id/pagar
exports.pagar = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const multa = await Multas.findById(id);
  if (!multa) {
    throw new HttpError(404, "MULTA_NO_ENCONTRADA", "La multa solicitada no existe.");
  }
  // Verificar ownership via registro_de_subasta
  const reg = await RegistroDeSubasta.findById(multa.registro);
  if (!reg || reg.cliente !== req.user.sub) {
    throw new HttpError(404, "MULTA_NO_ENCONTRADA", "La multa solicitada no existe.");
  }

  if (multa.estado !== "pendiente") {
    throw new HttpError(400, "MULTA_NO_PAGABLE", "Esta multa no puede pagarse en su estado actual.", {
      estado: multa.estado,
    });
  }

  const { medioPagoId } = req.body || {};
  if (!medioPagoId) {
    throw new HttpError(400, "MULTA_DATOS_INVALIDOS", "medioPagoId es requerido.", {
      campo: "medioPagoId",
    });
  }
  const medio = await MediosPago.findById(Number(medioPagoId));
  if (!medio || medio.cliente !== req.user.sub) {
    throw new HttpError(404, "PAGO_NO_ENCONTRADO", "Medio de pago no encontrado.");
  }
  if (medio.verificado !== "si") {
    throw new HttpError(402, "MULTA_PAGO_FALLIDO", "No se pudo procesar el pago de la multa. Probá con otro medio de pago.", {
      razon: "medio_no_verificado",
    });
  }
  const monto = montoDisponible(medio);
  if (monto !== null) {
    const { data: registros } = await supabase
      .from("registro_de_subasta")
      .select("identificador, importe, comision, subasta")
      .eq("cliente", req.user.sub);
    let comprometido = 0;
    for (const reg of registros || []) {
      const asistente = await Asistentes.findOne({ cliente: req.user.sub, subasta: reg.subasta });
      if (!asistente) continue;
      const extAsis = await AsistentesExtension.findOne({ asistente: asistente.identificador });
      if (String(extAsis?.medio_pago) !== String(medio.identificador)) continue;
      const extCompra = await RegistroSubastaExtension.findOne({ registro: reg.identificador });
      if (!extCompra) continue;
      comprometido += Number(reg.importe || 0) + Number(reg.comision || 0);
    }
    if (comprometido + Number(multa.monto_multa) > monto) {
      throw new HttpError(402, "MULTA_PAGO_FALLIDO", "No se pudo procesar el pago de la multa. Probá con otro medio de pago.", {
        razon: "fondos_insuficientes",
      });
    }
  }

  const updated = await Multas.update(multa.identificador, {
    estado: "pagada",
    medio_pago_cobro: medio.identificador,
  });
  await RegistroSubastaExtension.update(multa.registro, { estado_pago: "pendiente_pago" });
  await crearNotificacion(req.user.sub, {
    tipo: "multa",
    titulo: "Multa pagada",
    mensaje: `Tu multa de $${multa.monto_multa} fue pagada exitosamente. Tu cuenta está al día.`,
  });
  res.json(multaShape(updated));
});
