const tokens = require("../lib/tokens");
const Empleados = require("../models/empleados");

async function verifyAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      code: "AUTH_TOKEN_INVALID",
      message: "Authorization Bearer token requerido",
      details: null,
    });
  }
  try {
    req.user = tokens.verify(token, "access");
  } catch {
    return res.status(401).json({
      code: "AUTH_TOKEN_INVALID",
      message: "Tu sesión expiró o el token es inválido.",
      details: null,
    });
  }
  const empleado = await Empleados.findById(req.user.sub);
  if (!empleado) {
    return res.status(403).json({
      code: "ADMIN_FORBIDDEN",
      message: "Acceso restringido a administradores.",
      details: null,
    });
  }
  req.empleado = empleado;
  next();
}

module.exports = { verifyAdmin };
