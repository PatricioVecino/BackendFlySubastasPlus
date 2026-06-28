const Paises = require("../models/paises");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

exports.listar = asyncHandler(async (req, res) => {
  const paises = await Paises.findAll();
  res.json(paises);
});
