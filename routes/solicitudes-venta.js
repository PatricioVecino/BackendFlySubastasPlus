const express = require("express");
const ctrl = require("../controllers/solicitudes-venta.controller");
const fotosCtrl = require("../controllers/fotos.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/", ctrl.listar);
router.post("/", ctrl.crear);
router.get("/:id", ctrl.detalle);
router.post("/:id/aceptar-condiciones", ctrl.aceptarCondiciones);
router.post("/:id/cancelar", ctrl.cancelar);
router.get("/:id/poliza", ctrl.verPoliza);
router.get("/:id/contactar-aseguradora", ctrl.contactarAseguradora);
router.get("/:id/fotos/:n", fotosCtrl.fotoSolicitud);

module.exports = router;
