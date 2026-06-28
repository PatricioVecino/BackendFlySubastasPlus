const supabase = require("./supabase-client");

async function test() {
  try {
    // Replace 'auctions' with a table that exists in your project
    const { data, error } = await supabase
      .from("paises")
      .select("*")
      .limit(5);
    if (error) throw error;
    console.log("Rows:", data);
  } catch (err) {
    console.error("Supabase query error:", err.message || err);
    process.exitCode = 1;
  }
}

test();
