const supabase = require("../supabase-client");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const Catalogos = require("../models/catalogos");
const ItemsCatalogo = require("../models/items_catalogo");
const ItemsCatalogoEstado = require("../models/items_catalogo_estado");
const Productos = require("../models/productos");
const ProductosExtension = require("../models/productos_extension");
const Personas = require("../models/personas");
const Asistentes = require("../models/asistentes");
const AsistentesExtension = require("../models/asistentes_extension");
const RegistroDeSubasta = require("../models/registro_de_subasta");
const RegistroSubastaExtension = require("../models/registro_subasta_extension");
const SolicitudesVenta = require("../models/solicitudes_venta");
const HttpError = require("../lib/http-error");

const EMPRESA_CLIENTE_ID = 1;
const {
  subastaResumen,
  piezaResumen,
  tituloSubasta,
  fechaTimestamp,
  estadoApi,
} = require("../lib/subasta-shape");
const { cantidadPiezasDeSubasta, piezaEnSubasta, quedanItemsPorSubastar } = require("../lib/subastas-helper");
const realtime = require("../lib/realtime");
const { crearNotificacion } = require("../lib/notificaciones-helper");
const itemTimer = require("../lib/item-timer");

const CATEGORIAS_VALIDAS = ["comun", "especial", "plata", "oro", "platino"];
const MONEDAS_VALIDAS = ["ARS", "USD"];
const DURACION_INICIAL_MS = 120_000; // 2 minutos — tiempo para primera puja

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function rematadorNombre(subastadorId) {
  if (!subastadorId) return null;
  const persona = await Personas.findById(subastadorId);
  return persona?.nombre || null;
}

async function findOrCreateCatalogo(subastaId) {
  const existing = await Catalogos.findOne({ subasta: subastaId });
  if (existing) return existing;
  return Catalogos.create({ subasta: subastaId });
}

// POST /admin/subastas
exports.crear = asyncHandler(async (req, res) => {
  const {
    fecha,
    hora,
    categoria,
    ubicacion,
    subastadorId,
    moneda,
    esColeccion,
    nombreColeccion,
  } = req.body || {};

  const camposFaltantes = ["fecha", "hora", "categoria"].filter((f) => !req.body?.[f]);
  if (camposFaltantes.length) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "Faltan campos obligatorios.", {
      camposFaltantes,
    });
  }
  if (!CATEGORIAS_VALIDAS.includes(categoria)) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "Categoría inválida.", {
      valoresValidos: CATEGORIAS_VALIDAS,
    });
  }
  if (moneda && !MONEDAS_VALIDAS.includes(moneda)) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "Moneda inválida.", {
      valoresValidos: MONEDAS_VALIDAS,
    });
  }

  const subasta = await Subastas.create({
    fecha,
    hora: hora || "00:00:00",
    categoria,
    ubicacion: ubicacion || null,
    subastador: subastadorId || null,
    estado: "abierta",
  });

  const ext = await SubastasExtension.create({
    subasta: subasta.identificador,
    moneda: moneda || "ARS",
    es_coleccion: esColeccion ? "si" : "no",
    nombre_coleccion: esColeccion && nombreColeccion ? nombreColeccion : null,
  });

  const rematador = await rematadorNombre(subasta.subastador);
  res.status(201).json(subastaResumen({ subasta, ext, rematadorNombre: rematador, cantidadPiezas: 0 }));
});

// PUT /admin/subastas/:id
exports.actualizar = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const subasta = await Subastas.findById(id);
  if (!subasta) {
    throw new HttpError(404, "SUBASTA_NO_ENCONTRADA", "La subasta no existe.");
  }
  if (subasta.estado === "cerrada") {
    throw new HttpError(409, "SUBASTA_CERRADA", "No se puede modificar una subasta cerrada.");
  }

  const {
    fecha,
    hora,
    categoria,
    ubicacion,
    subastadorId,
    moneda,
    esColeccion,
    nombreColeccion,
  } = req.body || {};

  if (categoria && !CATEGORIAS_VALIDAS.includes(categoria)) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "Categoría inválida.", {
      valoresValidos: CATEGORIAS_VALIDAS,
    });
  }
  if (moneda && !MONEDAS_VALIDAS.includes(moneda)) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "Moneda inválida.", {
      valoresValidos: MONEDAS_VALIDAS,
    });
  }

  const subUpdates = {};
  if (fecha !== undefined) subUpdates.fecha = fecha;
  if (hora !== undefined) subUpdates.hora = hora;
  if (categoria !== undefined) subUpdates.categoria = categoria;
  if (ubicacion !== undefined) subUpdates.ubicacion = ubicacion;
  if (subastadorId !== undefined) subUpdates.subastador = subastadorId;

  const updatedSub = Object.keys(subUpdates).length
    ? await Subastas.update(id, subUpdates)
    : subasta;

  const extUpdates = {};
  if (moneda !== undefined) extUpdates.moneda = moneda;
  if (esColeccion !== undefined) extUpdates.es_coleccion = esColeccion ? "si" : "no";
  if (nombreColeccion !== undefined) extUpdates.nombre_coleccion = nombreColeccion;

  let ext = await SubastasExtension.findOne({ subasta: id });
  if (Object.keys(extUpdates).length) {
    if (ext) {
      ext = await SubastasExtension.update(id, extUpdates);
    } else {
      ext = await SubastasExtension.create({ subasta: id, ...extUpdates });
    }
  }

  const rematador = await rematadorNombre(updatedSub.subastador);
  const cantidadPiezas = await cantidadPiezasDeSubasta(id);
  res.json(subastaResumen({ subasta: updatedSub, ext, rematadorNombre: rematador, cantidadPiezas }));
});

// POST /admin/subastas/:id/items
// Body: { productoId, precioBase, cantidadElementos }
exports.agregarItem = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const subasta = await Subastas.findById(subastaId);
  if (!subasta) {
    throw new HttpError(404, "SUBASTA_NO_ENCONTRADA", "La subasta no existe.");
  }
  if (subasta.estado === "cerrada") {
    throw new HttpError(409, "SUBASTA_CERRADA", "No se pueden agregar ítems a una subasta cerrada.");
  }

  const { productoId, precioBase, cantidadElementos } = req.body || {};
  if (!productoId || !precioBase) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "productoId y precioBase son requeridos.", {
      camposFaltantes: ["productoId", "precioBase"].filter((f) => !req.body?.[f]),
    });
  }
  if (Number(precioBase) <= 0) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "precioBase debe ser mayor a 0.");
  }

  const producto = await Productos.findById(Number(productoId));
  if (!producto) {
    throw new HttpError(404, "PRODUCTO_NO_ENCONTRADO", "El producto indicado no existe.");
  }

  const ext = await SubastasExtension.findOne({ subasta: subastaId });
  if (ext?.es_coleccion === "si") {
    const catalogo = await Catalogos.findOne({ subasta: subastaId });
    if (catalogo) {
      const { data: itemsExistentes } = await supabase
        .from("items_catalogo")
        .select("producto")
        .eq("catalogo", catalogo.identificador);
      if (itemsExistentes?.length > 0) {
        const primerProducto = await Productos.findById(itemsExistentes[0].producto);
        if (primerProducto && primerProducto.duenio !== producto.duenio) {
          throw new HttpError(400, "COLECCION_DUENIO_DISTINTO",
            "En una subasta de colección todos los bienes deben pertenecer al mismo dueño.");
        }
      }
    }
  }

  // Actualizar cantidadElementos si se provee
  if (cantidadElementos !== undefined) {
    const prodExt = await ProductosExtension.findOne({ producto: producto.identificador });
    if (prodExt) {
      await ProductosExtension.update(producto.identificador, {
        cantidad_elementos: Number(cantidadElementos),
      });
    }
  }

  const catalogo = await findOrCreateCatalogo(subastaId);

  const item = await ItemsCatalogo.create({
    catalogo: catalogo.identificador,
    producto: producto.identificador,
    precio_base: Number(precioBase),
  });

  await ItemsCatalogoEstado.create({
    item: item.identificador,
    estado: "pendiente",
    mejor_oferta: null,
  });

  const prodExt = await ProductosExtension.findOne({ producto: producto.identificador });
  const estadoItem = await ItemsCatalogoEstado.findById(item.identificador);
  res.status(201).json(piezaResumen({ item, producto, prodExt, estadoItem, precioVisible: true }));
});

// Lógica de cierre de ítem — usada por el endpoint manual, el timer automático y realizarPuja
async function ejecutarCierreItem(subastaId, itemId) {
  const item = await ItemsCatalogo.findById(itemId);
  if (!item) return;

  const estadoItem = await ItemsCatalogoEstado.findOne({ item: itemId });
  if (!estadoItem || estadoItem.estado !== "en_subasta") return;

  // El ganador es la puja de mayor importe: cada puja superó a la mejor oferta vigente al
  // insertarse, así que el importe es la fuente de verdad (no el flag, que puede divergir).
  const { data: pujas } = await supabase
    .from("pujos")
    .select("*")
    .eq("item", itemId)
    .order("importe", { ascending: false });
  const pujoGanador = pujas?.[0] || null;

  if (!pujoGanador) {
    const precioBase = Number(item.precio_base);
    const producto = await Productos.findById(item.producto);
    const registroEmpresa = await RegistroDeSubasta.create({
      cliente: EMPRESA_CLIENTE_ID,
      duenio: producto?.duenio ?? null,
      subasta: subastaId,
      producto: item.producto,
      importe: precioBase,
      comision: 1,
    });
    await RegistroSubastaExtension.create({
      registro: registroEmpresa.identificador,
      estado_pago: "pagada",
      metodo_entrega: "retiro_personal",
    });
    await ItemsCatalogoEstado.update(itemId, { estado: "vendida", expiry_at: null });
    await supabase.from("solicitudes_venta").update({ estado: "vendida" }).eq("producto", item.producto);
    realtime.broadcast(subastaId, {
      event: "pieza_cerrada",
      itemId: String(itemId),
      numeroItem: itemId,
      ganadorClienteId: EMPRESA_CLIENTE_ID,
      montoGanador: precioBase,
      compraId: String(registroEmpresa.identificador),
    });
    if (!(await quedanItemsPorSubastar(subastaId))) {
      await cerrarSubastaCompleta(subastaId);
    }
    return { vendida: true, ganador: null, compraEmpresa: true, monto: precioBase };
  }

  // Reconciliar el flag ganador con el resultado real (por si una carrera lo dejó inconsistente).
  await supabase
    .from("pujos")
    .update({ ganador: "no" })
    .eq("item", itemId)
    .neq("identificador", pujoGanador.identificador);
  await supabase.from("pujos").update({ ganador: "si" }).eq("identificador", pujoGanador.identificador);

  const asistente = await Asistentes.findById(pujoGanador.asistente);
  if (!asistente) throw new Error("No se encontró el asistente del postor ganador.");

  // El ganador sale de la subasta y pasa al flujo de pago: lo desconectamos para que pueda entrar a otra.
  await AsistentesExtension.update(asistente.identificador, { estado_conexion: "desconectado" });

  const clienteGanadorId = asistente.cliente;
  const montoGanador = Number(pujoGanador.importe);
  const comision = Math.round(montoGanador * 0.1);
  const producto = await Productos.findById(item.producto);

  const registro = await RegistroDeSubasta.create({
    cliente: clienteGanadorId,
    duenio: producto?.duenio ?? null,
    subasta: subastaId,
    producto: item.producto,
    importe: montoGanador,
    comision,
  });

  await ItemsCatalogoEstado.update(itemId, { estado: "vendida", expiry_at: null });
  await supabase.from("solicitudes_venta").update({ estado: "vendida" }).eq("producto", item.producto);

  await crearNotificacion(clienteGanadorId, {
    tipo: "puja_ganada",
    titulo: "¡Ganaste la subasta!",
    mensaje: `Ganaste la pieza #${itemId} por $${montoGanador}. Procedé al pago para completar tu compra.`,
    accionUrl: `/compras/${registro.identificador}`,
  });

  realtime.broadcast(subastaId, {
    event: "pieza_cerrada",
    itemId: String(itemId),
    numeroItem: itemId,
    ganadorClienteId: clienteGanadorId,
    montoGanador,
    compraId: String(registro.identificador),
  });

  if (!(await quedanItemsPorSubastar(subastaId))) {
    await cerrarSubastaCompleta(subastaId);
  }

  return {
    vendida: true,
    compraId: String(registro.identificador),
    ganadorClienteId: clienteGanadorId,
    montoGanador,
  };
}

// POST /admin/subastas/:id/items/:itemId/activar
exports.activarItem = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const subasta = await Subastas.findById(subastaId);
  if (!subasta || subasta.estado !== "abierta") {
    throw new HttpError(404, "SUBASTA_NO_DISPONIBLE", "La subasta no existe o no está en curso.");
  }

  const item = await ItemsCatalogo.findById(itemId);
  if (!item) {
    throw new HttpError(404, "ITEM_NO_ENCONTRADO", "El ítem no existe en el catálogo.");
  }

  const estadoItem = await ItemsCatalogoEstado.findOne({ item: itemId });
  if (!estadoItem || estadoItem.estado !== "pendiente") {
    throw new HttpError(409, "ITEM_NO_PENDIENTE", "El ítem no está pendiente. Solo se pueden activar ítems pendientes.");
  }

  const piezaActiva = await piezaEnSubasta(subastaId);
  if (piezaActiva) {
    throw new HttpError(409, "SUBASTA_PIEZA_YA_ACTIVA", "Ya hay una pieza activa en esta subasta. Cerrala antes de activar la siguiente.");
  }

  const expiryAt = new Date(Date.now() + DURACION_INICIAL_MS).toISOString();
  await ItemsCatalogoEstado.update(itemId, { estado: "en_subasta", mejor_oferta: null, expiry_at: expiryAt });

  const [producto, fotosResult] = await Promise.all([
    Productos.findById(item.producto),
    supabase.from("fotos").select("*", { count: "exact", head: true }).eq("producto", item.producto),
  ]);
  const cantFotos = fotosResult.count || 0;
  const precioBase = Number(item.precio_base);

  itemTimer.set(itemId, subastaId, expiryAt, ejecutarCierreItem);

  realtime.broadcast(subastaId, {
    event: "pieza_nueva",
    numeroItem: itemId,
    descripcion: producto?.descripcion_catalogo || producto?.descripcion_completa || "",
    imagenPrincipal: cantFotos > 0 ? `/v1/piezas/${itemId}/fotos/0` : null,
    cantFotos,
    precioBase,
    mejorOferta: precioBase,
    expiryAt,
  });

  res.json({ activado: true, itemId, expiryAt });
});

// POST /admin/subastas/:id/items/:itemId/cerrar
exports.cerrarItem = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const subasta = await Subastas.findById(subastaId);
  if (!subasta || subasta.estado !== "abierta") {
    throw new HttpError(404, "SUBASTA_NO_DISPONIBLE", "La subasta no existe o no está en curso.");
  }
  const estadoItem = await ItemsCatalogoEstado.findOne({ item: itemId });
  if (!estadoItem || estadoItem.estado !== "en_subasta") {
    throw new HttpError(409, "ITEM_NO_EN_SUBASTA", "El ítem no está activo en subasta en este momento.");
  }

  itemTimer.cancel(itemId);
  const result = await ejecutarCierreItem(subastaId, itemId);
  if (!result) throw new HttpError(404, "ITEM_NO_ENCONTRADO", "El ítem no existe en el catálogo.");

  const status = result.compraEmpresa ? 200 : 201;
  res.status(status).json(result);
});

// POST /admin/subastas/:id/cerrar
exports.cerrarSubasta = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);

  const subasta = await Subastas.findById(subastaId);
  if (!subasta) throw new HttpError(404, "SUBASTA_NO_ENCONTRADA", "La subasta no existe.");
  if (subasta.estado === "cerrada") throw new HttpError(409, "SUBASTA_YA_CERRADA", "La subasta ya está cerrada.");

  const piezaActiva = await piezaEnSubasta(subastaId);
  if (piezaActiva) {
    throw new HttpError(409, "SUBASTA_PIEZA_ACTIVA", "Hay una pieza en subasta activa. Cerrala antes de cerrar la subasta.");
  }

  await cerrarSubastaCompleta(subastaId);

  res.json({ cerrada: true, subastaId: String(subastaId) });
});

async function cerrarSubastaCompleta(subastaId) {
  await Subastas.update(subastaId, { estado: "cerrada" });
  const { data: asistentes } = await supabase
    .from("asistentes")
    .select("identificador")
    .eq("subasta", subastaId);
  for (const a of asistentes || []) {
    await AsistentesExtension.update(a.identificador, { estado_conexion: "desconectado" });
  }
  realtime.broadcast(subastaId, { event: "subasta_cerrada", subastaId: String(subastaId) });
}

exports.ejecutarCierreItem = ejecutarCierreItem;
