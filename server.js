const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const { v4: uuidv4 } = require("uuid"); // ✅ required

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
    res.status(500).json({ error: err.message });
  }
});

app.post("/stories", async (req, res) => {
  try {
    const {
      user_id,
      title,
      content,
      run_type,
      points_earned,
      image_url = null
    } = req.body;

    const pool = await getPool();

    const id = uuidv4(); // ✅ THIS FIXES YOUR ERROR

    await pool.request()
      .input("id", id)
      .input("user_id", user_id)
      .input("title", title)
      .input("content", content)
      .input("run_type", run_type)
      .input("points", points_earned)
      .input("image_url", image_url)
      .query(`
        INSERT INTO user_stories (
          id,
          user_id,
          title,
          content,
          run_type,
          points_earned,
          image_url,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @user_id,
          @title,
          @content,
          @run_type,
          @points,
          @image_url,
          GETDATE(),
          GETDATE()
        )
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /stories error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
``
