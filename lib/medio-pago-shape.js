// Helpers para MedioPago: shape DB ↔ API + validadores.

function aliasPorDefecto(row) {
  const banco = row.banco || row.tipo;
  if (row.tipo === "cuenta_nacional") {
    const tc = row.tipo_cuenta === "caja_ahorro" ? "CA" : "CC";
    return `${banco} - ${tc}${row.moneda ? " " + row.moneda : ""}`;
  }
  if (row.tipo === "cuenta_exterior") {
    return `${banco}${row.moneda ? " - " + row.moneda : ""}`;
  }
  if (row.tipo === "tarjeta_credito") {
    return `Tarjeta ****${row.ultimos_digitos || "----"}`;
  }
  if (row.tipo === "cheque_certificado") {
    return `Cheque ${banco} #${row.numero_cheque || "?"}`;
  }
  return banco;
}

function montoDisponible(row) {
  if (row.tipo === "cuenta_nacional" || row.tipo === "cuenta_exterior") {
    return row.saldo != null ? Number(row.saldo) : null;
  }
  if (row.tipo === "tarjeta_credito") {
    return row.limite_credito != null ? Number(row.limite_credito) : null;
  }
  if (row.tipo === "cheque_certificado") {
    return row.monto_cheque != null ? Number(row.monto_cheque) : null;
  }
  return null;
}

function medioPagoShape(row, comprometido = 0) {
  const total = montoDisponible(row);
  return {
    id: String(row.identificador),
    tipo: row.tipo,
    alias: row.alias || aliasPorDefecto(row),
    verificado: row.verificado === "si",
    moneda: row.moneda || null,
    ultimosDigitos: row.ultimos_digitos || null,
    vencimiento: row.vencimiento || null,
    montoCheque: row.monto_cheque != null ? Number(row.monto_cheque) : null,
    montoDisponible: total != null ? Math.max(0, total - comprometido) : null,
    creadoEn: row.created_at || null,
  };
}

// ─── Validadores ────────────────────────────────────────────────────────────
function validarCbu(cbu) {
  const s = String(cbu || "").replace(/\D/g, "");
  return s.length === 22;
}

// Luhn check para número de tarjeta
function validarLuhn(numero) {
  const s = String(numero || "").replace(/\D/g, "");
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = parseInt(s[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function parseVencimiento(v) {
  // formato esperado "MM/YY" o "MM/YYYY"
  const m = String(v || "").match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  let mm = parseInt(m[1], 10);
  let yy = parseInt(m[2], 10);
  if (mm < 1 || mm > 12) return null;
  if (yy < 100) yy += 2000;
  return { mm, yy };
}

function tarjetaVencida(vencimiento) {
  const p = parseVencimiento(vencimiento);
  if (!p) return true;
  const hoy = new Date();
  // vencida si pasó el último día del mes de vencimiento
  const finMes = new Date(p.yy, p.mm, 0, 23, 59, 59);
  return hoy > finMes;
}

module.exports = {
  medioPagoShape,
  montoDisponible,
  aliasPorDefecto,
  validarCbu,
  validarLuhn,
  parseVencimiento,
  tarjetaVencida,
};
