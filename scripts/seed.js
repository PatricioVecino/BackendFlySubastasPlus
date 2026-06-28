require("dotenv").config();
const supabase = require("../supabase-client");
const Paises = require("../models/paises");
const Sectores = require("../models/sectores");
const Empleados = require("../models/empleados");
const Personas = require("../models/personas");
const Clientes = require("../models/clientes");
const ClientesAcceso = require("../models/clientes_acceso");
const Subastadores = require("../models/subastadores");
const Duenios = require("../models/duenios");
const Productos = require("../models/productos");
const ProductosExtension = require("../models/productos_extension");
const Subastas = require("../models/subastas");
const SubastasExtension = require("../models/subastas_extension");
const Catalogos = require("../models/catalogos");
const ItemsCatalogo = require("../models/items_catalogo");
const ItemsCatalogoEstado = require("../models/items_catalogo_estado");
const MediosPago = require("../models/medios_pago");
const passwords = require("../lib/passwords");

const TEST_EMAIL = "test@subastasplus.local";
const TEST_PASSWORD = "Test1234!";

async function findOrCreate(model, where, data) {
  const existing = await model.findOne(where);
  if (existing) return { row: existing, created: false };
  const row = await model.create({ ...where, ...data });
  return { row, created: true };
}

(async () => {
  console.log("Seeding...\n");

  // 1. País Argentina (ISO 3166 numeric: 32)
  const arg = await findOrCreate(Paises, { nombre: "Argentina" }, {
    numero: 32,
    nombre_corto: "AR",
    capital: "Buenos Aires",
    nacionalidad: "Argentina",
    idiomas: "Español",
  });
  console.log(`  ${arg.created ? "+" : "·"} pais Argentina (numero=${arg.row.numero})`);

  // 2. Sector administrativo
  const sector = await findOrCreate(Sectores, { nombre_sector: "Administración" }, {
    codigo_sector: "ADM",
  });
  console.log(`  ${sector.created ? "+" : "·"} sector Administración (id=${sector.row.identificador})`);

  // 3. Empleado admin (verificador para nuevos registros)
  const admin = await findOrCreate(Empleados, { cargo: "Admin" }, {
    sector: sector.row.identificador,
  });
  console.log(`  ${admin.created ? "+" : "·"} empleado Admin (id=${admin.row.identificador})`);

  // 4. Usuario de prueba (cliente aprobado con clave)
  let acceso = await ClientesAcceso.findOne({ email: TEST_EMAIL });
  if (acceso) {
    console.log(`  · cliente test ya existe (cliente=${acceso.cliente})`);
  } else {
    const persona = await Personas.create({
      documento: "99999999",
      nombre: "Test User",
      direccion: "Calle Falsa 123",
      estado: "activo",
    });
    const cliente = await Clientes.create({
      identificador: persona.identificador,
      numero_pais: arg.row.numero,
      admitido: "si",
      categoria: "comun",
      verificador: admin.row.identificador,
    });
    acceso = await ClientesAcceso.create({
      cliente: cliente.identificador,
      email: TEST_EMAIL,
      password_hash: await passwords.hash(TEST_PASSWORD),
      fecha_registro: new Date().toISOString(),
    });
    console.log(`  + persona/cliente/acceso (cliente=${cliente.identificador})`);
  }

  const clienteTestId = acceso.cliente;

  // 5. Medio de pago verificado para el cliente test (necesario para entrar a la sala)
  let medio = await MediosPago.findOne({ cliente: clienteTestId });
  if (!medio) {
    medio = await MediosPago.create({
      cliente: clienteTestId,
      tipo: "cuenta_nacional",
      verificado: "si",
      alias: "Banco Test",
      moneda: "ARS",
      ultimos_digitos: "1234",
      titular: "Test User",
      banco: "Banco Test",
    });
    console.log(`  + medio_pago verificado para cliente test (id=${medio.identificador})`);
  } else {
    if (medio.verificado !== "si") {
      await MediosPago.update(medio.identificador, { verificado: "si" });
    }
    console.log(`  · medio_pago test ya existe (id=${medio.identificador})`);
  }

  // 6. Persona + Subastador (rematador)
  let rematadorPersona = await Personas.findOne({ documento: "REMATADOR-1" });
  if (!rematadorPersona) {
    rematadorPersona = await Personas.create({
      documento: "REMATADOR-1",
      nombre: "Dr. Roberto García",
      direccion: "Av. del Libertador 4200, CABA",
      estado: "activo",
    });
  }
  let subastador = await Subastadores.findById(rematadorPersona.identificador);
  if (!subastador) {
    subastador = await Subastadores.create({
      identificador: rematadorPersona.identificador,
      matricula: "MAT-0001",
      region: "CABA",
    });
  }
  console.log(`  · rematador (id=${subastador.identificador})`);

  // 7. Persona + Dueño (propietario de los productos)
  let duenioPersona = await Personas.findOne({ documento: "DUENIO-1" });
  if (!duenioPersona) {
    duenioPersona = await Personas.create({
      documento: "DUENIO-1",
      nombre: "Don Carlos Vendedor",
      direccion: "Recoleta 123",
      estado: "activo",
    });
  }
  let duenio = await Duenios.findById(duenioPersona.identificador);
  if (!duenio) {
    duenio = await Duenios.create({
      identificador: duenioPersona.identificador,
      numero_pais: arg.row.numero,
      verificacion_financiera: "si",
      verificacion_judicial: "si",
      calificacion_riesgo: 1,
      verificador: admin.row.identificador,
    });
  }
  console.log(`  · duenio (id=${duenio.identificador})`);

  // 8. Subasta abierta + extensión
  // DB CHECK: estado IN ('abierta','cerrada'); fecha debe ser bien futura (~2+ semanas)
  const fechaFutura = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  let subasta = await Subastas.findOne({ ubicacion: "Salón Principal — TEST" });
  if (!subasta) {
    subasta = await Subastas.create({
      fecha: fechaFutura,
      hora: "19:00:00",
      estado: "abierta",
      subastador: subastador.identificador,
      ubicacion: "Salón Principal — TEST",
      capacidad_asistentes: 50,
      tiene_deposito: "si",
      seguridad_propia: "si",
      categoria: "comun",
    });
    await SubastasExtension.create({
      subasta: subasta.identificador,
      moneda: "ARS",
      es_coleccion: "no",
      nombre_coleccion: null,
    });
    console.log(`  + subasta abierta (id=${subasta.identificador})`);
  } else {
    if (subasta.estado !== "abierta") {
      await Subastas.update(subasta.identificador, { estado: "abierta" });
    }
    console.log(`  · subasta test ya existe (id=${subasta.identificador})`);
  }

  // 9. Catálogo
  let catalogo = await Catalogos.findOne({ subasta: subasta.identificador });
  if (!catalogo) {
    catalogo = await Catalogos.create({
      descripcion: "Catálogo TEST",
      subasta: subasta.identificador,
      responsable: admin.row.identificador,
    });
    console.log(`  + catalogo (id=${catalogo.identificador})`);
  } else {
    console.log(`  · catalogo ya existe (id=${catalogo.identificador})`);
  }

  // 10. 3 productos + items_catalogo (uno "en_subasta", dos "pendiente")
  const productosBase = [
    { descripcion: "Cuadro al óleo — Naturaleza", precioBase: 10000, estado: "en_subasta" },
    { descripcion: "Reloj de péndulo siglo XIX", precioBase: 25000, estado: "pendiente" },
    { descripcion: "Vajilla de plata 12 piezas", precioBase: 8000, estado: "pendiente" },
  ];
  const { data: existingItems } = await supabase
    .from("items_catalogo")
    .select("*")
    .eq("catalogo", catalogo.identificador);
  if ((existingItems || []).length === 0) {
    for (const p of productosBase) {
      const prod = await Productos.create({
        fecha: new Date().toISOString().slice(0, 10),
        disponible: "si",
        descripcion_catalogo: p.descripcion.slice(0, 60),
        descripcion_completa: p.descripcion,
        revisor: admin.row.identificador,
        duenio: duenio.identificador,
      });
      await ProductosExtension.create({
        producto: prod.identificador,
        es_obra_de_arte: p.descripcion.includes("óleo") ? "si" : "no",
        cantidad_elementos: 1,
      });
      const item = await ItemsCatalogo.create({
        catalogo: catalogo.identificador,
        producto: prod.identificador,
        precio_base: p.precioBase,
        comision: p.precioBase * 0.1,
        subastado: "no",
      });
      await ItemsCatalogoEstado.create({
        item: item.identificador,
        estado: p.estado,
        mejor_oferta: null,
      });
      console.log(`  + item ${p.descripcion.slice(0, 35)} (id=${item.identificador}, estado=${p.estado})`);
    }
  } else {
    console.log(`  · items_catalogo ya cargados (${existingItems.length} items)`);
  }

  console.log("\n✅ Seed completo.\n");
  console.log("Credenciales de prueba:");
  console.log(`  email:    ${TEST_EMAIL}`);
  console.log(`  password: ${TEST_PASSWORD}`);
  console.log(`\nSubasta EN VIVO: id=${subasta.identificador}`);
  console.log("\nAgregá esto al .env para que /registro/etapa1 funcione:");
  console.log(`  ADMIN_EMPLEADO_ID=${admin.row.identificador}`);

  process.exit(0);
})().catch((err) => {
  console.error("Seed error:", err.message || err);
  process.exit(1);
});
