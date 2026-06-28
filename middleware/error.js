function notFound(req, res, next) {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(err, req, res, next) {
  console.error("[error]", err);
  const status = err.status || 500;
  res.status(status).json({
    code: err.code || "INTERNAL_ERROR",
    message: err.message || "Error interno",
    details: err.details || null,
  });
}

module.exports = { notFound, errorHandler };
