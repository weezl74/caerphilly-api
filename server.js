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
    trustServerCertificate: false
  }
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
// ROOT (health check)
// ==============================
app.get("/", (req, res) => {
  res.send("API running");
});

// ==============================
// CREATE USER
// ==============================
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .input("display_name", sql.NVarChar(255), display_name || "Member")
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.profiles WHERE user_id = @user_id
        )
        INSERT INTO dbo.profiles (user_id, display_name, wool_points, tree_points)
        VALUES (@user_id, @display_name, 0, 0)
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("create-user error:", err);
    res.status(500).json({ error: "create-user failed" });
  }
});

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
// STORIES (WITH NAMES)
// ==============================
app.get("/stories", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        s.id,
        s.user_id,
        COALESCE(p.display_name, 'Member') AS display_name,
        s.title,
        s.content AS body,
        s.created_at
      FROM dbo.user_stories s
      LEFT JOIN dbo.profiles p
        ON TRY_CONVERT(uniqueidentifier, p.user_id) = s.user_id
      ORDER BY s.created_at DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("stories error:", err);
    res.status(500).json({ error: "stories failed" });
  }
});
// ==============================
// KUDOS (READ)
// ==============================
app.get("/kudos", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT story_id, COUNT(*) AS kudos_count
      FROM dbo.story_kudos
      GROUP BY story_id
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("kudos error:", err);
    res.status(500).json({ error: "kudos fetch failed" });
  }
});
``
// ==============================
// SERVER
// ==============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
