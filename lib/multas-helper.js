const supabase = require("../supabase-client");

async function _registroIdsDelCliente(clienteId) {
  const { data } = await supabase
    .from("registro_de_subasta")
    .select("identificador")
    .eq("cliente", clienteId);
  return (data || []).map((r) => r.identificador);
}

async function tieneMultaActiva(clienteId) {
  const regIds = await _registroIdsDelCliente(clienteId);
  if (!regIds.length) return false;
  const { count } = await supabase
    .from("multas")
    .select("*", { count: "exact", head: true })
    .in("registro", regIds)
    .eq("estado", "pendiente");
  return (count || 0) > 0;
}

async function multaPendienteData(clienteId) {
  const regIds = await _registroIdsDelCliente(clienteId);
  if (!regIds.length) return null;
  const { data } = await supabase
    .from("multas")
    .select("*")
    .in("registro", regIds)
    .eq("estado", "pendiente")
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function tieneMultaJudicial(clienteId) {
  const regIds = await _registroIdsDelCliente(clienteId);
  if (!regIds.length) return false;
  const { count } = await supabase
    .from("multas")
    .select("*", { count: "exact", head: true })
    .in("registro", regIds)
    .eq("estado", "derivada_justicia");
  return (count || 0) > 0;
}

module.exports = { tieneMultaActiva, multaPendienteData, tieneMultaJudicial };
