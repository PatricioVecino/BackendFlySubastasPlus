const supabase = require("../supabase-client");
const RegistroDeSubasta = require("../models/registro_de_subasta");
const RegistroSubastaExtension = require("../models/registro_subasta_extension");
const Productos = require("../models/productos");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const MediosPago = require("../models/medios_pago");
const Asistentes = require("../models/asistentes");
const AsistentesExtension = require("../models/asistentes_extension");
const Multas = require("../models/multas");
const HttpError = require("../lib/http-error");
const { paginate, tituloSubasta } = require("../lib/subasta-shape");
const { aliasPorDefecto, montoDisponible } = require("../lib/medio-pago-shape");
const ItemsCatalogo = require("../models/items_catalogo");
const { crearNotificacion } = require("../lib/notificaciones-helper");
const { evaluarYActualizarCategoria } = require("../lib/categoria-upgrade");

async function verificarVencimientoCompra(row, ext) {
  if (
    ext?.estado_pago !== "fondos_insuficientes" ||
    !ext?.fecha_limite_pago ||
    new Date(ext.fecha_limite_pago) >= new Date()
  ) {
    return false;
  }
  const { data: multa } = await supabase
    .from("multas")
    .select("*")
    .eq("registro", row.identificador)
    .eq("estado", "pendiente")
    .maybeSingle();
  if (multa) {
    await Multas.update(multa.identificador, { estado: "derivada_justicia" });
  }
  await crearNotificacion(row.cliente, {
    tipo: "multa",
    titulo: "Caso derivado a la justicia",
    mensaje: "El plazo de 72 horas para presentar los fondos venció. Tu caso fue derivado a la justicia y tu cuenta fue bloqueada.",
  });
  return true;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function compraShape(row) {
  const [producto, ext, subasta, itemCatalogo] = await Promise.all([
    Productos.findById(row.producto),
    RegistroSubastaExtension.findOne({ registro: row.identificador }),
    Subastas.findById(row.subasta),
    ItemsCatalogo.findOne({ producto: row.producto }),
  ]);
  const subExt = subasta
    ? await SubastasExtension.findOne({ subasta: subasta.identificador })
    : null;

  // Derivar medio de pago desde asistentes_extension (fijado al entrar a sala)
  const asistente = await Asistentes.findOne({ cliente: row.cliente, subasta: row.subasta });
  const extAsistente = asistente
    ? await AsistentesExtension.findOne({ asistente: asistente.identificador })
    : null;
  const medioPagoRow = extAsistente?.medio_pago
    ? await MediosPago.findById(Number(extAsistente.medio_pago))
    : null;

  const importe = Number(row.importe || 0);
  const comision = Number(row.comision || 0);
  const costoEnvio = ext?.costo_envio ? Number(ext.costo_envio) : null;
  const total = importe + comision + (costoEnvio || 0);

  await verificarVencimientoCompra(row, ext);

  let estadoApi = "pendiente_pago";
  if (ext?.estado_pago === "pagada") estadoApi = "pagada";
  else if (ext?.estado_pago === "fondos_insuficientes") {
    const { data: multaJudicial } = await supabase
      .from("multas")
      .select("estado")
      .eq("registro", row.identificador)
      .eq("estado", "derivada_justicia")
      .maybeSingle();
    estadoApi = multaJudicial ? "derivada_justicia" : "fondos_insuficientes";
  }

  return {
    id: String(row.identificador),
    piezaId: String(row.producto),
    descripcionPieza: producto?.descripcion_catalogo || producto?.descripcion_completa || "",
    montoPujado: importe,
    comisiones: comision,
    costoEnvio,
    total,
    moneda: subExt?.moneda || "ARS",
    medioPagoId: extAsistente?.medio_pago ? String(extAsistente.medio_pago) : null,
    metodoEntrega: ext?.metodo_entrega || null,
    direccionEnvio: ext?.direccion_envio || null,
    estado: estadoApi,
    fechaLimitePago: ext?.fecha_limite_pago || null,
    avisoSeguro:
      ext?.metodo_entrega === "retiro_personal"
        ? "Al retirar personalmente perdés la cobertura de seguro durante el traslado."
        : null,
    tituloSubasta: subasta ? tituloSubasta(subasta, subExt) : null,
    fechaSubasta: subasta?.fecha || null,
    numeroItem: itemCatalogo?.identificador || null,
    medioPagoAlias: medioPagoRow
      ? (medioPagoRow.alias || aliasPorDefecto(medioPagoRow))
      : null,
  };
}

async function findOwnCompra(id, clienteId) {
  const row = await RegistroDeSubasta.findById(id);
  if (!row || row.cliente !== clienteId) {
    throw new HttpError(404, "COMPRA_NO_ENCONTRADA", "La compra solicitada no existe o no pertenece a tu cuenta.");
  }
  return row;
}

// GET /compras
exports.listar = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(50, Number(req.query.limit) || 10);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, count, error } = await supabase
    .from("registro_de_subasta")
    .select("*", { count: "exact" })
    .eq("cliente", req.user.sub)
    .range(from, to)
    .order("identificador", { ascending: false });
  if (error) throw error;

  const result = await Promise.all((data || []).map(row => compraShape(row)));
  res.json({ data: result, meta: paginate({ page, limit, total: count || 0 }) });
});

// GET /compras/:id
exports.detalle = asyncHandler(async (req, res) => {
  const row = await findOwnCompra(Number(req.params.id), req.user.sub);
  res.json(await compraShape(row));
});

// PUT /compras/:id/medio-pago
exports.cambiarMedioPago = asyncHandler(async (req, res) => {
  const row = await findOwnCompra(Number(req.params.id), req.user.sub);

  const ext = await RegistroSubastaExtension.findOne({ registro: row.identificador });
  if (ext?.estado_pago === "pagada") {
    throw new HttpError(409, "COMPRA_YA_PAGADA", "No se puede cambiar el medio de pago de una compra ya pagada.");
  }

  const { medioPagoId } = req.body || {};
  if (!medioPagoId) {
    throw new HttpError(400, "COMPRA_DATOS_INVALIDOS", "medioPagoId es requerido.", { campo: "medioPagoId" });
  }

  const medio = await MediosPago.findById(Number(medioPagoId));
  if (!medio || medio.cliente !== req.user.sub) {
    throw new HttpError(404, "PAGO_NO_ENCONTRADO", "Medio de pago no encontrado.");
  }
  if (medio.verificado !== "si") {
    throw new HttpError(400, "PAGO_NO_VERIFICADO", "El medio de pago seleccionado no está verificado.");
  }

  const asistente = await Asistentes.findOne({ cliente: row.cliente, subasta: row.subasta });
  if (!asistente) {
    throw new HttpError(409, "COMPRA_SIN_ASISTENTE", "No se encontró el registro de sala.");
  }
  await AsistentesExtension.update(asistente.identificador, { medio_pago: medio.identificador });

  res.json(await compraShape(row));
});

// POST /compras/:id/pagar
exports.pagar = asyncHandler(async (req, res) => {
  const row = await findOwnCompra(Number(req.params.id), req.user.sub);

  const extCheck = await RegistroSubastaExtension.findOne({ registro: row.identificador });
  if (await verificarVencimientoCompra(row, extCheck)) {
    throw new HttpError(
      410,
      "COMPRA_PLAZO_VENCIDO",
      "El plazo de 72 horas para presentar los fondos venció. Tu caso fue derivado a la justicia.",
    );
  }

  const { metodoEntrega, direccionEnvio } = req.body || {};

  if (!["envio", "retiro_personal"].includes(metodoEntrega)) {
    throw new HttpError(400, "COMPRA_DATOS_INVALIDOS", "metodoEntrega inválido.", {
      campo: "metodoEntrega",
      valoresValidos: ["envio", "retiro_personal"],
    });
  }
  if (metodoEntrega === "envio" && !direccionEnvio) {
    throw new HttpError(400, "COMPRA_DATOS_INVALIDOS", "direccionEnvio es requerido para envío.", {
      campo: "direccionEnvio",
    });
  }

  // Resolver medio de pago fijado al entrar a sala
  const asistente = await Asistentes.findOne({ cliente: row.cliente, subasta: row.subasta });
  if (!asistente) {
    throw new HttpError(409, "COMPRA_SIN_ASISTENTE", "No encontramos tu registro de sala para esta subasta.");
  }
  const extAsistente = await AsistentesExtension.findOne({ asistente: asistente.identificador });
  if (!extAsistente?.medio_pago) {
    throw new HttpError(409, "COMPRA_SIN_MEDIO_PAGO", "No tenés medio de pago fijado para esta subasta.");
  }
  const medio = await MediosPago.findById(Number(extAsistente.medio_pago));
  if (!medio || medio.cliente !== req.user.sub) {
    throw new HttpError(404, "PAGO_NO_ENCONTRADO", "Medio de pago no encontrado.");
  }
  if (medio.verificado !== "si") {
    throw new HttpError(400, "PAGO_NO_VERIFICADO", "Tu medio de pago aún no fue verificado.");
  }

  const importe = Number(row.importe || 0) + Number(row.comision || 0);
  const monto = montoDisponible(medio);

  if (monto !== null) {
    // Comprometido: otras compras del cliente con el mismo medio y estado != pagada
    const { data: otrasCompras } = await supabase
      .from("registro_de_subasta")
      .select("identificador, importe, comision, subasta")
      .eq("cliente", row.cliente)
      .neq("identificador", row.identificador);

    let comprometido = 0;
    for (const otra of otrasCompras || []) {
      const asistenteOtra = await Asistentes.findOne({ cliente: row.cliente, subasta: otra.subasta });
      if (!asistenteOtra) continue;
      const extOtra = await AsistentesExtension.findOne({ asistente: asistenteOtra.identificador });
      if (String(extOtra?.medio_pago) !== String(medio.identificador)) continue;
      const extCompra = await RegistroSubastaExtension.findOne({ registro: otra.identificador });
      if (!extCompra || extCompra.estado_pago !== "pagada") {
        comprometido += Number(otra.importe || 0) + Number(otra.comision || 0);
      }
    }

    if (comprometido + importe > monto) {
      const montoMulta = Math.round(importe * 0.1);
      const fechaLimiteCompra = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min para testing (prod: 72 * 3600 * 1000)
      const subastaExt = await SubastasExtension.findOne({ subasta: row.subasta });
      const monedaRaw = subastaExt?.moneda || "ARS";
      const moneda = ["ARS", "USD"].includes(monedaRaw) ? monedaRaw : "ARS";
      const multa = await Multas.create({
        registro: row.identificador,
        monto_original: importe,
        monto_multa: montoMulta,
        moneda,
        estado: "pendiente",
        fecha_limite: fechaLimiteCompra,
        fecha_creacion: new Date().toISOString(),
      });
      const ext = await RegistroSubastaExtension.findOne({ registro: row.identificador });
      if (ext) {
        await RegistroSubastaExtension.update(row.identificador, {
          estado_pago: "fondos_insuficientes",
          fecha_limite_pago: fechaLimiteCompra,
          metodo_entrega: metodoEntrega,
          direccion_envio: direccionEnvio || null,
        });
      } else {
        await RegistroSubastaExtension.create({
          registro: row.identificador,
          estado_pago: "fondos_insuficientes",
          fecha_limite_pago: fechaLimiteCompra,
          metodo_entrega: metodoEntrega,
          direccion_envio: direccionEnvio || null,
        });
      }
      await crearNotificacion(req.user.sub, {
        tipo: "multa",
        titulo: "Fondos insuficientes — multa generada",
        mensaje: `Se generó una multa de $${montoMulta} por fondos insuficientes. Tenés 72 horas para presentar los fondos de la compra.`,
        accionUrl: `/multas/${multa.identificador}`,
      });
      throw new HttpError(
        402,
        "COMPRA_FONDOS_INSUFICIENTES",
        `Fondos insuficientes. Se generó una multa del 10%. Tenés 72hs para presentar los fondos.`,
        {
          montoOfertado: importe,
          montoMulta,
          fechaLimiteCompra,
          multa: {
            id: String(multa.identificador),
            compraId: String(row.identificador),
            montoOriginal: importe,
            montoMulta,
            moneda,
            estado: "pendiente",
            fechaCreacion: multa.fecha_creacion,
          },
        },
      );
    }
  }

  // Pago OK
  const costoEnvio = metodoEntrega === "envio" ? Math.round(importe * 0.02) : 0;
  const existing = await RegistroSubastaExtension.findOne({ registro: row.identificador });
  if (existing) {
    await RegistroSubastaExtension.update(row.identificador, {
      metodo_entrega: metodoEntrega,
      direccion_envio: direccionEnvio || null,
      costo_envio: costoEnvio,
      estado_pago: "pagada",
    });
  } else {
    await RegistroSubastaExtension.create({
      registro: row.identificador,
      metodo_entrega: metodoEntrega,
      direccion_envio: direccionEnvio || null,
      costo_envio: costoEnvio,
      estado_pago: "pagada",
    });
  }

  await crearNotificacion(req.user.sub, {
    tipo: "pago",
    titulo: "Pago confirmado",
    mensaje: "Tu pago fue procesado exitosamente. Podés ver los detalles de tu compra.",
    accionUrl: `/compras/${row.identificador}`,
  });

  await evaluarYActualizarCategoria(req.user.sub);
  res.json(await compraShape(row));
});
