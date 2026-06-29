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
// DB CONNECTION
// ==============================
let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// ==============================
// PROFILE
// ==============================
app.get("/profile", async (req, res) => {
  try {
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .query(`
        SELECT user_id, display_name, username, wool_points, tree_points
        FROM dbo.profiles
        WHERE user_id = @user_id
      `);

    res.json(result.recordset[0] || null);
  } catch (err) {
    console.error("profile error:", err);
    res.status(500).json({ error: "profile failed" });
  }
});

// ==============================
// LEADERBOARD
// ==============================
app.get("/leaderboard", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        user_id,
        COALESCE(display_name, username, 'Member') AS display_name,
        wool_points,
        tree_points,
        ISNULL(wool_points,0) + ISNULL(tree_points,0) AS total_points
      FROM dbo.profiles
      ORDER BY total_points DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("leaderboard error:", err);
    res.status(500).json({ error: "leaderboard failed" });
  }
});

// ==============================
// STORIES (MINIMAL + SAFE)
// ==============================
app.get("/stories", async (req, res) => {
  try {
    const pool = await getPool();

    // ✅ START VERY SIMPLE (no joins yet)
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
// SERVER
// ==============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
