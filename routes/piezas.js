const express = require("express");
const ctrl = require("../controllers/subastas.controller");
const fotosCtrl = require("../controllers/fotos.controller");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/:id/fotos/:n", fotosCtrl.fotoPieza);
router.get("/:id", optionalAuth, ctrl.detallePieza);

module.exports = router;
