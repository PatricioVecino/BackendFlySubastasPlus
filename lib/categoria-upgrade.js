const supabase = require("../supabase-client");
const Clientes = require("../models/clientes");
const { ORDER, rank } = require("./categoria");

const REGLAS = [
  { categoria: "platino", medios: 4, compras: 10 },
  { categoria: "oro",     medios: 3, compras: 6  },
  { categoria: "plata",   medios: 2, compras: 3  },
  { categoria: "especial",medios: 1, compras: 1  },
];

async function evaluarYActualizarCategoria(clienteId) {
  const cliente = await Clientes.findById(clienteId);
  if (!cliente) return;

  const { data: medios } = await supabase
    .from("medios_pago")
    .select("tipo")
    .eq("cliente", clienteId)
    .eq("verificado", "si");

  const tiposDistintos = new Set((medios || []).map((m) => m.tipo)).size;

  const { count: comprasPagadas } = await supabase
    .from("registro_subasta_extension")
    .select("registro", { count: "exact", head: true })
    .eq("estado_pago", "pagada")
    .in(
      "registro",
      (
        await supabase
          .from("registro_de_subasta")
          .select("identificador")
          .eq("cliente", clienteId)
      ).data?.map((r) => r.identificador) || []
    );

  const cantCompras = comprasPagadas || 0;

  let nuevaCategoria = "comun";
  for (const regla of REGLAS) {
    if (tiposDistintos >= regla.medios && cantCompras >= regla.compras) {
      nuevaCategoria = regla.categoria;
      break;
    }
  }

  if (rank(nuevaCategoria) > rank(cliente.categoria)) {
    await Clientes.update(clienteId, { categoria: nuevaCategoria });
  }
}

module.exports = { evaluarYActualizarCategoria };
