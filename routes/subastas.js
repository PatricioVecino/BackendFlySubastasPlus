const express = require("express");
const ctrl = require("../controllers/subastas.controller");
const { verifyToken, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// Públicos (con login opcional para mostrar precios base)
router.get("/", optionalAuth, ctrl.listar);
router.get("/:id", optionalAuth, ctrl.detalle);
router.get("/:id/catalogo", optionalAuth, ctrl.catalogo);

// Sala en Vivo (requiere auth)
router.post("/:id/medio-pago", verifyToken, ctrl.fijarMedioPago);
router.get("/:id/sala", verifyToken, ctrl.ingresarSala);
router.post("/:id/pujas", verifyToken, ctrl.realizarPuja);
router.post("/:id/sala/salir", verifyToken, ctrl.salirSala);

module.exports = router;
