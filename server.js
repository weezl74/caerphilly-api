
const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();

// ✅ CORS setup
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

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
    console.log("Connected to SQL");
  }
  return pool;
}

// ✅ HEALTH
app.get("/", (req, res) => {
  res.send("API working");
});

// ✅ PROFILE (leaderboard-style)
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
      ORDER BY 
        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) DESC,
        COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ CREATE USER
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("display_name", display_name)
      .query(`
        MERGE profiles AS target
        USING (SELECT @user_id AS user_id) AS source
        ON target.user_id = source.user_id
        WHEN NOT MATCHED THEN
          INSERT (user_id, display_name)
          VALUES (@user_id, @display_name);
      `);

    await pool.request()
      .input("user_id", user_id)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM user_state 
          WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
        )
        INSERT INTO user_state (user_id, data)
        VALUES (
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
          '{"woolPoints":0,"treePoints":0,"woolSpent":0}'
        );
      `);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE POINTS (earn points)
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
    console.error("update-points error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ SPEND / REFUND POINTS (THIS WAS MISSING)
app.post("/spend-points", async (req, res) => {
  try {
    const { user_id, woolDelta } = req.body; // ✅ should be NEGATIVE for refunds
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("wool", woolDelta)
      .query(`
        UPDATE user_state
        SET data = JSON_MODIFY(
          ISNULL(data, '{}'),
          '$.woolPoints',
          CASE 
            WHEN COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolPoints') AS INT), 0) + @wool < 0
            THEN 0
            ELSE COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolPoints') AS INT), 0) + @wool
          END
        )
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("spend-points error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("API running on port " + PORT);
});
