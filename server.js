
const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();

// ✅ ✅ FIXED CORS (this solves your error)
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
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

// =======================
// ROUTES
// =======================

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
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ ✅ SINGLE PROFILE
app.get("/profile/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT TOP 1
