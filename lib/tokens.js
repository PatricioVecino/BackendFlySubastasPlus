const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("Missing JWT_SECRET in environment");

const ACCESS_TTL = process.env.JWT_EXPIRES_IN || "1h";
const REFRESH_TTL = "7d";
const RESET_TTL = "15m";

function signAccess(payload) {
  return jwt.sign({ ...payload, type: "access" }, SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function signRefresh(payload) {
  return jwt.sign({ ...payload, type: "refresh" }, SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

function signReset(payload) {
  return jwt.sign({ ...payload, type: "reset" }, SECRET, {
    expiresIn: RESET_TTL,
  });
}

function verify(token, expectedType) {
  const decoded = jwt.verify(token, SECRET);
  if (expectedType && decoded.type !== expectedType) {
    const err = new Error(`Expected token type "${expectedType}"`);
    err.name = "JsonWebTokenError";
    throw err;
  }
  return decoded;
}

function randomToken(prefix = "tok") {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

function randomCode() {
  // 6 dígitos, con ceros a la izquierda
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = {
  signAccess,
  signRefresh,
  signReset,
  verify,
  randomToken,
  randomCode,
  sha256,
};
