
const express = require("express");const express =const cors = require("cors");
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


// ✅ ✅ LEADERBOARD (get_leaderboard equivalent)
app.get("/profile", async (req, res) => {
  try {
    console.log("📊 Fetching leaderboard");

    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        p.user_id,
        p.display_name,
        p.username,

        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) AS wool_points,
        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS tree_points,

        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) +
        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS total_points

      FROM profiles p
      LEFT JOIN user_state us 
        ON TRY_CAST(p.user_id AS UNIQUEIDENTIFIER) = us.user_id

      ORDER BY total_points DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ ✅ GET PUBLIC PROFILE (single user)
app.get("/profile/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT 
          p.user_id,
          p.display_name,
          p.username,

          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) AS wool_points,
          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS tree_points,

          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) +
          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS total_points

        FROM profiles p

        LEFT JOIN user_state us 
          ON TRY_CAST(p.user_id AS UNIQUEIDENTIFIER) = us.user_id

        WHERE p.user_id = @user_id
      `);

    res.json(result.recordset[0]);

  } catch (err) {
    console.error("❌ Public profile error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ ✅ UPDATE POINTS (core game logic)
app.post("/update-points", async (req, res) => {
  try {
    const { user_id, woolDelta, treeDelta } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("wool", woolDelta || 0)
      .input("tree", treeDelta || 0)
      .query(`
        UPDATE user_state
        SET data = JSON_MODIFY(
          JSON_MODIFY(
            ISNULL(data, '{}'),
            '$.woolPoints',
            COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolPoints') AS INT), 0) + @wool
          ),
          '$.treePoints',
          COALESCE(TRY_CAST(JSON_VALUE(data, '$.treePoints') AS INT), 0) + @tree
        )
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Update points error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ ✅ CREATE USER (handle_new_user equivalent)
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name } = req.body;
    const pool = await getPool();

    // Insert into profiles
    await pool.request()
      .input("user_id", user_id)
      .input("display_name", display_name)
      .query(`
        INSERT INTO profiles (user_id, display_name)
        VALUES (@user_id, @display_name)
      `);

    // Insert into user_state
    await pool.request()
      .input("user_id", user_id)
      .query(`
        INSERT INTO user_state (user_id, data)
        VALUES (
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
          '{"woolPoints":0,"treePoints":0}'
        )
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Create user error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ SAVE PROFILE (existing)
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


// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
