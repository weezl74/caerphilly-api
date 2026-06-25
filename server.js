
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

// ✅ SINGLE USER PROFILE
app.get("/profile/:id", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", req.params.id)
      .query(`
        SELECT 
          COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolPoints') AS INT), 0) AS wool_points,
          COALESCE(TRY_CAST(JSON_VALUE(data, '$.treePoints') AS INT), 0) AS tree_points
        FROM user_state
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json(result.recordset[0] || {
      wool_points: 0,
      tree_points: 0
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ MAIN UPDATE ENDPOINT
app.post("/update-points", async (req, res) => {
  try {
    const { user_id, woolDelta = 0, source = "" } = req.body;

    const pool = await getPool();

    let finalWool = woolDelta;

    // ✅ FORCE CORRECT BEHAVIOUR
    if (source.includes("purchase")) {
      finalWool = -Math.abs(woolDelta);
    }

    if (source.includes("refund")) {
      finalWool = Math.abs(woolDelta);
    }

    await pool.request()
      .input("user_id", user_id)
      .input("wool", finalWool)
      .query(`
        UPDATE user_state
        SET data = JSON_MODIFY(
          ISNULL(data, '{"woolPoints":0}'),
          '$.woolPoints',
          COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolPoints') AS INT), 0) + @wool
        )
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    console.log("✅ update applied:", finalWool);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ ✅ CRITICAL FIX — SUPPORT OLD FRONTEND
app.post("/spend-points", async (req, res) => {
  try {
    const { user_id, woolDelta = 0, reason = "" } = req.body;

    // ✅ Convert old calls into new logic
    let source = "accessory_purchase";

    if (reason.includes("refund")) {
      source = "accessory_refund";
    }

    // reuse update endpoint logic
    const fakeReq = {
      body: {
        user_id,
        woolDelta,
        source
      }
    };

    return app._router.handle(fakeReq, res, () => {}, "/update-points", "post");

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
