const express = require("express");
const ctrl = require("../controllers/perfil.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", verifyToken, ctrl.obtener);
router.put("/foto", verifyToken, ctrl.subirFoto);
router.get("/foto", verifyToken, ctrl.obtenerFoto);

module.exports = router;
