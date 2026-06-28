
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
// ROOT
// =====================================================
app.get("/", (req, res) => {
  res.send("API working");
});

// =====================================================
// PROFILE
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
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// STORIES
// =====================================================

// ✅ GET STORIES (THIS WAS MISSING)
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

// ✅ KUDOS
app.post("/stories/:id/kudos", async (req, res) => {
  try {
    const storyId = req.params.id;
    const { user_id, remove } = req.body;

    const pool = await getPool();

    if (remove) {
      await pool.request()
        .input("story_id", storyId)
        .input("user_id", user_id)
        .query(`
          DELETE FROM story_kudos
          WHERE story_id = @story_id AND user_id = @user_id
        `);
    } else {
      await pool.request()
        .input("story_id", storyId)
        .input("user_id", user_id)
        .query(`
          INSERT INTO story_kudos (story_id, user_id)
          SELECT @story_id, @user_id
          WHERE NOT EXISTS (
            SELECT 1 FROM story_kudos 
            WHERE story_id = @story_id AND user_id = @user_id
          )
        `);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ kudos error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});

