const supabase = require("../supabase-client");

function createModel({ table, pk = "identificador" }) {
  return {
    table,
    pk,

    async findAll() {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      return data;
    },

    async findById(id) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq(pk, id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async findOne(where) {
      let q = supabase.from(table).select("*");
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data;
    },

    async nextId() {
      const { data, error } = await supabase
        .from(table)
        .select(pk)
        .order(pk, { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.[pk] || 0) + 1;
    },

    async create(data, { returning = '*' } = {}) {
      const tryInsert = async (payload) =>
        supabase.from(table).insert(payload).select(returning).single();

      let { data: row, error } = await tryInsert(data);
      // Fallback para tablas sin SERIAL: si el pk vino null, computamos y reintentamos.
      // No aplica cuando el pk es GENERATED ALWAYS (la DB ya lo genera sola).
      if (
        error &&
        data[pk] === undefined &&
        /null value in column "?[^"]+"? of relation/.test(error.message) &&
        error.code !== '428C9'
      ) {
        const id = await this.nextId();
        ({ data: row, error } = await tryInsert({ ...data, [pk]: id }));
      }
      if (error) throw error;
      return row;
    },

    async update(id, data) {
      const { data: rows, error } = await supabase
        .from(table)
        .update(data)
        .eq(pk, id)
        .select()
        .single();
      if (error) throw error;
      return rows;
    },

    async count(where = {}) {
      let q = supabase.from(table).select("*", { count: "exact", head: true });
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },
  };
}

module.exports = { createModel };
