require("dotenv").config();
var express = require("express");
var cors = require("cors");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");

// API v1 routers
var authRouter = require("./routes/auth");
var registroRouter = require("./routes/registro");
var perfilRouter = require("./routes/perfil");
var mediosPagoRouter = require("./routes/medios-pago");
var subastasRouter = require("./routes/subastas");
var piezasRouter = require("./routes/piezas");
var comprasRouter = require("./routes/compras");
var multasRouter = require("./routes/multas");
var solicitudesVentaRouter = require("./routes/solicitudes-venta");
var notificacionesRouter = require("./routes/notificaciones");
var historialRouter = require("./routes/historial");
var adminRouter = require("./routes/admin");
var paisesRouter = require("./routes/paises");

var { notFound, errorHandler } = require("./middleware/error");

var app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(cors());
app.use(logger("dev"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Boilerplate (legacy)
app.use("/", indexRouter);
app.use("/users", usersRouter);

// API v1
app.use("/v1/auth", authRouter);
app.use("/v1/registro", registroRouter);
app.use("/v1/perfil", perfilRouter);
app.use("/v1/medios-pago", mediosPagoRouter);
app.use("/v1/subastas", subastasRouter);
app.use("/v1/piezas", piezasRouter);
app.use("/v1/compras", comprasRouter);
app.use("/v1/multas", multasRouter);
app.use("/v1/solicitudes-venta", solicitudesVentaRouter);
app.use("/v1/notificaciones", notificacionesRouter);
app.use("/v1/historial", historialRouter);
app.use("/v1/admin", adminRouter);
app.use("/v1/paises", paisesRouter);

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

module.exports = app;
