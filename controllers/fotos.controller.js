const supabase = require("../supabase-client");
const ItemsCatalogo = require("../models/items_catalogo");
const SolicitudesVenta = require("../models/solicitudes_venta");
const HttpError = require("../lib/http-error");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function byteaToBuffer(hex) {
  return Buffer.from(String(hex).replace(/^\\x/, ""), "hex");
}

function detectMime(buf) {
  if (buf.length < 4) return "application/octet-stream";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "application/octet-stream";
}

// GET /v1/piezas/:id/fotos/:n  (public — misma auth que detallePieza)
exports.fotoPieza = asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "FOTO_INDICE_INVALIDO", "El índice de foto debe ser un entero no negativo.");
  }

  const item = await ItemsCatalogo.findById(itemId);
  if (!item) throw new HttpError(404, "PIEZA_NO_ENCONTRADA", "Pieza no encontrada.");

  const { data, error } = await supabase
    .from("fotos")
    .select("foto")
    .eq("producto", item.producto)
    .order("identificador", { ascending: true })
    .range(n, n);
  if (error) throw error;
  if (!data || !data[0]) throw new HttpError(404, "FOTO_NO_ENCONTRADA", "Foto no encontrada.");

  const buf = byteaToBuffer(data[0].foto);
  res.set("Content-Type", detectMime(buf));
  res.set("Cache-Control", "public, max-age=86400");
  res.send(buf);
});

// GET /v1/admin/clientes/:id/documento/:lado  (frente | dorso — requiere admin)
exports.fotoDocumentoCliente = asyncHandler(async (req, res) => {
  const clienteId = Number(req.params.id);
  const lado = req.params.lado;
  if (!["frente", "dorso"].includes(lado)) {
    throw new HttpError(400, "FOTO_LADO_INVALIDO", "El lado debe ser 'frente' o 'dorso'.");
  }

  const columna = lado === "frente" ? "foto_frente" : "foto_dorso";
  const { data, error } = await supabase
    .from("fotos_documento")
    .select(columna)
    .eq("cliente", clienteId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data[columna]) throw new HttpError(404, "FOTO_NO_ENCONTRADA", "Foto no encontrada.");

  const buf = byteaToBuffer(data[columna]);
  res.set("Content-Type", detectMime(buf));
  res.set("Cache-Control", "private, max-age=3600");
  res.send(buf);
});

// GET /v1/solicitudes-venta/:id/fotos/:n  (requiere auth + ownership)
exports.fotoSolicitud = asyncHandler(async (req, res) => {
  const solicitudId = Number(req.params.id);
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "FOTO_INDICE_INVALIDO", "El índice de foto debe ser un entero no negativo.");
  }

  const sol = await SolicitudesVenta.findById(solicitudId);
  if (!sol || sol.cliente !== req.user.sub) {
    throw new HttpError(404, "SOLICITUD_NO_ENCONTRADA", "Solicitud no encontrada.");
  }

  const { data, error } = await supabase
    .from("fotos_solicitud_venta")
    .select("foto")
    .eq("solicitud", solicitudId)
    .order("identificador", { ascending: true })
    .range(n, n);
  if (error) throw error;
  if (!data || !data[0]) throw new HttpError(404, "FOTO_NO_ENCONTRADA", "Foto no encontrada.");

  const buf = byteaToBuffer(data[0].foto);
  res.set("Content-Type", detectMime(buf));
  res.set("Cache-Control", "public, max-age=86400");
  res.send(buf);
});
