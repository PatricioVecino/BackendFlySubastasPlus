function notImplemented(operationId, summary) {
  return function (req, res) {
    res.status(501).json({
      code: "NOT_IMPLEMENTED",
      operationId,
      summary,
      message: `Pendiente: ${summary}`,
    });
  };
}

module.exports = { notImplemented };
