function tituloSubasta(subasta, ext) {
  if (ext?.es_coleccion === "si" && ext?.nombre_coleccion) {
    return ext.nombre_coleccion;
  }
  return `Subasta #${subasta.identificador}`;
}

function fechaTimestamp(subasta) {
  if (!subasta.fecha) return null;
  // subasta.fecha = YYYY-MM-DD, subasta.hora = HH:mm:ss
  const hora = subasta.hora || "00:00:00";
  return new Date(`${subasta.fecha}T${hora}`).toISOString();
}

// Mapea DB.estado + fecha → estado de la API (en_vivo / programada / finalizada).
// DB solo conoce 'abierta' y 'cerrada' (CHECK constraint),
// así que distinguimos programada vs en_vivo por fecha.
function estadoApi(subasta) {
  if (subasta.estado === "cerrada") return "finalizada";
  if (subasta.estado === "abierta") {
    const ahora = new Date();
    const inicio = new Date(`${subasta.fecha}T${subasta.hora || "00:00:00"}`);
    return ahora >= inicio ? "en_vivo" : "programada";
  }
  return subasta.estado;
}

// Inversa: API estado → filtro sobre DB.estado
function estadoApiToDb(apiEstado) {
  if (apiEstado === "finalizada") return "cerrada";
  if (apiEstado === "programada" || apiEstado === "en_vivo") return "abierta";
  return null;
}

function subastaResumen({ subasta, ext, rematadorNombre, cantidadPiezas, imagenPortada = null }) {
  return {
    id: String(subasta.identificador),
    titulo: tituloSubasta(subasta, ext),
    categoria: subasta.categoria || "comun",
    fecha: fechaTimestamp(subasta),
    moneda: ext?.moneda || "ARS",
    estado: estadoApi(subasta),
    cantidadPiezas,
    rematador: rematadorNombre || null,
    esColeccion: ext?.es_coleccion === "si",
    nombreColeccion: ext?.nombre_coleccion || null,
    imagenPortada: imagenPortada || null,
  };
}

function subastaDetalle({
  subasta,
  ext,
  rematadorNombre,
  cantidadPiezas,
  puedeEntrar,
  razonNoEntrar,
}) {
  return {
    id: String(subasta.identificador),
    titulo: tituloSubasta(subasta, ext),
    categoria: subasta.categoria || "comun",
    fecha: fechaTimestamp(subasta),
    moneda: ext?.moneda || "ARS",
    estado: estadoApi(subasta),
    ubicacion: subasta.ubicacion || null,
    rematador: rematadorNombre || null,
    cantidadPiezas,
    esColeccion: ext?.es_coleccion === "si",
    nombreColeccion: ext?.nombre_coleccion || null,
    puedeEntrar: !!puedeEntrar,
    razonNoEntrar: razonNoEntrar || null,
  };
}

function piezaResumen({ item, producto, prodExt, estadoItem, precioVisible }) {
  return {
    id: String(item.identificador),
    numeroItem: item.identificador,
    descripcion: producto?.descripcion_catalogo || producto?.descripcion_completa || "",
    imagenPrincipal: `/v1/piezas/${item.identificador}/fotos/0`,
    precioBase: precioVisible ? Number(item.precio_base) : null,
    estado: estadoItem?.estado || "pendiente",
    cantidadElementos: prodExt?.cantidad_elementos || 1,
  };
}

function piezaDetalle({
  item,
  producto,
  prodExt,
  estadoItem,
  precioVisible,
  duenioNombre,
  artista,
  subastaAsignada,
  fotosCount = 0,
  moneda = null,
}) {
  return {
    id: String(item.identificador),
    numeroItem: item.identificador,
    tituloObra: producto?.descripcion_catalogo || producto?.descripcion_completa || "",
    descripcion: producto?.descripcion_completa || producto?.descripcion_catalogo || "",
    precioBase: precioVisible ? Number(item.precio_base) : null,
    comision: precioVisible ? Number(item.comision || 0) : null,
    moneda: moneda || "ARS",
    imagenes: Array.from({ length: fotosCount }, (_, i) => `/v1/piezas/${item.identificador}/fotos/${i}`),
    cantidadElementos: prodExt?.cantidad_elementos || 1,
    duenioActual: duenioNombre || null,
    esObraDeArte: prodExt?.es_obra_de_arte === "si",
    artista: artista
      ? {
          nombre: artista.nombre_artista,
          fecha: artista.fecha_obra || null,
          historia: artista.historia || null,
        }
      : null,
    subastaAsignada: subastaAsignada || null,
  };
}

function paginate({ page, limit, total }) {
  const p = Number(page) || 1;
  const l = Number(limit) || 10;
  return {
    page: p,
    limit: l,
    total,
    totalPages: Math.max(1, Math.ceil(total / l)),
  };
}

module.exports = {
  tituloSubasta,
  fechaTimestamp,
  estadoApi,
  estadoApiToDb,
  subastaResumen,
  subastaDetalle,
  piezaResumen,
  piezaDetalle,
  paginate,
};
