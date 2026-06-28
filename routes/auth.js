const express = require("express");
const ctrl = require("../controllers/auth.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/login", ctrl.login);
router.post("/logout", verifyToken, ctrl.logout);
router.post("/refresh", ctrl.refresh);
router.post("/recuperar-clave", ctrl.recuperarClave);
router.post("/verificar-codigo", ctrl.verificarCodigo);
router.post("/nueva-clave", ctrl.nuevaClave);

module.exports = router;
