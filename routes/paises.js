const express = require("express");
const ctrl = require("../controllers/paises.controller");

const router = express.Router();

router.get("/", ctrl.listar);

module.exports = router;
