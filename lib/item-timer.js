const supabase = require("../supabase-client");

// itemId → timeoutId
const timers = new Map();

const GRACIA_MS = 2000; // margen extra para absorber latencia de red

function set(itemId, subastaId, expiryAt, callback) {
  cancel(itemId);
  const delay = Math.max(0, new Date(expiryAt).getTime() - Date.now()) + GRACIA_MS;
  const id = setTimeout(async () => {
    timers.delete(itemId);
    try { await callback(subastaId, itemId); } catch (err) {
      console.error(`[item-timer] Error al cerrar ítem ${itemId}:`, err.message || err);
    }
  }, delay);
  timers.set(itemId, id);
}

function cancel(itemId) {
  const id = timers.get(itemId);
  if (id !== undefined) {
    clearTimeout(id);
    timers.delete(itemId);
  }
}

// Al arrancar el servidor: reactiva timers de ítems que quedaron en_subasta
async function recuperarTimers(callback) {
  try {
    const { data, error } = await supabase
      .from("items_catalogo_estado")
      .select("item, expiry_at")
      .eq("estado", "en_subasta")
      .not("expiry_at", "is", null);

    if (error) throw error;
    if (!data || data.length === 0) return;

    const { data: items } = await supabase
      .from("items_catalogo")
      .select("identificador, catalogo");
    const { data: catalogos } = await supabase
      .from("catalogos")
      .select("identificador, subasta");

    const catalogoMap = {};
    for (const c of catalogos || []) catalogoMap[c.identificador] = c.subasta;
    const itemMap = {};
    for (const i of items || []) itemMap[i.identificador] = catalogoMap[i.catalogo];

    for (const row of data) {
      const subastaId = itemMap[row.item];
      if (!subastaId) continue;
      // Si ya expiró, dispara de inmediato con un pequeño delay para que el servidor termine de arrancar
      const delay = Math.max(2000, new Date(row.expiry_at).getTime() - Date.now() + GRACIA_MS);
      const id = setTimeout(async () => {
        timers.delete(row.item);
        try { await callback(subastaId, row.item); } catch (err) {
          console.error(`[item-timer] Error al cerrar ítem ${row.item}:`, err.message || err);
        }
      }, delay);
      timers.set(row.item, id);
      console.log(`[item-timer] Timer recuperado para ítem ${row.item} (subasta ${subastaId}), expira en ${Math.round(delay / 1000)}s`);
    }
  } catch (err) {
    console.error("[item-timer] Error al recuperar timers:", err.message);
  }
}

module.exports = { set, cancel, recuperarTimers };
