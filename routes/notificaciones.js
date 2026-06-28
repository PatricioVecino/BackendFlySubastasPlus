const express = require("express");
const ctrl = require("../controllers/notificaciones.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/", ctrl.listar);
router.get("/:id", ctrl.detalle);
router.get("/:id/mensajes", ctrl.listarMensajes);
router.post("/:id/mensajes", ctrl.enviarMensaje);

module.exports = router;
