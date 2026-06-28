const bcrypt = require("bcryptjs");

const ROUNDS = 10;

async function hash(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function verify(plain, hashed) {
  if (!plain || !hashed) return false;
  return bcrypt.compare(plain, hashed);
}

// Swagger: minimo_8_caracteres, una_mayuscula, una_minuscula, un_numero
function validateStrength(plain) {
  const requisitos = [];
  if (!plain || plain.length < 8) requisitos.push("minimo_8_caracteres");
  if (!/[A-Z]/.test(plain || "")) requisitos.push("una_mayuscula");
  if (!/[a-z]/.test(plain || "")) requisitos.push("una_minuscula");
  if (!/\d/.test(plain || "")) requisitos.push("un_numero");
  return { ok: requisitos.length === 0, requisitos };
}

module.exports = { hash, verify, validateStrength };
