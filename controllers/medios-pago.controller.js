const supabase = require("../supabase-client");
const MediosPago = require("../models/medios_pago");
const Asistentes = require("../models/asistentes");
const AsistentesExtension = require("../models/asistentes_extension");
const RegistroSubastaExtension = require("../models/registro_subasta_extension");
const HttpError = require("../lib/http-error");
const {
  medioPagoShape,
  validarCbu,
  validarLuhn,
  tarjetaVencida,
} = require("../lib/medio-pago-shape");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function findOwn(id, clienteId) {
  const row = await MediosPago.findById(id);
  if (!row || row.cliente !== clienteId) {
    throw new HttpError(404, "PAGO_NO_ENCONTRADO", "El medio de pago solicitado no existe o fue eliminado.");
  }
  return row;
}

async function calcularComprometido(clienteId, medioId) {
  const { data: registros } = await supabase
    .from("registro_de_subasta")
    .select("identificador, importe, comision, subasta")
    .eq("cliente", clienteId);
  let comprometido = 0;
  for (const reg of registros || []) {
    const asistente = await Asistentes.findOne({ cliente: clienteId, subasta: reg.subasta });
    if (!asistente) continue;
    const extAsis = await AsistentesExtension.findOne({ asistente: asistente.identificador });
    if (String(extAsis?.medio_pago) !== String(medioId)) continue;
    const extCompra = await RegistroSubastaExtension.findOne({ registro: reg.identificador });
    if (!extCompra) continue;
    comprometido += Number(reg.importe || 0) + Number(reg.comision || 0);
  }
  return comprometido;
}

function requireFields(body, fields, code, message) {
  const camposInvalidos = fields.filter((f) => !body || body[f] === undefined || body[f] === "");
  if (camposInvalidos.length) {
    throw new HttpError(400, code, message, { camposInvalidos });
  }
}

// GET /medios-pago
exports.listar = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from("medios_pago")
    .select("*")
    .eq("cliente", req.user.sub)
    .order("identificador");
  if (error) throw error;
  const result = await Promise.all(
    (data || []).map(async (row) => {
      const comprometido = await calcularComprometido(req.user.sub, row.identificador);
      return medioPagoShape(row, comprometido);
    })
  );
  res.json(result);
});

// POST /medios-pago/cuenta-nacional
exports.agregarCuentaNacional = asyncHandler(async (req, res) => {
  requireFields(
    req.body,
    ["banco", "cbu", "cuitCuil", "tipoCuenta", "titular", "saldo"],
    "PAGO_DATOS_INVALIDOS",
    "Faltan campos obligatorios para la cuenta nacional.",
  );
  const { banco, cbu, cuitCuil, tipoCuenta, titular, alias, saldo } = req.body;

  if (!(Number(saldo) > 0)) {
    throw new HttpError(400, "PAGO_DATOS_INVALIDOS", "El saldo disponible debe ser mayor a cero.", { campo: "saldo" });
  }

  if (!validarCbu(cbu)) {
    throw new HttpError(
      400,
      "PAGO_CBU_INVALIDO",
      "El CBU ingresado no es válido. Verificá que tenga 22 dígitos y que sea correcto.",
      { campo: "cbu", longitudEsperada: 22 },
    );
  }
  if (!["caja_ahorro", "cuenta_corriente"].includes(tipoCuenta)) {
    throw new HttpError(400, "PAGO_DATOS_INVALIDOS", "tipoCuenta inválido.", {
      campo: "tipoCuenta",
    });
  }

  const row = await MediosPago.create({
    cliente: req.user.sub,
    tipo: "cuenta_nacional",
    verificado: "no",
    alias: alias || null,
    moneda: "ARS",
    titular,
    banco,
    cbu: String(cbu).replace(/\D/g, ""),
    cuit_cuil: cuitCuil,
    tipo_cuenta: tipoCuenta,
    ultimos_digitos: String(cbu).replace(/\D/g, "").slice(-4),
    saldo: Number(saldo),
  });
  res.status(201).json(medioPagoShape(row));
});

// POST /medios-pago/cuenta-exterior
exports.agregarCuentaExterior = asyncHandler(async (req, res) => {
  requireFields(
    req.body,
    ["banco", "swift", "iban", "pais", "titular", "moneda", "saldo"],
    "PAGO_CUENTA_EXTERIOR_INVALIDA",
    "Los datos de la cuenta exterior son inválidos. Verificá el código SWIFT y el IBAN.",
  );
  const { banco, swift, iban, pais, titular, moneda, alias, saldo } = req.body;

  if (!(Number(saldo) > 0)) {
    throw new HttpError(400, "PAGO_CUENTA_EXTERIOR_INVALIDA", "El saldo disponible debe ser mayor a cero.", { campo: "saldo" });
  }

  if (!["USD", "EUR", "GBP"].includes(moneda)) {
    throw new HttpError(
      400,
      "PAGO_CUENTA_EXTERIOR_INVALIDA",
      "Moneda inválida para cuenta exterior.",
      { campo: "moneda" },
    );
  }
  if (String(swift).length < 8 || String(swift).length > 11) {
    throw new HttpError(
      400,
      "PAGO_CUENTA_EXTERIOR_INVALIDA",
      "El código SWIFT/BIC debe tener entre 8 y 11 caracteres.",
      { camposInvalidos: ["swift"] },
    );
  }

  const row = await MediosPago.create({
    cliente: req.user.sub,
    tipo: "cuenta_exterior",
    verificado: "no",
    alias: alias || null,
    moneda,
    titular,
    banco,
    swift,
    iban: String(iban).replace(/\s+/g, ""),
    pais,
    ultimos_digitos: String(iban).replace(/\s+/g, "").slice(-4),
    saldo: Number(saldo),
  });
  res.status(201).json(medioPagoShape(row));
});

// POST /medios-pago/tarjeta
exports.agregarTarjeta = asyncHandler(async (req, res) => {
  requireFields(
    req.body,
    ["numero", "titular", "vencimiento", "codigoSeguridad", "limiteCredito", "moneda"],
    "PAGO_TARJETA_INVALIDA",
    "Faltan campos obligatorios para la tarjeta.",
  );
  const { numero, titular, vencimiento, limiteCredito, moneda } = req.body;

  if (!["ARS", "USD"].includes(moneda)) {
    throw new HttpError(400, "PAGO_TARJETA_INVALIDA", "Moneda inválida. Debe ser ARS o USD.", { campo: "moneda" });
  }
  if (!(Number(limiteCredito) > 0)) {
    throw new HttpError(400, "PAGO_TARJETA_INVALIDA", "El límite de crédito debe ser mayor a cero.", { campo: "limiteCredito" });
  }

  const numStr = String(numero).replace(/\D/g, "");
  if (!validarLuhn(numStr)) {
    throw new HttpError(
      400,
      "PAGO_TARJETA_INVALIDA",
      "El número de tarjeta ingresado no es válido.",
      { campo: "numero" },
    );
  }
  if (tarjetaVencida(vencimiento)) {
    throw new HttpError(
      400,
      "PAGO_TARJETA_INVALIDA",
      "El número de tarjeta ingresado no es válido o la tarjeta está vencida.",
      { campo: "vencimiento" },
    );
  }

  const row = await MediosPago.create({
    cliente: req.user.sub,
    tipo: "tarjeta_credito",
    verificado: "no",
    alias: req.body.alias || null,
    moneda,
    titular,
    vencimiento,
    ultimos_digitos: numStr.slice(-4),
    limite_credito: Number(limiteCredito),
  });
  res.status(201).json(medioPagoShape(row));
});

// POST /medios-pago/cheque
exports.agregarCheque = asyncHandler(async (req, res) => {
  requireFields(
    req.body,
    ["banco", "numeroCheque", "monto", "moneda", "fechaEmision"],
    "PAGO_CHEQUE_INVALIDO",
    "Los datos del cheque son inválidos. Verificá el número, el monto y la fecha de emisión.",
  );
  const { banco, numeroCheque, monto, moneda, fechaEmision, titular } = req.body;

  const camposInvalidos = [];
  if (!(Number(monto) > 0)) camposInvalidos.push("monto");
  if (!["ARS", "USD"].includes(moneda)) camposInvalidos.push("moneda");
  const fechaOk = !isNaN(Date.parse(fechaEmision));
  if (!fechaOk) camposInvalidos.push("fechaEmision");
  if (camposInvalidos.length) {
    throw new HttpError(
      400,
      "PAGO_CHEQUE_INVALIDO",
      "Los datos del cheque son inválidos. Verificá el número, el monto y la fecha de emisión.",
      { camposInvalidos },
    );
  }

  const row = await MediosPago.create({
    cliente: req.user.sub,
    tipo: "cheque_certificado",
    verificado: "no",
    alias: req.body.alias || null,
    moneda,
    titular: titular || null,
    banco,
    numero_cheque: numeroCheque,
    monto_cheque: monto,
    fecha_emision: fechaEmision,
  });
  res.status(201).json(medioPagoShape(row));
});

// GET /medios-pago/:id
exports.detalle = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);
  const comprometido = await calcularComprometido(req.user.sub, row.identificador);
  res.json(medioPagoShape(row, comprometido));
});

// DELETE /medios-pago/:id
exports.eliminar = asyncHandler(async (req, res) => {
  const row = await findOwn(Number(req.params.id), req.user.sub);

  const { count } = await supabase
    .from("medios_pago")
    .select("*", { count: "exact", head: true })
    .eq("cliente", req.user.sub);

  if ((count || 0) <= 1) {
    throw new HttpError(
      400,
      "PAGO_NO_ELIMINABLE",
      "No podés eliminar este medio de pago porque es el único que tenés registrado. Debés tener al menos uno activo.",
      { razon: "unico_medio_pago" },
    );
  }

  const { error } = await supabase
    .from("medios_pago")
    .delete()
    .eq("identificador", row.identificador);
  if (error) throw error;
  res.status(204).end();
});
