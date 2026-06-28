const express = require("express");
const ctrl = require("../controllers/multas.controller");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/", ctrl.listar);
router.post("/:id/pagar", ctrl.pagar);

module.exports = router;
