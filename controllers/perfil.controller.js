const Clientes = require("../models/clientes");
const Personas = require("../models/personas");
const ClientesAcceso = require("../models/clientes_acceso");
const Paises = require("../models/paises");
const HttpError = require("../lib/http-error");
const { usuarioDetalle } = require("../lib/usuario-shape");
const { tieneMultaActiva } = require("../lib/multas-helper");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function base64ToBytea(b64) {
  const stripped = String(b64).replace(/^data:[^;]+;base64,/, "");
  return "\\x" + Buffer.from(stripped, "base64").toString("hex");
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

// GET /perfil
exports.obtener = asyncHandler(async (req, res) => {

  const clienteId = req.user.sub;

  const cliente = await Clientes.findById(clienteId);
  if (!cliente) {
    throw new HttpError(404, "USUARIO_NO_ENCONTRADO", "Usuario no encontrado.");
  }

  const [persona, acceso, pais, tieneMulta] = await Promise.all([
    Personas.findById(cliente.identificador),
    ClientesAcceso.findOne({ cliente: cliente.identificador }),
    cliente.numero_pais ? Paises.findById(cliente.numero_pais) : null,
    tieneMultaActiva(clienteId),
  ]);

  res.json(usuarioDetalle({ persona, cliente, acceso, pais, tieneMultaActiva: tieneMulta }));
});

// PUT /perfil/foto
exports.subirFoto = asyncHandler(async (req, res) => {
  const clienteId = req.user.sub;
  const { foto } = req.body || {};

  if (!foto) {
    throw new HttpError(400, "FOTO_REQUERIDA", "Se requiere una foto en formato base64.");
  }

  const persona = await Personas.findById(clienteId);
  if (!persona) {
    throw new HttpError(404, "USUARIO_NO_ENCONTRADO", "Usuario no encontrado.");
  }

  await Personas.update(clienteId, { foto: base64ToBytea(foto) });
  res.status(204).end();
});

// GET /perfil/foto
exports.obtenerFoto = asyncHandler(async (req, res) => {
  const clienteId = req.user.sub;

  const persona = await Personas.findById(clienteId);
  if (!persona?.foto) {
    throw new HttpError(404, "FOTO_NO_ENCONTRADA", "El usuario no tiene foto de perfil.");
  }

  const buf = byteaToBuffer(persona.foto);
  res.set("Content-Type", detectMime(buf));
  res.set("Cache-Control", "private, max-age=3600");
  res.send(buf);
});
