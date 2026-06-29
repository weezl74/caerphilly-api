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
// CREATE USER (ROBUST + BACKWARD COMPATIBLE)
// =====================================================
app.post("/create-user", async (req, res) => {
  try {
    const user_id = req.body.user_id;
    const display_name =
      typeof req.body.display_name === "string"
        ? req.body.display_name
        : null;

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("display_name", sql.NVarChar(255), display_name)
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
    console.error("❌ create-user error:", err);
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
    console.error("❌ profile fetch error:", err);
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

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const fields = Object.keys(updates);
    if (!fields.length) {
      return res.json({ success: true });
    }

    const setClause = fields.map(f => `[${f}] = @${f}`).join(", ");
    const request = pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id);

    fields.forEach(f => request.input(f, updates[f]));

    await request.query(`
      UPDATE profiles
      SET ${setClause}
      WHERE user_id = @user_id
    `);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ profile update error:", err);
    res.status(500).json({ error: "profile update failed" });
  }
});

// =====================================================
// PLEDGES / POINTS
// =====================================================
app.post("/pledges", async (req, res
