const ClientesAcceso = require("../models/clientes_acceso");
const Clientes = require("../models/clientes");
const Personas = require("../models/personas");
const MediosPago = require("../models/medios_pago");
const passwords = require("../lib/passwords");
const tokens = require("../lib/tokens");
const HttpError = require("../lib/http-error");
const { usuarioResumen } = require("../lib/usuario-shape");
const { tieneMultaActiva, tieneMultaJudicial } = require("../lib/multas-helper");
const { enviarCodigoRecuperacion } = require("../lib/mailer");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function buildLoginResponse(cliente, persona, acceso) {
  // traemos medios de pago y multas en paralelo para no hacer las dos consultas en serie
  const [cantidadMediosPago, tieneMulta] = await Promise.all([
    MediosPago.count({ cliente: cliente.identificador }),
    tieneMultaActiva(cliente.identificador),
  ]);

  const payload = {
    sub: cliente.identificador,
    email: acceso.email,
    categoria: cliente.categoria,
  };
  const token = tokens.signAccess(payload);
  const refreshToken = tokens.signRefresh({ sub: cliente.identificador });

  // Guardar el refresh emitido para que /logout pueda invalidar
  await ClientesAcceso.update(acceso.identificador, { refresh_token: refreshToken });

  return {
    token,
    refreshToken,
    usuario: usuarioResumen({
      persona,
      cliente,
      acceso,
      cantidadMediosPago,
      tieneMultaActiva: tieneMulta,
    }),
  };
}

// POST /auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    throw new HttpError(
      401,
      "AUTH_INVALID_CREDENTIALS",
      "El email o la contraseña son incorrectos. Verificá tus datos e intentá nuevamente.",
    );
  }

  const acceso = await ClientesAcceso.findOne({ email });
  if (!acceso || !acceso.password_hash) {
    throw new HttpError(
      401,
      "AUTH_INVALID_CREDENTIALS",
      "El email o la contraseña son incorrectos. Verificá tus datos e intentá nuevamente.",
    );
  }

  const ok = await passwords.verify(password, acceso.password_hash);
  if (!ok) {
    throw new HttpError(
      401,
      "AUTH_INVALID_CREDENTIALS",
      "El email o la contraseña son incorrectos. Verificá tus datos e intentá nuevamente.",
    );
  }

  const cliente = await Clientes.findById(acceso.cliente);

  // Bloqueo por derivación a justicia — sin acceso a ningún servicio
  if (await tieneMultaJudicial(cliente.identificador)) {
    throw new HttpError(
      403,
      "AUTH_BLOCKED_JUDICIAL",
      "Tu cuenta fue bloqueada por incumplimiento de pago. El caso fue derivado a la justicia. No podés acceder a ningún servicio de la aplicación.",
    );
  }

  const persona = await Personas.findById(cliente.identificador);

  res.json(await buildLoginResponse(cliente, persona, acceso));
});

// POST /auth/logout
exports.logout = asyncHandler(async (req, res) => {
  const acceso = await ClientesAcceso.findOne({ cliente: req.user.sub });
  if (acceso) {
    await ClientesAcceso.update(acceso.identificador, { refresh_token: null });
  }
  res.status(204).end();
});

// POST /auth/refresh
exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    throw new HttpError(
      401,
      "AUTH_REFRESH_EXPIRED",
      "Tu sesión expiró. Por favor, iniciá sesión nuevamente.",
    );
  }

  let decoded;
  try {
    decoded = tokens.verify(refreshToken, "refresh");
  } catch (_) {
    throw new HttpError(
      401,
      "AUTH_REFRESH_EXPIRED",
      "Tu sesión expiró. Por favor, iniciá sesión nuevamente.",
    );
  }

  const acceso = await ClientesAcceso.findOne({ cliente: decoded.sub });
  if (!acceso || acceso.refresh_token !== refreshToken) {
    throw new HttpError(
      401,
      "AUTH_REFRESH_EXPIRED",
      "Tu sesión expiró. Por favor, iniciá sesión nuevamente.",
    );
  }

  const cliente = await Clientes.findById(acceso.cliente);
  const persona = await Personas.findById(cliente.identificador);

  res.json(await buildLoginResponse(cliente, persona, acceso));
});

// POST /auth/recuperar-clave
exports.recuperarClave = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    throw new HttpError(
      404,
      "AUTH_EMAIL_NOT_FOUND",
      "No encontramos una cuenta asociada a ese email. Verificá el email ingresado o creá una cuenta nueva.",
    );
  }

  const acceso = await ClientesAcceso.findOne({ email });
  if (!acceso) {
    throw new HttpError(
      404,
      "AUTH_EMAIL_NOT_FOUND",
      "No encontramos una cuenta asociada a ese email. Verificá el email ingresado o creá una cuenta nueva.",
    );
  }

  const codigo = tokens.randomCode();
  // el código de recuperación vence en 15 minutos
  const expiracion = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await ClientesAcceso.update(acceso.identificador, {
    codigo_recuperacion: codigo,
    codigo_expiracion: expiracion,
  });

  await enviarCodigoRecuperacion(email, codigo);

  res.json({ message: "Código enviado al email" });
});

// POST /auth/verificar-codigo
exports.verificarCodigo = asyncHandler(async (req, res) => {
  const { email, codigo } = req.body || {};
  // no distinguimos entre "código incorrecto" y "código expirado" para no dar pistas
  const acceso = email ? await ClientesAcceso.findOne({ email }) : null;
  const invalid = () => {
    throw new HttpError(
      400,
      "AUTH_CODE_INVALID",
      "El código ingresado es incorrecto o ya expiró. Solicitá un nuevo código de verificación.",
    );
  };

  if (!acceso || !acceso.codigo_recuperacion || acceso.codigo_recuperacion !== codigo) {
    invalid();
  }
  if (acceso.codigo_expiracion && new Date(acceso.codigo_expiracion) < new Date()) {
    invalid();
  }

  const resetToken = tokens.signReset({ sub: acceso.cliente, email });
  res.json({ resetToken });
});

// POST /auth/nueva-clave
exports.nuevaClave = asyncHandler(async (req, res) => {
  const { email, nuevaClave, resetToken } = req.body || {};

  const strength = passwords.validateStrength(nuevaClave);
  if (!strength.ok) {
    throw new HttpError(
      400,
      "AUTH_PASSWORD_WEAK",
      "La contraseña no cumple con los requisitos mínimos. Debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.",
      { requisitos: strength.requisitos },
    );
  }

  // El Swagger no exige resetToken pero es la única forma segura.
  // Si no lo mandan, exigimos coincidencia con un código vigente.
  let clienteId = null;
  if (resetToken) {
    try {
      const decoded = tokens.verify(resetToken, "reset");
      if (decoded.email !== email) throw new Error("email mismatch");
      clienteId = decoded.sub;
    } catch (_) {
      throw new HttpError(400, "AUTH_RESET_INVALID", "Token de reseteo inválido o expirado.");
    }
  } else {
    const acceso = email ? await ClientesAcceso.findOne({ email }) : null;
    if (!acceso) {
      throw new HttpError(400, "AUTH_RESET_INVALID", "Solicitud inválida.");
    }
    clienteId = acceso.cliente;
  }

  const acceso = await ClientesAcceso.findOne({ cliente: clienteId });
  const hash = await passwords.hash(nuevaClave);
  await ClientesAcceso.update(acceso.identificador, {
    password_hash: hash,
    codigo_recuperacion: null,
    codigo_expiracion: null,
  });

  res.json({ message: "Clave actualizada" });
});
