const express = require("express");
const ctrl = require("../controllers/compras.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/", ctrl.listar);
router.get("/:id", ctrl.detalle);
router.put("/:id/medio-pago", ctrl.cambiarMedioPago);
router.post("/:id/pagar", ctrl.pagar);

module.exports = router;
