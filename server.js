
const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const { v4: uuidv4 } = require("uuid");

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// =====================================================
// ✅ SQL CONFIG
// =====================================================
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

// =====================================================
// ✅ ROOT
// =====================================================
app.get("/", (req, res) => {
  res.send("API working");
});

// =====================================================
// ✅ PROFILE
// =====================================================
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
    console.error("❌ /profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ✅ STORIES
// =====================================================

// ✅ GET STORIES
app.get("/stories", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        s.id,
        s.title,
        s.content,
        s.run_type,
        s.points_earned,
        s.created_at,
        s.user_id,
        p.display_name,
        COUNT(k.user_id) AS kudos_count
      FROM user_stories s
      LEFT JOIN profiles p ON p.user_id = s.user_id
      LEFT JOIN story_kudos k ON k.story_id = s.id
      GROUP BY s.id, s.title, s.content, s.run_type, s.points_earned, s.created_at, s.user_id, p.display_name
      ORDER BY s.created_at DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ /stories error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ CREATE STORY
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
    const id = uuidv4();

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
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
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

// =====================================================
// ✅ RESPONSES (FINAL, STABLE)
// =====================================================

// ✅ GET RESPONSES
app.get("/responses", async (req, res) => {
  try {
    const { user_id, category } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .input("category", category)
      .query(`
        SELECT question_id, answer_value, impact_value
        FROM user_responses
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
        AND category = @category
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ GET /responses error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ SAVE RESPONSES (FINAL FIX – BULLETPROOF)
app.post("/responses/save", async (req, res) => {
  try {
    const { user_id, category, responses } = req.body;
    const pool = await getPool();

    // ✅ DELETE existing first
    await pool.request()
      .input("user_id", user_id)
      .input("category", category)
      .query(`
        DELETE FROM user_responses
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
        AND category = @category
      `);

    // ✅ INSERT each response safely
    for (const r of responses) {
      const request = pool.request();

      request.input("user_id", r.user_id);
      request.input("category", r.category);
      request.input("question_id", r.question_id);
      request.input("answer_value", r.answer_value);
      request.input("impact_value", r.impact_value);

      await request.query(`
        INSERT INTO user_responses (
          user_id,
          category,
          question_id,
          answer_value,
          impact_value
        )
        VALUES (
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
          @category,
          @question_id,
          @answer_value,
          @impact_value
        )
      `);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /responses/save error:", err);
    res.status(500).json({
      error: err.message
    });
  }
});

// =====================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
``
