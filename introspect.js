require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error("Falta SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

function get(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const r = await get("/rest/v1/");
  if (r.status !== 200) {
    console.error("Status:", r.status, r.body.slice(0, 500));
    process.exit(1);
  }
  const spec = JSON.parse(r.body);
  const tables = {};
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    const cols = {};
    for (const [col, meta] of Object.entries(def.properties || {})) {
      cols[col] = {
        type: meta.type,
        format: meta.format || null,
        max_length: meta.maxLength || null,
        description: meta.description || null,
        default: meta.default !== undefined ? meta.default : null,
      };
    }
    tables[name] = { columns: cols, required: def.required || [] };
  }
  const outPath = path.join(__dirname, "schema-dump.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ generated_at: new Date().toISOString(), tables }, null, 2),
  );
  console.log(`OK → ${outPath}`);
  console.log(`Tablas: ${Object.keys(tables).length}`);
  for (const [name, def] of Object.entries(tables)) {
    console.log(`  ✓ ${name} (${Object.keys(def.columns).length} cols)`);
  }
})();
