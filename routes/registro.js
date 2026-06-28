const express = require("express");
const ctrl = require("../controllers/registro.controller");

const router = express.Router();

router.post("/etapa1", ctrl.etapa1);
router.post("/etapa2", ctrl.etapa2);
router.post("/verificar-token", ctrl.verificarToken);

module.exports = router;
