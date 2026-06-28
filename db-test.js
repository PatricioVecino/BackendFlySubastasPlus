require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

(async () => {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("Connected. Now():", res.rows[0]);
  } catch (err) {
    console.error("Connection error:", err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
