const supabase = require("../supabase-client");
const ItemsCatalogoEstado = require("../models/items_catalogo_estado");

async function piezaEnSubasta(subastaId) {
  const { data: cats } = await supabase
    .from("catalogos")
    .select("identificador")
    .eq("subasta", subastaId);
  const catIds = (cats || []).map((c) => c.identificador);
  if (!catIds.length) return null;
  const { data: items } = await supabase
    .from("items_catalogo")
    .select("*")
    .in("catalogo", catIds);
  for (const item of items || []) {
    const estado = await ItemsCatalogoEstado.findOne({ item: item.identificador });
    if (estado?.estado === "en_subasta") {
      return { item, estado };
    }
  }
  return null;
}

async function cantidadPiezasDeSubasta(subastaId) {
  const { data: cats } = await supabase
    .from("catalogos")
    .select("identificador")
    .eq("subasta", subastaId);
  const ids = (cats || []).map((c) => c.identificador);
  if (!ids.length) return 0;
  const { count } = await supabase
    .from("items_catalogo")
    .select("*", { count: "exact", head: true })
    .in("catalogo", ids);
  return count || 0;
}

// Toma atómica de la puja: actualiza mejor_oferta y expiry solo si la oferta sigue siendo
// la que el postor leyó. Un UPDATE de fila es atómico, así que dos pujas simultáneas se
// serializan y solo una pasa. Devuelve false si otro pujó primero (perdió la carrera).
async function tomarPujaSiVigente(itemId, { mejorOfertaActual, monto, expiryAt }) {
  let q = supabase
    .from("items_catalogo_estado")
    .update({ mejor_oferta: monto, expiry_at: expiryAt })
    .eq("item", itemId);
  q = mejorOfertaActual != null ? q.eq("mejor_oferta", mejorOfertaActual) : q.is("mejor_oferta", null);
  const { data, error } = await q.select();
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function quedanItemsPorSubastar(subastaId) {
  const { data: cats } = await supabase
    .from("catalogos")
    .select("identificador")
    .eq("subasta", subastaId);
  const catIds = (cats || []).map((c) => c.identificador);
  if (!catIds.length) return false;
  const { data: items } = await supabase
    .from("items_catalogo")
    .select("identificador")
    .in("catalogo", catIds);
  for (const item of items || []) {
    const estado = await ItemsCatalogoEstado.findOne({ item: item.identificador });
    if (estado?.estado === "pendiente" || estado?.estado === "en_subasta") return true;
  }
  return false;
}

module.exports = { cantidadPiezasDeSubasta, piezaEnSubasta, quedanItemsPorSubastar, tomarPujaSiVigente };
