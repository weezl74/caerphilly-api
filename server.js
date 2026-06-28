
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

// ✅ ROOT
app.get("/", (req, res) => {
  res.send("API working");
});


// =====================================================
// ✅ USERS + LEADERBOARD
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
    res.status(500).json({ error: err.message });
  }
});


app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name = "User" } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("display_name", display_name)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = @user_id)
        BEGIN
          INSERT INTO profiles (user_id, display_name)
          VALUES (@user_id, @display_name)
        END
      `);

    await pool.request()
      .input("user_id", user_id)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM user_state WHERE user_id = @user_id)
        BEGIN
          INSERT INTO user_state (user_id, data)
          VALUES (@user_id, '{"woolPoints":0,"treePoints":0}')
        END
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ create-user error:", err);
    res.status(500).json({ error: err.message });
  }
});


// =====================================================
// ✅ POINTS
// =====================================================

app.post("/update-points", async (req, res) => {
  try {
    const { user_id, woolDelta = 0, source = "" } = req.body;
    const pool = await getPool();

    let finalWool = woolDelta;

    if (source.includes("purchase")) finalWool = -Math.abs(woolDelta);
    if (source.includes("refund")) finalWool = Math.abs(woolDelta);

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

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/spend-points", async (req, res) => {
  try {
    const { user_id, woolDelta = 0, reason = "" } = req.body;

    let source = reason.includes("refund")
      ? "accessory_refund"
      : "accessory_purchase";

    const fakeReq = {
      body: { user_id, woolDelta, source }
    };

    return app._router.handle(fakeReq, res, () => {}, "/update-points", "post");

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================================================
// ✅ STORIES (FULL MIGRATION)
// =====================================================

// ✅ GET stories
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
        s.image_url,
        s.created_at,
        s.user_id,
        p.display_name,
        COUNT(k.user_id) AS kudos_count
      FROM stories s
      LEFT JOIN profiles p ON p.user_id = s.user_id
      LEFT JOIN story_kudos k ON k.story_id = s.id
      GROUP BY s.id, s.title, s.content, s.run_type, s.points_earned, s.image_url, s.created_at, s.user_id, p.display_name
      ORDER BY s.created_at DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ /stories error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ POST story
app.post("/stories", async (req, res) => {
  try {
    const {
      user_id,
      title,
      content,
      run_type,
      points_earned,
      image_url
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("title", title)
      .input("content", content)
      .input("run_type", run_type)
      .input("points", points_earned)
      .input("image_url", image_url)
      .query(`
        INSERT INTO stories (user_id, title, content, run_type, points_earned, image_url, created_at)
        VALUES (@user_id, @title, @content, @run_type, @points, @image_url, GETDATE())
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ create story error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ TOGGLE KUDOS
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
            SELECT 1 FROM story_kudos WHERE story_id = @story_id AND user_id = @user_id
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
``
