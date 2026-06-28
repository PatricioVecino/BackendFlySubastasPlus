const supabase = require("../supabase-client");
const Notificaciones = require("../models/notificaciones");
const Mensajes = require("../models/mensajes");
const HttpError = require("../lib/http-error");
const { paginate } = require("../lib/subasta-shape");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notificacionShape(n) {
  return {
    id: String(n.identificador),
    titulo: n.titulo,
    mensaje: n.mensaje,
    tipo: n.tipo,
    leida: n.leida === "si",
    fecha: n.fecha,
    accionUrl: n.accion_url || null,
    tieneMensajes: n.tiene_mensajes === "si",
  };
}

function mensajeShape(m) {
  return {
    id: String(m.identificador),
    notificacionId: String(m.notificacion),
    contenido: m.contenido,
    emisor: m.emisor,
    fecha: m.fecha,
  };
}

async function findOwnNotif(id, clienteId) {
  const n = await Notificaciones.findById(id);
  if (!n || n.cliente !== clienteId) {
    throw new HttpError(404, "NOTIFICACION_NO_ENCONTRADA", "La notificación solicitada no existe o ya fue eliminada.");
  }
  return n;
}

// GET /notificaciones
exports.listar = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from("notificaciones")
    .select("*", { count: "exact" })
    .eq("cliente", req.user.sub);
  if (req.query.leida !== undefined) {
    const flag = String(req.query.leida).toLowerCase() === "true" ? "si" : "no";
    q = q.eq("leida", flag);
  }
  q = q.range(from, to).order("fecha", { ascending: false });

  const { data, count, error } = await q;
  if (error) throw error;

  // total noLeidas (sin paginar)
  const { count: noLeidas } = await supabase
    .from("notificaciones")
    .select("*", { count: "exact", head: true })
    .eq("cliente", req.user.sub)
    .eq("leida", "no");

  res.json({
    data: (data || []).map(notificacionShape),
    meta: paginate({ page, limit, total: count || 0 }),
    noLeidas: noLeidas || 0,
  });
});

// GET /notificaciones/:id  (marca como leída al abrir)
exports.detalle = asyncHandler(async (req, res) => {
  const n = await findOwnNotif(Number(req.params.id), req.user.sub);
  if (n.leida !== "si") {
    await Notificaciones.update(n.identificador, { leida: "si" });
    n.leida = "si";
  }
  res.json(notificacionShape(n));
});

// GET /notificaciones/:id/mensajes
exports.listarMensajes = asyncHandler(async (req, res) => {
  const n = await findOwnNotif(Number(req.params.id), req.user.sub);
  const page = Number(req.query.page) || 1;
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, count, error } = await supabase
    .from("mensajes")
    .select("*", { count: "exact" })
    .eq("notificacion", n.identificador)
    .range(from, to)
    .order("fecha", { ascending: true });
  if (error) throw error;

  res.json({
    data: (data || []).map(mensajeShape),
    meta: paginate({ page, limit, total: count || 0 }),
  });
});

// POST /notificaciones/:id/mensajes
exports.enviarMensaje = asyncHandler(async (req, res) => {
  const n = await findOwnNotif(Number(req.params.id), req.user.sub);
  const { contenido } = req.body || {};
  if (!contenido || !String(contenido).trim()) {
    throw new HttpError(400, "MENSAJE_CONTENIDO_VACIO", "El mensaje no puede estar vacío.");
  }
  const fecha = new Date().toISOString();
  const m = await Mensajes.create({
    notificacion: n.identificador,
    contenido: String(contenido).slice(0, 4000),
    emisor: "usuario",
    fecha,
  });
  // Marcar la notificación como tiene_mensajes='si'
  if (n.tiene_mensajes !== "si") {
    await Notificaciones.update(n.identificador, { tiene_mensajes: "si" });
  }
  res.status(201).json(mensajeShape(m));
});
