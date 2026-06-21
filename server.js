
const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// =======================
// SQL CONFIG
// =======================
const config = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DB,
  options: {
    encrypt: true
  }
};

// =======================
// SINGLE GLOBAL POOL
// =======================
let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log("✅ Connected to SQL");
  }
  return pool;
}

// =======================
// ROUTES
// =======================

// ✅ Health check
app.get("/", (req, res) => {
  res.send("API working ✅");
});

// ✅ ✅ LEADERBOARD (wallet-based, matches real DB)
app.get("/profile", async (req, res) => {
  try {
    console.log("📊 Fetching leaderboard");

    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        p.user_id,
        p.display_name,
        p.username,

        ISNULL(uw.wool_points, 0) AS wool_points,
        ISNULL(uw.tree_points, 0) AS tree_points,

        ISNULL(uw.wool_points, 0) + ISNULL(uw.tree_points, 0) AS total_points

      FROM profiles p

      LEFT JOIN user_wallet uw 
        ON p.user_id = uw.user_id

      ORDER BY total_points DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ SAVE PROFILE
app.post("/profile", async (req, res) => {
  try {
    const { user_id, display_name, username, account_type } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.VarChar, user_id)
      .input("display_name", sql.VarChar, display_name)
      .input("username", sql.VarChar, username)
      .input("account_type", sql.VarChar, account_type || "resident")
      .query(`
        MERGE profiles AS target
        USING (SELECT @user_id AS user_id) AS source
        ON target.user_id = source.user_id
        WHEN MATCHED THEN
          UPDATE SET
            display_name = @display_name,
            username = @username,
            account_type = @account_type
        WHEN NOT MATCHED THEN
          INSERT (user_id, display_name, username, account_type)
          VALUES (@user_id, @display_name, @username, @account_type);
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Save error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ OPTIONAL: rebuild legacy wool points (safe to keep)
app.post("/rebuild-points", async (req, res) => {
  try {
    const pool = await getPool();

    console.log("🔧 Rebuilding woolPoints from stories + kudos...");

    await pool.request().query(`
      UPDATE us
      SET data = JSON_MODIFY(us.data, '$.woolPoints', calc.wool)
      FROM user_state us
      JOIN (
          SELECT 
              p.user_id,
              ISNULL(SUM(st.points_earned), 0)
              + ISNULL(COUNT(sk.id) * 2, 0) AS wool
          FROM profiles p
          LEFT JOIN user_stories st ON p.user_id = st.user_id
          LEFT JOIN story_kudos sk ON st.id = sk.story_id
          GROUP BY p.user_id
      ) calc ON us.user_id = calc.user_id;
    `);

    console.log("✅ Rebuild complete");

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Rebuild error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
