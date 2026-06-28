// Mapea filas DB (personas + clientes + clientes_acceso + medios_pago_count) al
// shape UsuarioResumen del Swagger.

function splitNombre(full) {
  if (!full) return { nombre: "", apellido: "" };
  const parts = String(full).trim().split(/\s+/);
  const nombre = parts.shift() || "";
  const apellido = parts.join(" ");
  return { nombre, apellido };
}

function joinNombre(nombre, apellido) {
  return [nombre, apellido].filter(Boolean).join(" ").trim();
}

function deriveEstado({ admitido, tieneMultaActiva = false }) {
  if (tieneMultaActiva) return "bloqueado_multa";
  if (admitido === "si") return "aprobado";
  return "pendiente_aprobacion";
}

function usuarioResumen({ persona, cliente, acceso, cantidadMediosPago = 0, tieneMultaActiva = false }) {
  const { nombre, apellido } = splitNombre(persona?.nombre);
  return {
    id: String(cliente.identificador),
    nombre,
    apellido,
    email: acceso?.email || null,
    categoria: cliente.categoria || "comun",
    estado: deriveEstado({ admitido: cliente.admitido, tieneMultaActiva }),
    cantidadMediosPago,
  };
}

function usuarioDetalle({ persona, cliente, acceso, pais, tieneMultaActiva = false }) {
  const { nombre, apellido } = splitNombre(persona?.nombre);
  return {
    id: String(cliente.identificador),
    nombre,
    apellido,
    email: acceso?.email || null,
    domicilioLegal: persona?.direccion || null,
    paisOrigen: pais?.nombre || null,
    categoria: cliente.categoria || "comun",
    estado: deriveEstado({ admitido: cliente.admitido, tieneMultaActiva }),
    fotoPerfil: !!persona?.foto,
    fechaRegistro: acceso?.fecha_registro || null,
  };
}

module.exports = {
  usuarioResumen,
  usuarioDetalle,
  splitNombre,
  joinNombre,
  deriveEstado,
};
