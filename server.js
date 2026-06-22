
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
  res.send("API working ✅");
});

// ✅ ✅ LEADERBOARD (lifetime only)
app.get("/profile", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        p.user_id,
        p.display_name,
        p.username,

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
    res.status(500).json({ error: err.message });
  }
});

// ✅ SINGLE PROFILE
app.get("/profile/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT TOP 1
          p.user_id,
          p.display_name,

          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolPoints') AS INT), 0) AS wool_points,
          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.treePoints') AS INT), 0) AS tree_points,
          COALESCE(TRY_CAST(JSON_VALUE(us.data, '$.woolSpent') AS INT), 0) AS wool_spent

        FROM profiles p
        LEFT JOIN user_state us 
          ON TRY_CAST(p.user_id AS UNIQUEIDENTIFIER) = us.user_id

        WHERE p.user_id = @user_id
      `);

    res.json(result.recordset[0] || {});

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ ✅ EARN POINTS (never subtract)
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
    res.status(500).json({ error: err.message });
  }
});

// ✅ ✅ SPEND POINTS (NEW)
app.post("/spend-points", async (req, res) => {
  try {
    const { user_id, woolSpent } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("spent", woolSpent || 0)
      .query(`
        UPDATE user_state
        SET data = JSON_MODIFY(
          ISNULL(data, '{}'),
          '$.woolSpent',
          COALESCE(TRY_CAST(JSON_VALUE(data, '$.woolSpent') AS INT), 0) + @spent
        )
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ CREATE USER (fix Simon properly)
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("display_name", display_name)
      .query(`
        INSERT INTO profiles (user_id, display_name)
        VALUES (@user_id, @display_name)
      `);

    await pool.request()
      .input("user_id", user_id)
      .query(`
        INSERT INTO user_state (user_id, data)
        VALUES (
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
          '{"woolPoints":0,"treePoints":0,"woolSpent":0}'
        )
      `);

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running");
});
