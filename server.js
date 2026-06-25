
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

app.get("/", (req, res) => {
  res.send("API working");
});

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

app.post("/update-points", async (req, res) => {
  try {
    const {
      user_id,
      woolDelta = 0,
      treeDelta = 0,
      source
    } = req.body;

    const pool = await getPool();

    let finalWool = woolDelta;
    let finalTree = treeDelta;

    // ✅ HARD RULES

    if (source === "accessory_purchase") {
      finalWool = -Math.abs(woolDelta);
    }

    else if (source === "accessory_refund") {
      finalWool = Math.abs(woolDelta);
    }

    else {
      // ✅ fallback protection (THIS is key)
      if (woolDelta > 0) {
        finalWool = -Math.abs(woolDelta); // assume spend
      }
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

    res.json({
      success: true,
      applied: { wool: finalWool }
    });

  } catch (err) {
    console.error("error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port " + PORT);
});
