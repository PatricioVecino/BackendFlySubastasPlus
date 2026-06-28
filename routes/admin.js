const express = require("express");
const { verifyAdmin } = require("../middleware/admin");
const clientesCtrl = require("../controllers/admin-clientes.controller");
const fotosCtrl = require("../controllers/fotos.controller");
const mediosPagoCtrl = require("../controllers/admin-medios-pago.controller");
const solicitudesVentaCtrl = require("../controllers/admin-solicitudes-venta.controller");
const subastasCtrl = require("../controllers/admin-subastas.controller");

const router = express.Router();

router.use(verifyAdmin);

// Gestión de clientes
router.get("/clientes/pendientes", clientesCtrl.pendientes);
router.get("/clientes/:id/documento/:lado", fotosCtrl.fotoDocumentoCliente);
router.post("/clientes/:id/aprobar", clientesCtrl.aprobar);
router.post("/clientes/:id/rechazar", clientesCtrl.rechazar);

// Verificación de medios de pago
router.post("/medios-pago/:id/verificar", mediosPagoCtrl.verificar);

// Solicitudes de venta
router.post("/solicitudes-venta/:id/revisar", solicitudesVentaCtrl.revisar);
router.post("/solicitudes-venta/:id/aceptar-revision", solicitudesVentaCtrl.aceptarRevision);
router.post("/solicitudes-venta/:id/enviar-propuesta", solicitudesVentaCtrl.enviarPropuesta);
router.post("/solicitudes-venta/:id/rechazar", solicitudesVentaCtrl.rechazar);
router.post("/solicitudes-venta/:id/asignar-subasta", solicitudesVentaCtrl.asignarSubasta);
router.post("/solicitudes-venta/:id/seguro", solicitudesVentaCtrl.crearSeguro);
router.post("/solicitudes-venta/:id/confirmar-recepcion", solicitudesVentaCtrl.confirmarRecepcion);
router.post("/solicitudes-venta/:id/rechazar-deposito", solicitudesVentaCtrl.rechazarDeposito);

// Gestión de subastas
router.post("/subastas", subastasCtrl.crear);
router.put("/subastas/:id", subastasCtrl.actualizar);
router.post("/subastas/:id/items", subastasCtrl.agregarItem);
router.post("/subastas/:id/items/:itemId/activar", subastasCtrl.activarItem);
router.post("/subastas/:id/items/:itemId/cerrar", subastasCtrl.cerrarItem);
router.post("/subastas/:id/cerrar", subastasCtrl.cerrarSubasta);

module.exports = router;
