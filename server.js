
const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// ✅ SQL CONFIG
const config = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DB,
  options: { encrypt: true }
};

let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log("✅ Connected to SQL");
  }
  return pool;
}

// ✅ HEALTH
app.get("/", (req, res) => {
  res.send("API working");
});

// ✅ GET ALL USERS (leaderboard)
app.get("/profile", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        p.user_id,
        p.display_name,
        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) AS wool_points,
        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS tree_points
      FROM profiles p
      LEFT JOIN user_state us 
        ON TRY_CAST(p.user_id AS UNIQUEIDENTIFIER) = us.user_id
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ ✅ GET SINGLE USER (THIS FIXES YOUR 605 ISSUE)
app.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", id)
      .query(`
        SELECT 
          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) AS wool_points,
          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS tree_points
        FROM user_state us
        WHERE us.user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json(result.recordset[0] || {
      wool_points: 0,
      tree_points: 0
    });

  } catch (err) {
    console.error("profile/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE POINTS (SAFE LOGIC)
app.post("/update-points", async (req, res) => {
  try {
    const { user_id, woolDelta = 0, treeDelta = 0, source } = req.body;

    const pool = await getPool();

    let finalWool = woolDelta;
    let finalTree = treeDelta;

    // ✅ FORCE SPEND (accessory + renewable)
    if (source?.includes("purchase")) {
      finalWool = -Math.abs(woolDelta);
    }

    // ✅ FORCE REFUND
    if (source?.includes("refund")) {
      finalWool = Math.abs(woolDelta);
    }

    await pool.request()
      .input("user_id", user_id)
      .input("wool", finalWool)
      .input("tree", finalTree)
      .query(`
        UPDATE user_state
        SET data = JSON_MODIFY(
          JSON_MODIFY(
            ISNULL(data, '{"woolPoints":0,"treePoints":0}'),
            '$.woolPoints',
            COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolPoints') AS INT), 0) + @wool
          ),
          '$.treePoints',
          COALESCE(TRY_CAST(JSON_VALUE(data, '$.treePoints') AS INT), 0) + @tree
        )
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    console.log("✅ Applied:", {
      source,
      wool: finalWool
    });

    res.json({ success: true });

  } catch (err) {
    console.error("update-points error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port " + PORT);
});
