const supabase = require("../supabase-client");
const SolicitudesVenta = require("../models/solicitudes_venta");
const FotosSolicitudVenta = require("../models/fotos_solicitud_venta");
const ItemsCatalogo = require("../models/items_catalogo");
const ItemsCatalogoEstado = require("../models/items_catalogo_estado");
const Seguros = require("../models/seguros");
const SegurosExtension = require("../models/seguros_extension");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const Personas = require("../models/personas");
const HttpError = require("../lib/http-error");
const {
  base64ToBytea,
  solicitudShape,
  polizaShape,
  contactoAseguradoraShape,
  TIPOS_VALIDOS,
} = require("../lib/solicitud-venta-shape");
const {
  subastaResumen,
  paginate,
} = require("../lib/subasta-shape");
const { cantidadPiezasDeSubasta } = require("../lib/subastas-helper");
const { crearNotificacion } = require("../lib/notificaciones-helper");
const { notificarVenta } = require("../lib/solicitud-venta-notify");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function buildSubastaAsignada(subastaId) {
  if (!subastaId) return null;
  const sub = await Subastas.findById(subastaId);
  if (!sub) return null;
  const ext = await SubastasExtension.findOne({ subasta: sub.identificador });
  // cantidadPiezas y rematador: simplificamos a null para listados; el spec usa SubastaResumen pero
  // dentro de una solicitud no es crítico tener cantidadPiezas exacta.
  let rematadorNombre = null;
  if (sub.subastador) {
    const persona = await Personas.findById(sub.subastador);
    rematadorNombre = persona?.nombre || null;
  }
  const cantidadPiezas = await cantidadPiezasDeSubasta(sub.identificador);
  return subastaResumen({
    subasta: sub,
    ext,
    rematadorNombre,
    cantidadPiezas,
  });
}

// la póliza tiene datos base en seguros y datos de contacto en la extensión; los unimos acá
async function buildPoliza(nroPoliza) {
  if (!nroPoliza) return null;
  const seguro = await Seguros.findById(nroPoliza);
  if (!seguro) return null;
  const ext = await SegurosExtension.findOne({ nro_poliza: nroPoliza });
  const p = polizaShape(seguro);
  p.contactoAseguradora = ext?.telefono || ext?.email || null;
  return p;
}

async function findOwn(id, clienteId) {
  const row = await SolicitudesVenta.findById(id);
  if (!row || row.cliente !== clienteId) {
    throw new HttpError(
      404,
      "SOLICITUD_NO_ENCONTRADA",
      "La solicitud de venta no existe o no pertenece a tu cuenta.",
    );
  }
  return row;
}

async function buildPrecioVenta(productoId) {
  if (!productoId) return null;
  const item = await ItemsCatalogo.findOne({ producto: productoId });
  if (!item) return null;
  const estado = await ItemsCatalogoEstado.findById(item.identificador);
  return estado?.mejor_oferta != null ? Number(estado.mejor_oferta) : null;
}

async function fullShape(row) {
  const [subastaAsignada, poliza, fotosResult, precioVenta] = await Promise.all([
    buildSubastaAsignada(row.subasta_asignada),
    buildPoliza(row.seguro),
    supabase.from("fotos_solicitud_venta").select("*", { count: "exact", head: true }).eq("solicitud", row.identificador),
    buildPrecioVenta(row.producto),
  ]);
  const fotosCount = fotosResult.count || 0;
  return solicitudShape({ row, subastaAsignada, poliza, fotosCount, precioVenta });
}

// GET /solicitudes-venta
exports.listar = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(50, Number(req.query.limit) || 10);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from("solicitudes_venta")
    .select("*", { count: "exact" })
    .eq("cliente", req.user.sub);
  if (req.query.estado) q = q.eq("estado", req.query.estado);
  q = q.range(from, to).order("identificador", { ascending: false });

  const { data, count, error } = await q;
  if (error) throw error;

  const result = [];
  for (const row of data || []) {
    result.push(await fullShape(row));
  }
  res.json({ data: result, meta: paginate({ page, limit, total: count || 0 }) });
});

// POST /solicitudes-venta
exports.crear = asyncHandler(async (req, res) => {
  const {
    tipo,
    descripcion,
    nombreBien,
    imagenes,
    historia,
    nombreArtista,
    fechaObra,
    dueniosAnteriores,
    curiosidades,
    declaracionPropiedad,
  } = req.body || {};

  if (!TIPOS_VALIDOS.includes(tipo)) {
    throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "Tipo de bien inválido.", {
      campo: "tipo",
      valoresValidos: TIPOS_VALIDOS,
    });
  }
  if (!descripcion || String(descripcion).trim().length === 0) {
    throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "La descripción es obligatoria.", {
      campo: "descripcion",
    });
  }
  if (!Array.isArray(imagenes)) {
    throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "imagenes debe ser un array.", { campo: "imagenes" });
  }
  if (declaracionPropiedad !== true) {
    throw new HttpError(
      400,
      "VENTA_DECLARACION_FALTANTE",
      "Debés declarar que el bien te pertenece y no posee impedimentos para ser subastado.",
      { campo: "declaracionPropiedad" },
    );
  }

  const solicitud = await SolicitudesVenta.create({
    cliente: req.user.sub,
    tipo,
    nombre_bien: nombreBien ? String(nombreBien).slice(0, 200) : null,
    descripcion: String(descripcion).slice(0, 4000),
    historia: historia ? String(historia).slice(0, 4000) : null,
    nombre_artista: nombreArtista ? String(nombreArtista).slice(0, 200) : null,
    fecha_obra: fechaObra ? String(fechaObra).slice(0, 50) : null,
    duenos_anteriores: dueniosAnteriores ? String(dueniosAnteriores).slice(0, 4000) : null,
    curiosidades: curiosidades ? String(curiosidades).slice(0, 4000) : null,
    declaracion_propiedad: "si",
    estado: "enviada",
    fecha_creacion: new Date().toISOString(),
  });

  // Insertar fotos en paralelo; returning solo el pk para no bajar los bytes de la imagen de vuelta
  await Promise.all(
    imagenes.map((img) =>
      FotosSolicitudVenta.create(
        { solicitud: solicitud.identificador, foto: base64ToBytea(img) },
        { returning: 'identificador' }
      )
    )
  );

  res.status(201).json(await fullShape(solicitud));
});

// GET /solicitudes-venta/:id
exports.detalle = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);
  res.json(await fullShape(row));
});

// POST /solicitudes-venta/:id/aceptar-condiciones
exports.aceptarCondiciones = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);

  if (row.estado !== 'propuesta_pendiente') {
    throw new HttpError(409, 'SOLICITUD_ESTADO_INVALIDO', 'Solo podés aceptar o rechazar condiciones cuando hay una propuesta pendiente.', { estadoActual: row.estado });
  }

  const { aceptaValorBase, aceptaComisiones, cuentaCobro } = req.body || {};

  if (aceptaValorBase !== true || aceptaComisiones !== true) {
    // Rechazó condiciones → estado=rechazada
    const updated = await SolicitudesVenta.update(row.identificador, {
      estado: "rechazada_cliente",
      motivo_rechazo: "El cliente no aceptó valor base y/o comisiones.",
    });
    throw new HttpError(
      400,
      "VENTA_CONDICIONES_RECHAZADAS",
      "No aceptaste el valor base o las comisiones. Se procederá a la devolución del bien con cargo.",
      {
        valorBase: row.valor_base ? Number(row.valor_base) : null,
        comisiones: row.comisiones ? Number(row.comisiones) : null,
        gastoDevolucion: 2500,
      },
    );
  }

  if (!cuentaCobro || !cuentaCobro.tipo) {
    throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "Debés indicar la cuenta de cobro.", {
      campo: "cuentaCobro",
    });
  }
  if (!["nacional", "exterior"].includes(cuentaCobro.tipo)) {
    throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "cuentaCobro.tipo inválido.", {
      campo: "cuentaCobro.tipo",
    });
  }
  if (cuentaCobro.tipo === "nacional" && !cuentaCobro.cbu) {
    throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "CBU es obligatorio para cuenta nacional.", {
      camposInvalidos: ["cuentaCobro.cbu"],
    });
  }
  if (cuentaCobro.tipo === "exterior") {
    const faltan = ["swift", "iban", "pais", "moneda"].filter((k) => !cuentaCobro[k]);
    if (faltan.length) {
      throw new HttpError(400, "VENTA_DATOS_INVALIDOS", "Faltan datos de la cuenta exterior.", {
        camposInvalidos: faltan.map((f) => "cuentaCobro." + f),
      });
    }
  }

  const updated = await SolicitudesVenta.update(row.identificador, {
    estado: "pendiente_asignacion",
    cuenta_cobro_tipo: cuentaCobro.tipo,
    cuenta_cobro_banco: cuentaCobro.banco || null,
    cuenta_cobro_titular: cuentaCobro.titular || null,
    cuenta_cobro_cbu: cuentaCobro.cbu || null,
    cuenta_cobro_swift: cuentaCobro.swift || null,
    cuenta_cobro_iban: cuentaCobro.iban || null,
    cuenta_cobro_pais: cuentaCobro.pais || null,
    cuenta_cobro_moneda: cuentaCobro.moneda || null,
  });

  await notificarVenta(req.user.sub, {
    titulo: "Propuesta aceptada",
    mensaje: "Aceptaste la propuesta. Tu bien quedó pendiente de asignación a una subasta. Te avisaremos cuando se asigne.",
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Aceptaste la propuesta",
    emailParrafos: [
      "Aceptaste la propuesta de precio.",
      "Tu bien quedó pendiente de asignación a una subasta. Te avisaremos por mail y notificación cuando se asigne.",
    ],
  });

  res.json(await fullShape(updated));
});

// GET /solicitudes-venta/:id/poliza
exports.verPoliza = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);
  if (!row.seguro) {
    throw new HttpError(
      404,
      "POLIZA_NO_ENCONTRADA",
      "Tu bien aún no tiene póliza de seguro. Se genera cuando es aceptado y asignado a una subasta.",
    );
  }
  const poliza = await buildPoliza(row.seguro);
  if (!poliza) {
    throw new HttpError(404, "POLIZA_NO_ENCONTRADA", "Póliza no encontrada.");
  }
  res.json(poliza);
});

// GET /solicitudes-venta/:id/contactar-aseguradora
exports.contactarAseguradora = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);
  if (!row.seguro) {
    throw new HttpError(
      404,
      "POLIZA_NO_ENCONTRADA",
      "No se puede contactar a la aseguradora porque el bien no tiene póliza asignada.",
    );
  }
  const seguro = await Seguros.findById(row.seguro);
  const ext = await SegurosExtension.findOne({ nro_poliza: row.seguro });
  res.json(contactoAseguradoraShape(seguro, ext));
});

// POST /solicitudes-venta/:id/cancelar
exports.cancelar = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);

  if (row.estado !== "en_subasta") {
    throw new HttpError(409, "SOLICITUD_ESTADO_INVALIDO", "Solo podés cancelar un bien que ya fue asignado a una subasta.", {
      estadoActual: row.estado,
    });
  }

  if (row.producto) {
    const item = await ItemsCatalogo.findOne({ producto: row.producto });
    if (item) {
      await supabase.from("items_catalogo_estado").delete().eq("item", item.identificador);
      await supabase.from("items_catalogo").delete().eq("identificador", item.identificador);
    }
  }

  const updated = await SolicitudesVenta.update(row.identificador, {
    estado: "cancelado",
  });

  await notificarVenta(req.user.sub, {
    titulo: "Cancelaste la venta",
    mensaje: `Cancelaste la venta. Podés retirar tu bien en: ${row.ubicacion_deposito || "el depósito donde lo dejaste"}.`,
    accionUrl: `/solicitudes-venta/${row.identificador}`,
    emailSubject: "Cancelaste la venta de tu bien",
    emailParrafos: [
      "Confirmamos la cancelación de la venta.",
      `Podés retirar tu bien en: ${row.ubicacion_deposito || "el depósito donde lo dejaste"}.`,
    ],
  });

  res.json(await fullShape(updated));
});
