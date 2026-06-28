const supabase = require("../supabase-client");
const Asistentes = require("../models/asistentes");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const Pujos = require("../models/pujos");
const PujosExtension = require("../models/pujos_extension");
const ItemsCatalogo = require("../models/items_catalogo");
const Productos = require("../models/productos");
const Clientes = require("../models/clientes");
const HttpError = require("../lib/http-error");
const {
  tituloSubasta,
  fechaTimestamp,
  paginate,
} = require("../lib/subasta-shape");
const { solicitudShape } = require("../lib/solicitud-venta-shape");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function participacionShape(asistente) {
  const subasta = await Subastas.findById(asistente.subasta);
  const ext = subasta
    ? await SubastasExtension.findOne({ subasta: subasta.identificador })
    : null;

  // Pujas del asistente
  const { data: pujos } = await supabase
    .from("pujos")
    .select("*")
    .eq("asistente", asistente.identificador);

  const cantidadPujas = pujos?.length || 0;
  let montoMaximo = 0;
  let piezasGanadas = 0;
  for (const p of pujos || []) {
    const imp = Number(p.importe);
    if (imp > montoMaximo) montoMaximo = imp;
    if (p.ganador === "si") piezasGanadas++;
  }

  return {
    id: String(asistente.identificador),
    subastaId: subasta ? String(subasta.identificador) : null,
    tituloSubasta: subasta ? tituloSubasta(subasta, ext) : null,
    fecha: subasta ? fechaTimestamp(subasta) : null,
    ubicacion: subasta?.ubicacion || null,
    moneda: ext?.moneda || "ARS",
    cantidadPujas,
    piezasGanadas,
    montoMaximoPujado: montoMaximo,
  };
}

async function findOwnAsistente(id, clienteId) {
  const a = await Asistentes.findById(id);
  if (!a || a.cliente !== clienteId) {
    throw new HttpError(404, "PARTICIPACION_NO_ENCONTRADA", "Participación no encontrada.");
  }
  return a;
}

// GET /historial/participaciones
exports.participaciones = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(50, Number(req.query.limit) || 10);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, count, error } = await supabase
    .from("asistentes")
    .select("*", { count: "exact" })
    .eq("cliente", req.user.sub)
    .range(from, to)
    .order("identificador", { ascending: false });
  if (error) throw error;

  const result = [];
  for (const a of data || []) result.push(await participacionShape(a));
  res.json({ data: result, meta: paginate({ page, limit, total: count || 0 }) });
});

// GET /historial/participaciones/:id
exports.detalleParticipacion = asyncHandler(async (req, res) => {
  const a = await findOwnAsistente(Number(req.params.id), req.user.sub);
  res.json(await participacionShape(a));
});

// GET /historial/participaciones/:id/pujas
exports.pujasDeParticipacion = asyncHandler(async (req, res) => {
  const a = await findOwnAsistente(Number(req.params.id), req.user.sub);

  const { data: pujos } = await supabase
    .from("pujos")
    .select("*")
    .eq("asistente", a.identificador)
    .order("identificador", { ascending: true });

  const result = [];
  for (const p of pujos || []) {
    const [ext, item] = await Promise.all([
      PujosExtension.findOne({ pujo: p.identificador }),
      ItemsCatalogo.findById(p.item),
    ]);
    const producto = item ? await Productos.findById(item.producto) : null;
    result.push({
      numero: p.identificador,
      itemId: p.item,
      piezaNumero: item ? item.identificador : null,
      monto: Number(p.importe),
      timestamp: ext?.timestamp || null,
      piezaDescripcion: producto?.descripcion_catalogo || producto?.descripcion_completa || "",
      fueGanadora: p.ganador === "si",
    });
  }
  res.json(result);
});

async function getPrecioVenta(productoId) {
  if (!productoId) return null;
  const { data: item } = await supabase
    .from("items_catalogo")
    .select("identificador")
    .eq("producto", productoId)
    .maybeSingle();
  if (!item) return null;
  const { data: estado } = await supabase
    .from("items_catalogo_estado")
    .select("mejor_oferta")
    .eq("identificador", item.identificador)
    .maybeSingle();
  return estado?.mejor_oferta != null ? Number(estado.mejor_oferta) : null;
}

async function getMonedaSubasta(subastaId) {
  if (!subastaId) return null;
  const { data: ext } = await supabase
    .from("subastas_extension")
    .select("moneda")
    .eq("subasta", subastaId)
    .maybeSingle();
  return ext?.moneda ?? null;
}

// GET /historial/ventas
exports.ventas = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(50, Number(req.query.limit) || 10);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, count, error } = await supabase
    .from("solicitudes_venta")
    .select("*", { count: "exact" })
    .eq("cliente", req.user.sub)
    .eq("estado", "vendida")
    .range(from, to)
    .order("identificador", { ascending: false });
  if (error) throw error;

  const result = [];
  for (const row of data || []) {
    const precioVenta = await getPrecioVenta(row.producto);
    const moneda = await getMonedaSubasta(row.subasta_asignada);
    result.push({ ...solicitudShape({ row, precioVenta }), moneda });
  }

  res.json({ data: result, meta: paginate({ page, limit, total: count || 0 }) });
});

// GET /historial/metricas
exports.metricas = asyncHandler(async (req, res) => {
  const clienteId = req.user.sub;
  const cliente = await Clientes.findById(clienteId);

  // Asistencias del usuario
  const { data: asistencias } = await supabase
    .from("asistentes")
    .select("identificador, subasta")
    .eq("cliente", clienteId);

  const asistenteIds = (asistencias || []).map((a) => a.identificador);
  const subastaIds = (asistencias || []).map((a) => a.subasta);

  // Pujas del usuario
  let pujos = [];
  if (asistenteIds.length) {
    const { data } = await supabase
      .from("pujos")
      .select("*")
      .in("asistente", asistenteIds);
    pujos = data || [];
  }

  const totalOfertado = pujos.reduce((acc, p) => acc + Number(p.importe), 0);
  const totalGanadas = pujos.filter((p) => p.ganador === "si").length;

  // Pagado: importe de las compras pagadas
  const { data: registros } = await supabase
    .from("registro_de_subasta")
    .select("identificador, importe, comision")
    .eq("cliente", clienteId);
  let totalPagado = 0;
  for (const r of registros || []) {
    const { data: ext } = await supabase
      .from("registro_subasta_extension")
      .select("estado_pago")
      .eq("registro", r.identificador)
      .maybeSingle();
    if (ext?.estado_pago === "pagada") {
      totalPagado += Number(r.importe || 0) + Number(r.comision || 0);
    }
  }

  // Participaciones por categoría de subasta
  const participacionesPorCategoria = {};
  for (const sid of new Set(subastaIds)) {
    const s = await Subastas.findById(sid);
    if (s) {
      const cat = s.categoria || "comun";
      participacionesPorCategoria[cat] = (participacionesPorCategoria[cat] || 0) + 1;
    }
  }

  const totalSubastasAsistidas = new Set(subastaIds).size;
  const totalPujas = pujos.length;
  const porcentajeVictorias = totalPujas ? Math.round((totalGanadas / totalPujas) * 1000) / 10 : 0;
  const montoPromedioOfertado = totalPujas ? Math.round(totalOfertado / totalPujas) : 0;

  res.json({
    totalSubastasAsistidas,
    totalPujas,
    totalGanadas,
    porcentajeVictorias,
    totalOfertado,
    totalPagado,
    categoriaActual: cliente?.categoria || "comun",
    participacionesPorCategoria,
    montoPromedioOfertado,
  });
});
