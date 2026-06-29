const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// SQL CONFIG
// ==============================
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

// ==============================
// DB CONNECTION (NO top-level await)
// ==============================
let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// ==============================
// TEST ROUTE (to confirm server)
// ==============================
app.get("/", (req, res) => {
  res.send("API running");
});

// ==============================
// STORIES (VERY SIMPLE - SAFE)
// ==============================
app.get("/stories", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(
      "SELECT id, user_id, title, content AS body, created_at FROM dbo.user_stories"
    );

    res.json(result.recordset);

  } catch (err) {
    console.error("stories error:", err);
    res.status(500).json({ error: "stories failed" });
  }
});

// ==============================
// LEADERBOARD
// ==============================
app.get("/leaderboard", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(
      "SELECT user_id, COALESCE(display_name, username, 'Member') AS display_name, wool_points, tree_points FROM dbo.profiles"
    );

    res.json(result.recordset);

  } catch (err) {
    console.error("leaderboard error:", err);
    res.status(500).json({ error: "leaderboard failed" });
  }
});

// ==============================
// SERVER
// ==============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
