require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const WS = require("ws");

const SUPABASE_URL = process.env.SUPABASE_URL;
// El backend usa service_role (bypasea RLS). NUNCA exponer al cliente.
// Fallback a anon si no está configurada (solo lectura de tablas públicas).
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY in environment",
  );
}

const normalizedUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WS;
}

const supabase = createClient(normalizedUrl, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabase;
