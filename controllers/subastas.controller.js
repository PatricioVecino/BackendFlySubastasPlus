const supabase = require("../supabase-client");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const Catalogos = require("../models/catalogos");
const ItemsCatalogo = require("../models/items_catalogo");
const ItemsCatalogoEstado = require("../models/items_catalogo_estado");
const Productos = require("../models/productos");
const ProductosExtension = require("../models/productos_extension");
const Personas = require("../models/personas");
const Duenios = require("../models/duenios");
const ArtistasPiezas = require("../models/artistas_piezas");
const HttpError = require("../lib/http-error");
// (notImplemented ya no se usa: todos los handlers están implementados)
const {
  subastaResumen,
  subastaDetalle,
  piezaResumen,
  piezaDetalle,
  tituloSubasta,
  fechaTimestamp,
  estadoApiToDb,
  paginate,
} = require("../lib/subasta-shape");
const { cantidadPiezasDeSubasta, piezaEnSubasta, tomarPujaSiVigente } = require("../lib/subastas-helper");
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function fetchImagenPortada(subastaId) {
  const { data: cats } = await supabase
    .from("catalogos")
    .select("identificador")
    .eq("subasta", subastaId)
    .limit(1);
  if (!cats?.[0]) return null;
  const { data: items } = await supabase
    .from("items_catalogo")
    .select("identificador")
    .eq("catalogo", cats[0].identificador)
    .order("identificador")
    .limit(1);
  return items?.[0] ? `/v1/piezas/${items[0].identificador}/fotos/0` : null;
}

async function rematadorNombrePorSubasta(subastadorId) {
  if (!subastadorId) return null;
  // subastadores.identificador es FK a personas
  const persona = await Personas.findById(subastadorId);
  return persona?.nombre || null;
}

// GET /subastas
exports.listar = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(50, Number(req.query.limit) || 10);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase.from("subastas").select("*", { count: "exact" });
  if (req.query.estado) {
    const dbEstado = estadoApiToDb(req.query.estado);
    if (dbEstado) q = q.eq("estado", dbEstado);
  }
  if (req.query.categoria) q = q.eq("categoria", req.query.categoria);
  q = q.range(from, to).order("identificador", { ascending: false });

  const { data: subs, count, error } = await q;
  if (error) throw error;

  const data = [];
  for (const s of subs || []) {
    const ext = await SubastasExtension.findOne({ subasta: s.identificador });
    const rematador = await rematadorNombrePorSubasta(s.subastador);
    const cant = await cantidadPiezasDeSubasta(s.identificador);
    const imagenPortada = await fetchImagenPortada(s.identificador);
    data.push(subastaResumen({ subasta: s, ext, rematadorNombre: rematador, cantidadPiezas: cant, imagenPortada }));
  }

  res.json({ data, meta: paginate({ page, limit, total: count || 0 }) });
});

// GET /subastas/:id
exports.detalle = asyncHandler(async (req, res) => {
  const subasta = await Subastas.findById(req.params.id);
  if (!subasta) {
    throw new HttpError(404, "SUBASTA_NO_ENCONTRADA", "La subasta solicitada no existe o fue eliminada.");
  }
  const ext = await SubastasExtension.findOne({ subasta: subasta.identificador });
  const rematador = await rematadorNombrePorSubasta(subasta.subastador);
  const cant = await cantidadPiezasDeSubasta(subasta.identificador);

  let puedeEntrar = false;
  let razonNoEntrar = null;
  if (req.user) {
    const { puedeEntrarPorCategoria } = require("../lib/categoria");
    const Clientes = require("../models/clientes");
    const cli = await Clientes.findById(req.user.sub);
    const monedaSubasta = ext?.moneda || "ARS";
    if (!cli) razonNoEntrar = "Usuario no encontrado";
    else if (!puedeEntrarPorCategoria(cli.categoria, subasta.categoria)) {
      razonNoEntrar = "Categoría insuficiente";
    } else {
      // Chequear si ya tiene medio_pago fijado para esta subasta
      const asistenteExistente = await Asistentes.findOne({ cliente: cli.identificador, subasta: subasta.identificador });
      let medioPagoFijado = false;
      if (asistenteExistente) {
        const extAsistente = await AsistentesExtension.findOne({ asistente: asistenteExistente.identificador });
        medioPagoFijado = !!extAsistente?.medio_pago;
      }
      if (medioPagoFijado) {
        puedeEntrar = true;
      } else {
        const { count: compatibles } = await supabase
          .from("medios_pago")
          .select("*", { count: "exact", head: true })
          .eq("cliente", cli.identificador)
          .eq("verificado", "si")
          .eq("moneda", monedaSubasta);
        if (!compatibles) razonNoEntrar = `Sin medio de pago verificado en ${monedaSubasta}`;
        else puedeEntrar = true;
      }
    }
  } else {
    razonNoEntrar = "No autenticado";
  }

  res.json(
    subastaDetalle({
      subasta,
      ext,
      rematadorNombre: rematador,
      cantidadPiezas: cant,
      puedeEntrar,
      razonNoEntrar,
    }),
  );
});

// GET /subastas/:id/catalogo
exports.catalogo = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const subasta = await Subastas.findById(subastaId);
  if (!subasta) {
    throw new HttpError(
      404,
      "SUBASTA_NO_ENCONTRADA",
      "La subasta no existe. Verificá el listado de subastas disponibles.",
    );
  }

  const page = Number(req.query.page) || 1;
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data: cats } = await supabase
    .from("catalogos")
    .select("identificador")
    .eq("subasta", subastaId);
  const catIds = (cats || []).map((c) => c.identificador);

  if (!catIds.length) {
    return res.json({ data: [], meta: paginate({ page, limit, total: 0 }) });
  }

  const { data: items, count, error } = await supabase
    .from("items_catalogo")
    .select("*", { count: "exact" })
    .in("catalogo", catIds)
    .range(from, to)
    .order("identificador");
  if (error) throw error;

  const precioVisible = !!req.user;
  const data = [];
  for (const item of items || []) {
    const [producto, prodExt, estadoItem] = await Promise.all([
      Productos.findById(item.producto),
      ProductosExtension.findOne({ producto: item.producto }),
      ItemsCatalogoEstado.findOne({ item: item.identificador }),
    ]);
    data.push(piezaResumen({ item, producto, prodExt, estadoItem, precioVisible }));
  }

  res.json({ data, meta: paginate({ page, limit, total: count || 0 }) });
});

// GET /piezas/:id
exports.detallePieza = asyncHandler(async (req, res) => {
  const item = await ItemsCatalogo.findById(req.params.id);
  if (!item) {
    throw new HttpError(404, "PIEZA_NO_ENCONTRADA", "La pieza solicitada no existe en el catálogo.");
  }
  const [producto, prodExt, estadoItem, artista, catalogo, fotosResult] = await Promise.all([
    Productos.findById(item.producto),
    ProductosExtension.findOne({ producto: item.producto }),
    ItemsCatalogoEstado.findOne({ item: item.identificador }),
    ArtistasPiezas.findOne({ producto: item.producto }),
    Catalogos.findById(item.catalogo),
    supabase.from("fotos").select("*", { count: "exact", head: true }).eq("producto", item.producto),
  ]);
  const fotosCount = fotosResult.count || 0;

  let duenioNombre = null;
  if (producto?.duenio) {
    const duenio = await Duenios.findById(producto.duenio);
    if (duenio) {
      const persona = await Personas.findById(duenio.identificador);
      duenioNombre = persona?.nombre || null;
    }
  }

  let subastaAsignada = null;
  let monedaSubasta = null;
  if (catalogo?.subasta) {
    const sub = await Subastas.findById(catalogo.subasta);
    if (sub) {
      const ext = await SubastasExtension.findOne({ subasta: sub.identificador });
      monedaSubasta = ext?.moneda || "ARS";
      subastaAsignada = {
        subastaId: String(sub.identificador),
        titulo: tituloSubasta(sub, ext),
        fecha: fechaTimestamp(sub),
        rematador: await rematadorNombrePorSubasta(sub.subastador),
        ubicacion: sub.ubicacion || null,
        categoria: sub.categoria || "comun",
        moneda: monedaSubasta,
      };
    }
  }

  res.json(
    piezaDetalle({
      item,
      producto,
      prodExt,
      estadoItem,
      precioVisible: !!req.user,
      duenioNombre,
      artista,
      subastaAsignada,
      fotosCount,
      moneda: monedaSubasta,
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Sala en Vivo
// ─────────────────────────────────────────────────────────────────────────────
const Clientes = require("../models/clientes");
const Asistentes = require("../models/asistentes");
const AsistentesExtension = require("../models/asistentes_extension");
const MediosPagoModel = require("../models/medios_pago");
const Pujos = require("../models/pujos");
const PujosExtension = require("../models/pujos_extension");
const { puedeEntrarPorCategoria, pujaSinMaximo } = require("../lib/categoria");
const { medioPagoShape } = require("../lib/medio-pago-shape");
const realtime = require("../lib/realtime");
const { crearNotificacion } = require("../lib/notificaciones-helper");
const itemTimer = require("../lib/item-timer");
const { ejecutarCierreItem } = require("./admin-subastas.controller");
const DURACION_PUJA_MS = 30_000;
const { multaPendienteData } = require("../lib/multas-helper");


async function ultimasPujasDeItem(itemId, usuarioClienteId, limit = 10) {
  const { data: pujos } = await supabase
    .from("pujos")
    .select("*")
    .eq("item", itemId)
    .order("identificador", { ascending: false })
    .limit(limit);
  const result = [];
  for (const p of pujos || []) {
    const ext = await PujosExtension.findOne({ pujo: p.identificador });
    const asistente = await Asistentes.findById(p.asistente);
    result.push({
      id: String(p.identificador),
      postorId: `Postor #${asistente?.numero_postor || "?"}`,
      monto: Number(p.importe),
      timestamp: ext?.timestamp || null,
      esPropia: !!(usuarioClienteId && asistente?.cliente === usuarioClienteId),
    });
  }
  return result;
}

// POST /subastas/:id/medio-pago
exports.fijarMedioPago = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const { medioPagoId } = req.body || {};

  if (!medioPagoId) {
    throw new HttpError(400, "MEDIO_PAGO_REQUERIDO_BODY", "Falta medioPagoId en el body.");
  }

  const subasta = await Subastas.findById(subastaId);
  if (!subasta) throw new HttpError(404, "SUBASTA_NO_ENCONTRADA", "La subasta no existe.");

  const subastaExt = await SubastasExtension.findOne({ subasta: subastaId });
  const monedaSubasta = subastaExt?.moneda || "ARS";

  const medio = await MediosPagoModel.findById(medioPagoId);
  if (!medio || medio.cliente !== req.user.sub) {
    throw new HttpError(403, "MEDIO_PAGO_NO_ENCONTRADO", "El medio de pago no existe o no te pertenece.");
  }
  if (medio.verificado !== "si") {
    throw new HttpError(403, "MEDIO_PAGO_NO_VERIFICADO", "El medio de pago no está verificado.");
  }
  if (medio.moneda !== monedaSubasta) {
    throw new HttpError(409, "MEDIO_PAGO_MONEDA_INCORRECTA", `El medio de pago debe estar en ${monedaSubasta}.`);
  }

  const cliente = await Clientes.findById(req.user.sub);
  let asistente = await Asistentes.findOne({ cliente: cliente.identificador, subasta: subastaId });
  if (!asistente) {
    const { data: maxRow } = await supabase
      .from("asistentes")
      .select("numero_postor")
      .eq("subasta", subastaId)
      .order("numero_postor", { ascending: false })
      .limit(1)
      .maybeSingle();
    asistente = await Asistentes.create({
      numero_postor: (maxRow?.numero_postor || 0) + 1,
      cliente: cliente.identificador,
      subasta: subastaId,
    });
  }

  const ext = await AsistentesExtension.findOne({ asistente: asistente.identificador });
  if (ext?.medio_pago) {
    throw new HttpError(409, "MEDIO_PAGO_YA_DEFINIDO", "Ya elegiste un medio de pago para esta subasta y no puede cambiarse.");
  }

  if (ext) {
    await AsistentesExtension.update(asistente.identificador, { medio_pago: Number(medioPagoId) });
  } else {
    await AsistentesExtension.create({
      asistente: asistente.identificador,
      estado_conexion: "desconectado",
      medio_pago: Number(medioPagoId),
    });
  }

  res.json({ ok: true });
});

// GET /subastas/:id/sala
exports.ingresarSala = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const subasta = await Subastas.findById(subastaId);
  if (!subasta || subasta.estado !== "abierta") {
    throw new HttpError(404, "SALA_NO_DISPONIBLE", "La subasta no existe o no está en vivo en este momento.");
  }

  const subastaExt = await SubastasExtension.findOne({ subasta: subastaId });
  const monedaSubasta = subastaExt?.moneda || "ARS";

  const cliente = await Clientes.findById(req.user.sub);
  if (!cliente) throw new HttpError(403, "USUARIO_NO_ENCONTRADO", "Usuario no encontrado.");

  // 1) Categoría
  if (!puedeEntrarPorCategoria(cliente.categoria, subasta.categoria)) {
    throw new HttpError(
      403,
      "SALA_CATEGORIA_INSUFICIENTE",
      `Tu categoría actual (${cliente.categoria}) no te permite acceder a esta subasta. Mejorá tu categoría para participar.`,
      { categoriaUsuario: cliente.categoria, categoriaRequerida: subasta.categoria },
    );
  }

  // 2) Multa pendiente
  const multaPend = await multaPendienteData(cliente.identificador);
  if (multaPend) {
    throw new HttpError(
      403,
      "SALA_MULTA_PENDIENTE",
      "Tenés una multa pendiente de pago. Aboná la multa para poder participar.",
      { montoMulta: Number(multaPend.monto_multa) },
    );
  }

  // 3) No estar conectado a otra subasta
  const { data: misAsistencias } = await supabase
    .from("asistentes")
    .select("*")
    .eq("cliente", cliente.identificador);
  for (const a of misAsistencias || []) {
    if (a.subasta === subastaId) continue;
    const extOtra = await AsistentesExtension.findOne({ asistente: a.identificador });
    if (extOtra?.estado_conexion !== "conectado") continue;
    const otra = await Subastas.findById(a.subasta);
    if (otra?.estado !== "abierta") continue; // flag obsoleto de una subasta ya cerrada
    const otraExt = await SubastasExtension.findOne({ subasta: otra.identificador });
    throw new HttpError(
      403,
      "SALA_YA_CONECTADO",
      "Ya estás conectado a otra subasta en vivo. Salí de la actual antes de entrar a otra.",
      { subastaActualTitulo: tituloSubasta(otra, otraExt) },
    );
  }

  // 4) Buscar o crear asistente para esta subasta
  let asistente = (misAsistencias || []).find((a) => a.subasta === subastaId);
  if (!asistente) {
    const { data: maxRow } = await supabase
      .from("asistentes")
      .select("numero_postor")
      .eq("subasta", subastaId)
      .order("numero_postor", { ascending: false })
      .limit(1)
      .maybeSingle();
    const numeroPostor = (maxRow?.numero_postor || 0) + 1;
    asistente = await Asistentes.create({
      numero_postor: numeroPostor,
      cliente: cliente.identificador,
      subasta: subastaId,
    });
  }

  // 5) Verificar medio de pago fijado para esta subasta
  const ext = await AsistentesExtension.findOne({ asistente: asistente.identificador });
  if (!ext?.medio_pago) {
    const { data: mediosCompatibles } = await supabase
      .from("medios_pago")
      .select("*")
      .eq("cliente", cliente.identificador)
      .eq("verificado", "si")
      .eq("moneda", monedaSubasta);
    throw new HttpError(
      409,
      "MEDIO_PAGO_REQUERIDO",
      `Elegí el medio de pago que usarás en esta subasta (${monedaSubasta}).`,
      { medios: (mediosCompatibles || []).map(medioPagoShape), moneda: monedaSubasta },
    );
  }

  // 6) Marcar conectado en la extensión
  await AsistentesExtension.update(asistente.identificador, { estado_conexion: "conectado" });

  // 7) Armar payload SalaEnVivo
  const piezaCur = await piezaEnSubasta(subastaId);
  let piezaActual = null;
  if (piezaCur) {
    const [producto, fotosResult] = await Promise.all([
      Productos.findById(piezaCur.item.producto),
      supabase.from("fotos").select("*", { count: "exact", head: true }).eq("producto", piezaCur.item.producto),
    ]);
    const cantFotos = fotosResult.count || 0;
    const valorBase = Number(piezaCur.item.precio_base);
    const mejor = Number(piezaCur.estado.mejor_oferta || piezaCur.item.precio_base);
    const pujaMinima = Number((mejor + valorBase * 0.01).toFixed(2));
    const pujaMaxima = pujaSinMaximo(cliente.categoria)
      ? null
      : Number((mejor + valorBase * 0.2).toFixed(2));
    piezaActual = {
      id: String(piezaCur.item.identificador),
      numeroItem: piezaCur.item.identificador,
      descripcion: producto?.descripcion_catalogo || producto?.descripcion_completa || "",
      imagenPrincipal: cantFotos > 0 ? `/v1/piezas/${piezaCur.item.identificador}/fotos/0` : null,
      cantFotos,
      expiryAt: piezaCur.estado.expiry_at || null,
      precioBase: valorBase,
      mejorOferta: mejor,
      pujaMinima,
      pujaMaxima,
      ultimasPujas: await ultimasPujasDeItem(piezaCur.item.identificador, cliente.identificador),
    };
  }

  res.json({
    subastaId: String(subastaId),
    piezaActual,
    streamingUrl: `https://streaming.subastasplus.local/subastas/${subastaId}.m3u8`,
    conectados: realtime.roomSize(subastaId),
  });
});

// POST /subastas/:id/pujas
exports.realizarPuja = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const { monto } = req.body || {};
  if (!monto || isNaN(monto) || monto <= 0) {
    throw new HttpError(400, "PUJA_MONTO_INVALIDO", "El monto de la puja no es válido.");
  }

  const subasta = await Subastas.findById(subastaId);
  if (!subasta || subasta.estado !== "abierta") {
    throw new HttpError(404, "SALA_NO_DISPONIBLE", "La subasta no existe o no está en vivo.");
  }

  const cliente = await Clientes.findById(req.user.sub);
  const asistente = await Asistentes.findOne({ cliente: cliente.identificador, subasta: subastaId });
  if (!asistente) {
    throw new HttpError(403, "SALA_NO_INSCRIPTO", "No estás inscripto en esta sala. Ingresá primero.");
  }

  const extAsistente = await AsistentesExtension.findOne({ asistente: asistente.identificador });
  if (!extAsistente || extAsistente.estado_conexion !== "conectado") {
    throw new HttpError(403, "SALA_DESCONECTADO", "Saliste de la sala. Ingresá nuevamente para poder ofertar.");
  }

  const piezaCur = await piezaEnSubasta(subastaId);
  if (!piezaCur) {
    throw new HttpError(409, "SUBASTA_SIN_PIEZA_ACTIVA", "No hay pieza activa en este momento.");
  }

  const valorBase = Number(piezaCur.item.precio_base);
  const mejorOfertaRaw = piezaCur.estado.mejor_oferta;
  const mejorOferta = Number(mejorOfertaRaw || piezaCur.item.precio_base);
  const pujaMinima = Number((mejorOferta + valorBase * 0.01).toFixed(2));
  const pujaMaxima = pujaSinMaximo(cliente.categoria)
    ? null
    : Number((mejorOferta + valorBase * 0.2).toFixed(2));

  if (monto < pujaMinima) {
    throw new HttpError(
      400,
      "PUJA_MONTO_INSUFICIENTE",
      `El monto de tu puja es menor al mínimo. Debés ofertar al menos ${pujaMinima}.`,
      { montoOfertado: monto, montoMinimo: pujaMinima, mejorOfertaActual: mejorOferta, valorBase },
    );
  }
  if (pujaMaxima !== null && monto > pujaMaxima) {
    throw new HttpError(
      400,
      "PUJA_MONTO_EXCEDIDO",
      `El monto supera el máximo permitido de ${pujaMaxima}.`,
      { montoOfertado: monto, montoMaximo: pujaMaxima },
    );
  }

  // Solo prosigue quien gana la toma atómica de la puja; el resto perdió la carrera.
  const expiryAt = new Date(Date.now() + DURACION_PUJA_MS).toISOString();
  const tomada = await tomarPujaSiVigente(piezaCur.item.identificador, {
    mejorOfertaActual: mejorOfertaRaw,
    monto,
    expiryAt,
  });
  if (!tomada) {
    throw new HttpError(409, "PUJA_SUPERADA", "Alguien pujó antes que vos. Volvé a ofertar.");
  }

  // Notificar al líder anterior (mayor importe actual, antes de insertar la nuestra) que fue superado.
  // Usar el importe y no el flag evita que una carrera deje sin notificar.
  const { data: lideres } = await supabase
    .from("pujos")
    .select("*")
    .eq("item", piezaCur.item.identificador)
    .order("importe", { ascending: false })
    .limit(1);
  const pujoAnterior = lideres?.[0] || null;
  if (pujoAnterior && pujoAnterior.asistente !== asistente.identificador) {
    const asistenteAnterior = await Asistentes.findById(pujoAnterior.asistente);
    if (asistenteAnterior) {
      await crearNotificacion(asistenteAnterior.cliente, {
        tipo: "puja_superada",
        titulo: "Tu puja fue superada",
        mensaje: `Alguien ofertó $${monto} por la pieza. Podés volver a pujar para ganar.`,
        accionUrl: `/subastas/${subastaId}/sala`,
      });
    }
  }

  // Marcar las pujas anteriores ganadoras como 'no'
  await supabase
    .from("pujos")
    .update({ ganador: "no" })
    .eq("item", piezaCur.item.identificador)
    .eq("ganador", "si");

  // Insertar la nueva
  const pujo = await Pujos.create({
    asistente: asistente.identificador,
    item: piezaCur.item.identificador,
    importe: monto,
    ganador: "si",
  });

  const timestamp = new Date().toISOString();
  await PujosExtension.create({ pujo: pujo.identificador, timestamp });

  // Resetear timer (mejor_oferta y expiry_at ya quedaron seteados por la compuerta)
  itemTimer.set(piezaCur.item.identificador, subastaId, expiryAt, ejecutarCierreItem);

  // Broadcast a la sala
  realtime.broadcast(subastaId, {
    event: "puja_nueva",
    pujo: {
      id: String(pujo.identificador),
      postorId: `Postor #${asistente.numero_postor}`,
      monto: Number(monto),
      timestamp,
    },
    mejorOferta: Number(monto),
    expiryAt,
  });

  res.status(201).json({
    id: String(pujo.identificador),
    monto: Number(monto),
    estado: "ganadora",
    timestamp,
  });
});

// POST /subastas/:id/sala/salir
exports.salirSala = asyncHandler(async (req, res) => {
  const subastaId = Number(req.params.id);
  const cliente = await Clientes.findById(req.user.sub);
  const asistente = await Asistentes.findOne({ cliente: cliente.identificador, subasta: subastaId });
  if (asistente) {
    const ext = await AsistentesExtension.findOne({ asistente: asistente.identificador });
    if (ext) {
      await AsistentesExtension.update(asistente.identificador, { estado_conexion: "desconectado" });
    }
  }
  res.status(204).end();
});
