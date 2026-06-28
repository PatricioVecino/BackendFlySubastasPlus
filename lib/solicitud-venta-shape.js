// Shape DB ↔ API para solicitudes_venta + helpers.

function base64ToBytea(b64) {
  if (!b64) return null;
  const stripped = String(b64).replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(stripped, "base64");
  return "\\x" + buf.toString("hex");
}

function solicitudShape({ row, subastaAsignada = null, poliza = null, fotosCount = 0, precioVenta = null }) {
  return {
    id: String(row.identificador),
    tipo: row.tipo,
    nombreBien: row.nombre_bien || null,
    descripcion: row.descripcion,
    imagenes: Array.from({ length: fotosCount }, (_, i) => `/v1/solicitudes-venta/${row.identificador}/fotos/${i}`),
    historia: row.historia || null,
    nombreArtista: row.nombre_artista || null,
    fechaObra: row.fecha_obra || null,
    dueniosAnteriores: row.duenos_anteriores || null,
    curiosidades: row.curiosidades || null,
    declaracionPropiedad: row.declaracion_propiedad === "si",
    estado: row.estado,
    moneda: row.moneda || 'USD',
    costoEnvio: row.costo_envio != null ? Number(row.costo_envio) : null,
    motivoRechazo: row.motivo_rechazo || null,
    valorBase: row.valor_base != null ? Number(row.valor_base) : null,
    comisiones: row.comisiones != null ? Number(row.comisiones) : null,
    subastaAsignada,
    direccionEnvio: row.direccion_envio || null,
    ubicacionDeposito: row.ubicacion_deposito || null,
    fechaLimiteEntrega: row.fecha_limite_entrega || null,
    polizaSeguro: poliza,
    cuentaCobro: cuentaCobroResumen(row),
    fechaCreacion: row.fecha_creacion || null,
    precioVenta: precioVenta != null ? Number(precioVenta) : null,
  };
}

function cuentaCobroResumen(row) {
  if (!row.cuenta_cobro_tipo) return null;
  const base = {
    tipo: row.cuenta_cobro_tipo,
    banco: row.cuenta_cobro_banco || null,
    titular: row.cuenta_cobro_titular || null,
  };
  if (row.cuenta_cobro_tipo === "nacional") {
    return { ...base, cbu: row.cuenta_cobro_cbu || null };
  }
  return {
    ...base,
    swift: row.cuenta_cobro_swift || null,
    iban: row.cuenta_cobro_iban || null,
    pais: row.cuenta_cobro_pais || null,
    moneda: row.cuenta_cobro_moneda || null,
  };
}

function polizaShape(seguro) {
  if (!seguro) return null;
  return {
    id: String(seguro.nro_poliza),
    aseguradora: seguro.compania,
    numeroPoliza: seguro.nro_poliza,
    tipo: seguro.poliza_combinada === 'si' ? 'Combinada' : 'Individual',
    valorAsegurado: seguro.importe != null ? Number(seguro.importe) : null,
    contactoAseguradora: null, // se completa cuando hay seguros_extension
  };
}

function contactoAseguradoraShape(seguro, ext) {
  return {
    nombre: seguro?.compania || null,
    telefono: ext?.telefono || null,
    email: ext?.email || null,
    web: ext?.web || null,
    numeroPoliza: seguro?.nro_poliza || null,
  };
}

const TIPOS_VALIDOS = ["arte", "antiguedad", "joya", "vehiculo", "mueble", "otro"];
const ESTADOS_VALIDOS = [
  "enviada",
  "en_revision_virtual",
  "esperando_entrega",
  "en_revision_fisica",
  "propuesta_pendiente",
  "pendiente_asignacion",
  "en_subasta",
  "rechazada_admin",
  "rechazada_cliente",
  "rechazada_deposito",
  "cancelado",
  "vendida",
  "no_vendida",
];

module.exports = {
  base64ToBytea,
  solicitudShape,
  polizaShape,
  contactoAseguradoraShape,
  cuentaCobroResumen,
  TIPOS_VALIDOS,
  ESTADOS_VALIDOS,
};
