const supabase = require("../supabase-client");
const SolicitudesVenta = require("../models/solicitudes_venta");
const Productos = require("../models/productos");
const ProductosExtension = require("../models/productos_extension");
const ArtistasPiezas = require("../models/artistas_piezas");
const Fotos = require("../models/fotos");
const Duenios = require("../models/duenios");
const Clientes = require("../models/clientes");
const Catalogos = require("../models/catalogos");
const ItemsCatalogo = require("../models/items_catalogo");
const ItemsCatalogoEstado = require("../models/items_catalogo_estado");
const Seguros = require("../models/seguros");
const SegurosExtension = require("../models/seguros_extension");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const HttpError = require("../lib/http-error");
const { solicitudShape, polizaShape } = require("../lib/solicitud-venta-shape");
const { crearNotificacion } = require("../lib/notificaciones-helper");
const { notificarVenta } = require("../lib/solicitud-venta-notify");

const ADMIN_EMPLEADO_ID = Number(process.env.ADMIN_EMPLEADO_ID);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function findSolicitud(id) {
  const row = await SolicitudesVenta.findById(id);
  if (!row) {
    throw new HttpError(404, "SOLICITUD_NO_ENCONTRADA", "La solicitud de venta no existe.");
  }
  return row;
}

async function findOrCreateDuenio(clienteId) {
  const existing = await Duenios.findById(clienteId);
  if (existing) return existing;
  const cliente = await Clientes.findById(clienteId);
  const { data, error } = await supabase
    .from("duenios")
    .insert({
      identificador: clienteId,
      numero_pais: cliente?.numero_pais ?? null,
      verificacion_financiera: "si",
      verificacion_judicial: "si",
      calificacion_riesgo: 1,
      verificador: ADMIN_EMPLEADO_ID,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findOrCreateCatalogo(subastaId) {
  const existing = await Catalogos.findOne({ subasta: subastaId });
  if (existing) return existing;
  return Catalogos.create({
    subasta: subastaId,
    descripcion: `Catálogo subasta #${subastaId}`,
    responsable: ADMIN_EMPLEADO_ID,
  });
}

// POST /admin/solicitudes-venta/:id/revisar
exports.revisar = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (row.estado !== "enviada") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede poner en revisión una solicitud en estado 'enviada'.", {
      estadoActual: row.estado,
    });
  }
  const updated = await SolicitudesVenta.update(row.identificador, { estado: "en_revision_virtual" });
  res.json(solicitudShape({ row: updated }));
});

// POST /admin/solicitudes-venta/:id/aceptar-revision
// Body: { ubicacionDeposito, direccionEnvio, fechaLimiteEntrega }
exports.aceptarRevision = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (row.estado !== "en_revision_virtual") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede aceptar la revisión de una solicitud en estado 'en_revision_virtual'.", {
      estadoActual: row.estado,
    });
  }

  const { ubicacionDeposito, direccionEnvio, fechaLimiteEntrega } = req.body || {};
  if (!ubicacionDeposito || !String(ubicacionDeposito).trim()) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "ubicacionDeposito es requerido.", { campo: "ubicacionDeposito" });
  }
  if (!fechaLimiteEntrega || !String(fechaLimiteEntrega).trim()) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "fechaLimiteEntrega es requerido.", { campo: "fechaLimiteEntrega" });
  }

  const updated = await SolicitudesVenta.update(row.identificador, {
    estado: "esperando_entrega",
    ubicacion_deposito: String(ubicacionDeposito).slice(0, 350),
    direccion_envio: direccionEnvio ? String(direccionEnvio).slice(0, 350) : null,
    fecha_limite_entrega: String(fechaLimiteEntrega).slice(0, 100),
  });

  await notificarVenta(row.cliente, {
    titulo: "Tu bien fue aceptado para revisión",
    mensaje: `Llevá tu bien a: ${ubicacionDeposito}. Fecha límite: ${fechaLimiteEntrega}.`,
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Aceptamos tu bien — coordiná la entrega",
    emailParrafos: [
      "Aceptamos tu bien para revisarlo físicamente.",
      `Lugar de entrega: ${ubicacionDeposito}.`,
      `Tenés tiempo hasta: ${fechaLimiteEntrega}.`,
    ],
  });

  res.json(solicitudShape({ row: updated }));
});

// POST /admin/solicitudes-venta/:id/enviar-propuesta
// Body: { valorBase, comisiones, moneda }
exports.enviarPropuesta = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (row.estado !== "en_revision_fisica") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede enviar una propuesta de una solicitud en estado 'en_revision_fisica'.", {
      estadoActual: row.estado,
    });
  }

  const { valorBase, comisiones, moneda } = req.body || {};
  if (!valorBase || Number(valorBase) <= 0) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "valorBase es requerido y debe ser mayor a 0.", { campo: "valorBase" });
  }
  if (comisiones == null || Number(comisiones) < 0) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "comisiones es requerido.", { campo: "comisiones" });
  }

  const monedaValida = ["USD", "ARS"].includes(moneda) ? moneda : (row.moneda || "USD");

  let productoId = row.producto;
  if (!productoId) {
    const duenio = await findOrCreateDuenio(row.cliente);

    const producto = await Productos.create({
      descripcion_completa: row.descripcion,
      descripcion_catalogo: row.descripcion,
      duenio: duenio.identificador,
      revisor: ADMIN_EMPLEADO_ID,
    });
    productoId = producto.identificador;

    await ProductosExtension.create({
      producto: productoId,
      es_obra_de_arte: row.tipo === "arte" ? "si" : "no",
      cantidad_elementos: 1,
    });

    if (row.tipo === "arte" && row.nombre_artista) {
      await ArtistasPiezas.create({
        producto: productoId,
        nombre_artista: row.nombre_artista,
        fecha_obra: row.fecha_obra || null,
        historia: row.historia || null,
      });
    }

    const { data: fotosOrigen } = await supabase
      .from("fotos_solicitud_venta")
      .select("foto")
      .eq("solicitud", row.identificador)
      .order("identificador", { ascending: true });

    for (const f of fotosOrigen || []) {
      await Fotos.create({ producto: productoId, foto: f.foto });
    }
  }

  const updated = await SolicitudesVenta.update(row.identificador, {
    estado: "propuesta_pendiente",
    valor_base: Number(valorBase),
    comisiones: Number(comisiones),
    costo_envio: Number((Number(valorBase) * 0.02).toFixed(2)),
    producto: productoId,
    moneda: monedaValida,
  });

  await notificarVenta(row.cliente, {
    titulo: "Recibiste una propuesta de precio",
    mensaje: `Valor base propuesto: $${valorBase}. Revisá las condiciones en la app.`,
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Tenés una propuesta de precio",
    emailParrafos: [
      "Ya tenemos tu bien y preparamos una propuesta de precio.",
      `Valor base propuesto: $${valorBase} (${monedaValida}).`,
      `Comisión: ${comisiones}%.`,
    ],
  });

  res.json(solicitudShape({ row: updated }));
});

// POST /admin/solicitudes-venta/:id/rechazar
// Body: { motivoRechazo }
exports.rechazar = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (!["enviada", "en_revision_virtual", "propuesta_pendiente"].includes(row.estado)) {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede rechazar una solicitud en estado 'enviada', 'en_revision_virtual' o 'propuesta_pendiente'.", {
      estadoActual: row.estado,
    });
  }

  const { motivoRechazo, costoDevolucion, direccionDevolucion } = req.body || {};
  if (!motivoRechazo || !String(motivoRechazo).trim()) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "motivoRechazo es requerido.", { campo: "motivoRechazo" });
  }

  const updated = await SolicitudesVenta.update(row.identificador, {
    estado: "rechazada_admin",
    motivo_rechazo: String(motivoRechazo).slice(0, 2000),
    costo_envio: costoDevolucion ? Number(costoDevolucion) : null,
    direccion_envio: direccionDevolucion ? String(direccionDevolucion) : null,
  });

  await notificarVenta(row.cliente, {
    titulo: "Tu solicitud fue rechazada",
    mensaje: `Tu solicitud de venta fue rechazada. Motivo: ${motivoRechazo}.`,
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Tu solicitud fue rechazada",
    emailParrafos: [
      "Lamentablemente no podemos avanzar con tu solicitud de venta.",
      `Motivo: ${motivoRechazo}.`,
    ],
  });

  res.json(solicitudShape({ row: updated }));
});

// POST /admin/solicitudes-venta/:id/asignar-subasta
// Body: { subastaId }
exports.asignarSubasta = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (row.estado !== "pendiente_asignacion") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede asignar a subasta una solicitud en estado 'pendiente_asignacion'.", {
      estadoActual: row.estado,
    });
  }
  if (!row.producto) {
    throw new HttpError(409, "SOLICITUD_SIN_PRODUCTO", "La solicitud no tiene producto generado. Primero aceptá la solicitud.");
  }

  const { subastaId } = req.body || {};
  if (!subastaId) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "subastaId es requerido.", { campo: "subastaId" });
  }

  const subasta = await Subastas.findById(Number(subastaId));
  if (!subasta) {
    throw new HttpError(404, "SUBASTA_NO_ENCONTRADA", "La subasta indicada no existe.");
  }

  const subExt = await SubastasExtension.findOne({ subasta: subasta.identificador });
  const monedaSubasta = subExt?.moneda || "ARS";
  const monedaSolicitud = row.moneda || "USD";
  if (monedaSubasta !== monedaSolicitud) {
    throw new HttpError(400, "MONEDA_INCOMPATIBLE",
      `La solicitud cotiza en ${monedaSolicitud} pero la subasta es en ${monedaSubasta}.`,
      { monedaSolicitud, monedaSubasta }
    );
  }

  const catalogo = await findOrCreateCatalogo(Number(subastaId));

  const item = await ItemsCatalogo.create({
    catalogo: catalogo.identificador,
    producto: row.producto,
    precio_base: row.valor_base,
    comision: row.comisiones,
  });

  await ItemsCatalogoEstado.create({
    item: item.identificador,
    estado: "pendiente",
    mejor_oferta: null,
  });

  const updated = await SolicitudesVenta.update(row.identificador, {
    estado: "en_subasta",
    subasta_asignada: Number(subastaId),
  });

  const cuando = subasta.fecha || "a confirmar";
  const donde = subasta.ubicacion || "a confirmar";
  await notificarVenta(row.cliente, {
    titulo: "Tu bien fue asignado a una subasta",
    mensaje: `Subasta #${subastaId}. Si la fecha no te conviene, podés cancelar desde la app.`,
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Tu bien ya tiene subasta asignada",
    emailParrafos: [
      `Tu bien fue asignado a la subasta #${subastaId}.`,
      `Cuándo: ${cuando}. Dónde: ${donde}.`,
      "Si la fecha te queda lejos, podés cancelar desde la app y retirar tu bien donde lo dejaste.",
    ],
  });

  res.json(solicitudShape({ row: updated }));
});

// POST /admin/solicitudes-venta/:id/seguro
// Body: { nroPoliza, compania, valorAsegurado, telefono, email, web }
exports.crearSeguro = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (!["en_revision_fisica", "en_subasta"].includes(row.estado)) {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede crear un seguro para solicitudes en revisión física o en subasta.", {
      estadoActual: row.estado,
    });
  }

  const { nroPoliza, compania, valorAsegurado, telefono, email, web } = req.body || {};
  const missingFields = ["nroPoliza", "compania", "valorAsegurado"].filter((f) => !req.body?.[f]);
  if (missingFields.length) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "Faltan campos obligatorios.", {
      camposFaltantes: missingFields,
    });
  }

  const seguro = await Seguros.create({
    nro_poliza: nroPoliza,
    compania,
    importe: Number(valorAsegurado)
  });

  await SegurosExtension.create({
    nro_poliza: seguro.nro_poliza,
    telefono: telefono || null,
    email: email || null,
    web: web || null,
  });

  await SolicitudesVenta.update(row.identificador, { seguro: seguro.nro_poliza });

  res.status(201).json(polizaShape(seguro));
});

// POST /admin/solicitudes-venta/:id/confirmar-recepcion
exports.confirmarRecepcion = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (row.estado !== "esperando_entrega") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede confirmar recepción de una solicitud en estado 'esperando_entrega'.", {
      estadoActual: row.estado,
    });
  }
  const updated = await SolicitudesVenta.update(row.identificador, { estado: "en_revision_fisica" });
  await notificarVenta(row.cliente, {
    titulo: "Bien recibido en depósito",
    mensaje: "Tu bien llegó a nuestro depósito y está siendo inspeccionado. Pronto recibirás una propuesta de precio.",
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Recibimos tu bien",
    emailParrafos: [
      "Tu bien llegó a nuestro depósito y lo estamos inspeccionando.",
      "Cuando termine la revisión te enviaremos una propuesta de precio (o te avisaremos si no podemos avanzar).",
    ],
  });
  res.json(solicitudShape({ row: updated }));
});

// POST /admin/solicitudes-venta/:id/rechazar-deposito
exports.rechazarDeposito = asyncHandler(async (req, res) => {
  const row = await findSolicitud(Number(req.params.id));
  if (row.estado !== "en_revision_fisica") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo se puede rechazar en depósito una solicitud en estado 'en_revision_fisica'.", {
      estadoActual: row.estado,
    });
  }
  const { motivoRechazo, costoDevolucion, direccionDevolucion } = req.body || {};
  if (!motivoRechazo || !String(motivoRechazo).trim()) {
    throw new HttpError(400, "ADMIN_DATOS_INVALIDOS", "motivoRechazo es requerido.", { campo: "motivoRechazo" });
  }
  const updateData = {
    estado: "rechazada_deposito",
    motivo_rechazo: String(motivoRechazo).slice(0, 2000),
    costo_envio: costoDevolucion ? Number(costoDevolucion) : null,
    direccion_envio: direccionDevolucion ? String(direccionDevolucion) : null,
  };
  const updated = await SolicitudesVenta.update(row.identificador, updateData);
  await notificarVenta(row.cliente, {
    titulo: "Bien rechazado en depósito",
    mensaje: `Tu bien no superó la inspección física. Motivo: ${motivoRechazo}`,
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "No podemos avanzar con tu bien",
    emailParrafos: [
      "Revisamos tu bien físicamente y no podemos avanzar con la venta.",
      `Motivo: ${motivoRechazo}.`,
      "Coordinaremos la devolución del bien.",
    ],
  });
  res.json(solicitudShape({ row: updated }));
});
