const express = require("express");
const ctrl = require("../controllers/historial.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/participaciones", ctrl.participaciones);
router.get("/participaciones/:id", ctrl.detalleParticipacion);
router.get("/participaciones/:id/pujas", ctrl.pujasDeParticipacion);
router.get("/ventas", ctrl.ventas);
router.get("/metricas", ctrl.metricas);

module.exports = router;
