const express = require("express");
const ctrl = require("../controllers/medios-pago.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/", ctrl.listar);
router.post("/cuenta-nacional", ctrl.agregarCuentaNacional);
router.post("/cuenta-exterior", ctrl.agregarCuentaExterior);
router.post("/tarjeta", ctrl.agregarTarjeta);
router.post("/cheque", ctrl.agregarCheque);
router.get("/:id", ctrl.detalle);
router.delete("/:id", ctrl.eliminar);

module.exports = router;
