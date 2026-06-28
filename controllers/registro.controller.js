const crypto = require("crypto");
const ClientesAcceso = require("../models/clientes_acceso");
const Clientes = require("../models/clientes");
const Personas = require("../models/personas");
const Paises = require("../models/paises");
const FotosDocumento = require("../models/fotos_documento");
const passwords = require("../lib/passwords");
const tokens = require("../lib/tokens");
const HttpError = require("../lib/http-error");
const { usuarioResumen, joinNombre, splitNombre } = require("../lib/usuario-shape");

const ADMIN_EMPLEADO_ID = Number(process.env.ADMIN_EMPLEADO_ID);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// convierte base64 a bytea (formato de PostgreSQL para binarios)
function base64ToBytea(b64) {
  if (!b64) return null;
  const stripped = String(b64).replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(stripped, "base64");
  return "\\x" + buf.toString("hex");
}

function validateRegistroEtapa1(body) {
  const required = ["nombre", "apellido", "email", "domicilioLegal", "paisOrigen", "dniFrente", "dniDorso"];
  const camposInvalidos = [];
  const errores = {};
  for (const k of required) {
    if (!body || !body[k]) {
      camposInvalidos.push(k);
      errores[k] = `${k} es obligatorio.`;
    }
  }
  return { ok: camposInvalidos.length === 0, camposInvalidos, errores };
}

// POST /registro/etapa1
exports.etapa1 = asyncHandler(async (req, res) => {
  const v = validateRegistroEtapa1(req.body);
  if (!v.ok) {
    throw new HttpError(
      400,
      "REGISTRO_DATOS_INVALIDOS",
      "Faltan campos obligatorios o los datos ingresados no son válidos.",
      { camposInvalidos: v.camposInvalidos, errores: v.errores },
    );
  }

  if (!ADMIN_EMPLEADO_ID) {
    throw new HttpError(
      500,
      "CONFIG_FALTANTE",
      "ADMIN_EMPLEADO_ID no configurado. Corré scripts/seed.js primero.",
    );
  }

  const { nombre, apellido, email, domicilioLegal, paisOrigen, dniFrente, dniDorso } = req.body;

  const existing = await ClientesAcceso.findOne({ email });
  if (existing) {
    throw new HttpError(
      409,
      "REGISTRO_DUPLICADO",
      "Ya existe una cuenta registrada con ese email. Si olvidaste tu clave, usá la opción 'Recuperar contraseña'.",
    );
  }

  const pais = await Paises.findOne({ nombre: paisOrigen });
  if (!pais) {
    throw new HttpError(
      400,
      "REGISTRO_DATOS_INVALIDOS",
      "País de origen no encontrado.",
      { campo: "paisOrigen" },
    );
  }

  // el documento real no lo tenemos todavía; el admin lo valida cuando revisa el DNI
  const documento = `PENDING-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

  const persona = await Personas.create({
    documento,
    nombre: joinNombre(nombre, apellido),
    direccion: domicilioLegal,
    estado: "activo",
  });

  const cliente = await Clientes.create({
    identificador: persona.identificador,
    numero_pais: pais.numero,
    admitido: "no",
    categoria: "comun",
    verificador: ADMIN_EMPLEADO_ID,
  });

  await FotosDocumento.create({
    cliente: cliente.identificador,
    foto_frente: base64ToBytea(dniFrente),
    foto_dorso: base64ToBytea(dniDorso),
  });

  // guardamos solo el hash en la base de datos; el token plano solo va en la respuesta
  const tokenPlano = tokens.randomToken("tok");
  const tokenHash = tokens.sha256(tokenPlano);

  await ClientesAcceso.create({
    cliente: cliente.identificador,
    email,
    password_hash: null,
    token_seguimiento_hash: tokenHash,
    fecha_registro: new Date().toISOString(),
  });

  res.status(201).json({
    registroId: String(cliente.identificador),
    tokenSeguimiento: tokenPlano,
    estado: "pendiente_aprobacion",
  });
});

// POST /registro/etapa2
exports.etapa2 = asyncHandler(async (req, res) => {
  const { tokenSeguimiento, email, clave } = req.body || {};

  if (!tokenSeguimiento || !email || !clave) {
    throw new HttpError(400, "REGISTRO_DATOS_INVALIDOS", "Faltan datos requeridos.");
  }

  const tokenHash = tokens.sha256(tokenSeguimiento);
  let acceso = await ClientesAcceso.findOne({ token_seguimiento_hash: tokenHash });

  if (!acceso) {
    // el hash se borra cuando se completa el registro; intentamos por email para dar un error más claro
    const accesoPorEmail = await ClientesAcceso.findOne({ email: email.trim() });
    if (accesoPorEmail?.password_hash) {
      throw new HttpError(
        400,
        "REGISTRO_YA_ACTIVO",
        "Ya creaste tu clave. Iniciá sesión con email y contraseña.",
      );
    }
    throw new HttpError(
      400,
      "REGISTRO_TOKEN_INVALIDO",
      "El token de seguimiento no es válido o ya fue utilizado.",
    );
  }

  if (acceso.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new HttpError(
      400,
      "REGISTRO_EMAIL_INVALIDO",
      "El email ingresado no coincide con el registrado.",
      { campo: "email" },
    );
  }

  const cliente = await Clientes.findById(acceso.cliente);
  if (cliente.admitido !== "si") {
    throw new HttpError(
      403,
      "REGISTRO_NO_APROBADO",
      "Tu solicitud de registro aún está siendo revisada por la empresa. Te enviaremos un email cuando esté aprobada.",
      { estado: "pendiente_aprobacion" },
    );
  }

  if (acceso.password_hash) {
    throw new HttpError(
      400,
      "REGISTRO_YA_ACTIVO",
      "Ya creaste tu clave. Iniciá sesión con email y contraseña.",
    );
  }

  const strength = passwords.validateStrength(clave);
  if (!strength.ok) {
    throw new HttpError(
      400,
      "AUTH_PASSWORD_WEAK",
      "La contraseña no cumple con los requisitos mínimos. Debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.",
      { requisitos: strength.requisitos },
    );
  }

  const hash = await passwords.hash(clave);
  // borramos el token de seguimiento una vez que el registro se completó, ya no sirve
  await ClientesAcceso.update(acceso.identificador, {
    password_hash: hash,
    token_seguimiento_hash: null,
  });

  const persona = await Personas.findById(cliente.identificador);

  // Emitir tokens
  const payload = { sub: cliente.identificador, email, categoria: cliente.categoria };
  const token = tokens.signAccess(payload);
  const refreshToken = tokens.signRefresh({ sub: cliente.identificador });
  await ClientesAcceso.update(acceso.identificador, { refresh_token: refreshToken });

  res.json({
    token,
    refreshToken,
    usuario: usuarioResumen({
      persona,
      cliente,
      acceso: { ...acceso, email, password_hash: hash },
      cantidadMediosPago: 0,
    }),
  });
});

// POST /registro/verificar-token
exports.verificarToken = asyncHandler(async (req, res) => {
  const { tokenSeguimiento } = req.body || {};
  if (!tokenSeguimiento) {
    throw new HttpError(
      404,
      "REGISTRO_TOKEN_INVALIDO",
      "El token de seguimiento no es válido o ya fue utilizado. Si ya creaste tu clave, iniciá sesión con email y contraseña.",
    );
  }

  const tokenHash = tokens.sha256(tokenSeguimiento);
  const acceso = await ClientesAcceso.findOne({ token_seguimiento_hash: tokenHash });
  if (!acceso) {
    // ¿Será un token cuyo hash ya borramos porque ya se activó?
    throw new HttpError(
      404,
      "REGISTRO_TOKEN_INVALIDO",
      "El token de seguimiento no es válido o ya fue utilizado. Si ya creaste tu clave, iniciá sesión con email y contraseña.",
    );
  }

  const cliente = await Clientes.findById(acceso.cliente);
  const persona = await Personas.findById(cliente.identificador);
  const { nombre } = splitNombre(persona?.nombre);

  if (cliente.admitido !== "si") {
    return res.json({ estado: "pendiente_aprobacion", email: null, nombre });
  }
  if (!acceso.password_hash) {
    return res.json({ estado: "requiere_clave", email: acceso.email, nombre, categoria: cliente.categoria });
  }
  return res.json({ estado: "ya_activo", email: acceso.email, nombre: null });
});
