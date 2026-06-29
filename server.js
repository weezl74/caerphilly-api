const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// SQL CONFIG (AZURE SQL)
// =====================================================
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

let pool;
async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// =====================================================
// CREATE USER (FIXED: STORES DISPLAY NAME)
// =====================================================
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("display_name", sql.NVarChar, display_name || null)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM profiles
          WHERE user_id = @user_id
        )
        BEGIN
          INSERT INTO profiles (
            user_id,
            display_name,
            wool_points,
            tree_points
          )
          VALUES (
            @user_id,
            @display_name,
            0,
            0
          )
        END
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("create-user error", err);
    res.status(500).json({ error: "create-user failed" });
  }
});

// =====================================================
// PROFILE
// =====================================================
app.get("/profile", async (req, res) => {
  try {
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT
          user_id,
          display_name,
          username,
          account_type,
          wool_points,
          tree_points
        FROM profiles
        WHERE user_id = @user_id
      `);

    res.json(result.recordset[0] || null);
  } catch (err) {
    console.error("profile fetch error", err);
    res.status(500).json({ error: "profile fetch failed" });
  }
});

// =====================================================
// PROFILE UPDATE
// =====================================================
app.post("/profile/update", async (req, res) => {
  try {
    const { user_id, ...updates } = req.body;
    const pool = await getPool();

    const fields = Object.keys(updates);
    if (!fields.length) return res.json({ success: true });

    const setClause = fields.map(f => `[${f}] = @${f}`).join(", ");
    const request = pool.request().input("user_id", sql.UniqueIdentifier, user_id);

    fields.forEach(f => request.input(f, updates[f]));

    await request.query(`
      UPDATE profiles
      SET ${setClause}
      WHERE user_id = @user_id
    `);

    res.json({ success: true });
  } catch (err) {
    console.error("profile update error", err);
    res.status(500).json({ error: "profile update failed" });
  }
});

// =====================================================
// PLEDGES
// =====================================================
app.post("/pledges", async (req, res) => {
  try {
    const { user_id, points } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("points", sql.Int, points)
      .query(`
        UPDATE profiles
        SET wool_points = wool_points + @points
        WHERE user_id = @user_id
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("pledges error", err);
    res.status(500).json({ error: "pledges failed" });
  }
});

// =====================================================
// RESPONSES
// =====================================================
app.post("/responses", async (req, res) => {
  try {
    const { user_id, responses } = req.body;
    const pool = await getPool();

    for (const r of responses) {
      await pool.request()
        .input("user_id", sql.UniqueIdentifier, user_id)
        .input("question_id", sql.NVarChar, r.question_id)
        .input("value", sql.Int, r.value)
        .query(`
          INSERT INTO responses (user_id, question_id, value)
          VALUES (@user_id, @question_id, @value)
        `);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("responses error", err);
    res.status(500).json({ error: "responses failed" });
  }
});

// =====================================================
// SPRINTS
// =====================================================
app.get("/sprints", async (req, res) => {
  try {
    const { user_id } = req.query;
    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT sprint_key, data
        FROM user_sprints
        WHERE user_id = @user_id
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("sprints fetch error", err);
    res.status(500).json({ error: "sprints fetch failed" });
  }
});

app.post("/sprints/save", async (req, res) => {
  try {
    const { user_id, sprint_key, data } = req.body;
    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("sprint_key", sql.NVarChar, sprint_key)
      .input("data", sql.NVarChar, JSON.stringify(data))
      .query(`
        IF EXISTS (
          SELECT 1 FROM user_sprints
          WHERE user_id = @user_id AND sprint_key = @sprint_key
        )
          UPDATE user_sprints
          SET data = @data, updated_at = GETDATE()
          WHERE user_id = @user_id AND sprint_key = @sprint_key
        ELSE
          INSERT INTO user_sprints (user_id, sprint_key, data, created_at, updated_at)
          VALUES (@user_id, @sprint_key, @data, GETDATE(), GETDATE())
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("sprints save error", err);
    res.status(500).json({ error: "sprints save failed" });
  }
});

// =====================================================
// SERVER
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});
``
