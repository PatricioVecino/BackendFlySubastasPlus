const tokens = require("../lib/tokens");
const { tieneMultaJudicial } = require("../lib/multas-helper");

function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, headerToken] = header.split(" ");
  const token = (scheme === "Bearer" && headerToken) ? headerToken : req.query.token;

  if (!token) {
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
      message: "Tu sesión expiró o el token es inválido. Iniciá sesión nuevamente.",
      details: null,
    });
  }

  tieneMultaJudicial(req.user.sub).then((bloqueado) => {
    if (bloqueado) {
      return res.status(403).json({
        code: "AUTH_BLOCKED_JUDICIAL",
        message: "Tu cuenta fue bloqueada por incumplimiento de pago. El caso fue derivado a la justicia. No podés acceder a ningún servicio de la aplicación.",
        details: null,
      });
    }
    next();
  }).catch(() => next());
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      req.user = tokens.verify(token, "access");
    } catch (_) {
      req.user = null;
    }
  }
  next();
}

module.exports = { verifyToken, optionalAuth };
