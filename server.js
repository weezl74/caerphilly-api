
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
// SQL CONFIG
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
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT *
        FROM profiles
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("❌ GET /profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/profile/update", async (req, res) => {
  try {
    const { user_id, updates } = req.body;
    const pool = await getPool();

    const fields = Object.keys(updates);
    const setClause = fields.map(f => `${f} = @${f}`).join(", ");

    const request = pool.request().input("user_id", user_id);

    fields.forEach(f => request.input(f, updates[f]));

    await request.query(`
      UPDATE profiles
      SET ${setClause}
      WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
    `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /profile/update error:", err);
    res.status(500).json({ error: err.message });
  }
});
// =====================================================
// CREATE USER (CRITICAL FIX)
// =====================================================
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, email } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("email", email)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM profiles
          WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
        )
        BEGIN
          INSERT INTO profiles (user_id, email, total_points)
          VALUES (
            TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
            @email,
            0
          )
        END
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /create-user error:", err);
    res.status(500).json({ error: err.message });
  }
});
// =====================================================
// RESPONSES
// =====================================================
app.get("/responses", async (req, res) => {
  try {
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT question_id, answer_value, impact_value, category
        FROM user_responses
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ GET /responses error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/responses/save", async (req, res) => {
  try {
    const { user_id, category, responses } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", user_id)
      .input("category", category)
      .query(`
        DELETE FROM user_responses
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
        AND category = @category
      `);

    for (const r of responses) {
      await pool.request()
        .input("id", uuidv4())
        .input("user_id", r.user_id)
        .input("category", r.category)
        .input("question_id", r.question_id)
        .input("answer_value", r.answer_value)
        .input("impact_value", r.impact_value)
        .query(`
          INSERT INTO user_responses (
            id,
            user_id,
            category,
            question_id,
            answer_value,
            impact_value
          )
          VALUES (
            @id,
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
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// PLEDGES
// =====================================================
app.get("/pledges", async (req, res) => {
  try {
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT id, category, action, points_earned
        FROM user_pledges
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ GET /pledges error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/pledges", async (req, res) => {
  try {
    const { user_id, category, action, points_earned } = req.body;
    const pool = await getPool();

    const id = uuidv4();

    await pool.request()
      .input("id", id)
      .input("user_id", user_id)
      .input("category", category)
      .input("action", action)
      .input("points_earned", points_earned)
      .query(`
        INSERT INTO user_pledges (
          id,
          user_id,
          category,
          action,
          points_earned
        )
        VALUES (
          @id,
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
          @category,
          @action,
          @points_earned
        )
      `);

    await pool.request()
      .input("user_id", user_id)
      .input("points", points_earned)
      .query(`
        UPDATE profiles
        SET total_points = ISNULL(total_points, 0) + @points
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /pledges error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// RENEWABLES
// =====================================================
app.get("/renewables", async (req, res) => {
  try {
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", user_id)
      .query(`
        SELECT * FROM user_renewables
        WHERE user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("❌ GET /renewables error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/renewables", async (req, res) => {
  try {
    const { user_id, technology_type, points_cost } = req.body;
    const pool = await getPool();

    const id = uuidv4();

    await pool.request()
      .input("id", id)
      .input("user_id", user_id)
      .input("technology_type", technology_type)
      .input("points_cost", points_cost)
      .query(`
        INSERT INTO user_renewables (
          id,
          user_id,
          technology_type,
          points_cost
        )
        VALUES (
          @id,
          TRY_CAST(@user_id AS UNIQUEIDENTIFIER),
          @technology_type,
          @points_cost
        )
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ POST /renewables error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/renewables", async (req, res) => {
  try {
    const { id, user_id, position_x, position_y } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("id", id)
      .input("user_id", user_id)
      .input("position_x", position_x)
      .input("position_y", position_y)
      .query(`
        UPDATE user_renewables
        SET position_x = @position_x,
            position_y = @position_y
        WHERE id = @id
        AND user_id = TRY_CAST(@user_id AS UNIQUEIDENTIFIER)
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ PATCH /renewables error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
``
