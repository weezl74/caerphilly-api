const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// SQL CONFIG
// ==============================
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// ==============================
// DB CONNECTION
// ==============================
let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// ==============================
// ROOT (health check)
// ==============================
app.get("/", (req, res) => {
  res.send("API running");
});

// ==============================
// CREATE USER
// ==============================
app.post("/create-user", async (req, res) => {
  try {
    const { user_id, display_name } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .input("display_name", sql.NVarChar(255), display_name || "Member")
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.profiles WHERE user_id = @user_id
        )
        INSERT INTO dbo.profiles (user_id, display_name, wool_points, tree_points)
        VALUES (@user_id, @display_name, 0, 0)
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("create-user error:", err);
    res.status(500).json({ error: "create-user failed" });
  }
});

// ==============================
// PROFILE
// ==============================
app.get("/profile", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .query(`
        SELECT user_id, display_name, username, wool_points, tree_points
        FROM dbo.profiles
        WHERE user_id = @user_id
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("profile error:", err);
    res.status(500).json({ error: "profile failed" });
  }
});

// ==============================
// LEADERBOARD
// ==============================
app.get("/leaderboard", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        user_id,
        COALESCE(display_name, username, 'Member') AS display_name,
        wool_points,
        tree_points,
        ISNULL(wool_points,0) + ISNULL(tree_points,0) AS total_points
      FROM dbo.profiles
      ORDER BY total_points DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("leaderboard error:", err);
    res.status(500).json({ error: "leaderboard failed" });
  }
});

// ==============================
// STORIES (WITH NAMES)
// ==============================
app.get("/stories", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        s.id,
        s.user_id,
        COALESCE(p.display_name, 'Member') AS display_name,
        s.title,
        s.content AS body,
        s.created_at
      FROM dbo.user_stories s
      LEFT JOIN dbo.profiles p
        ON TRY_CONVERT(uniqueidentifier, p.user_id) = s.user_id
      ORDER BY s.created_at DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("stories error:", err);
    res.status(500).json({ error: "stories failed" });
  }
});
// ==============================
// KUDOS (READ)
// ==============================
app.get("/kudos", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT story_id, COUNT(*) AS kudos_count
      FROM dbo.story_kudos
      GROUP BY story_id
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("kudos error:", err);
    res.status(500).json({ error: "kudos fetch failed" });
  }
});
// ==============================
// RESPONSES
// ==============================
app.get("/responses", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .query(`
        SELECT *
        FROM dbo.user_responses
        WHERE user_id = @user_id
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("responses error:", err);
    res.status(500).json({ error: "responses failed" });
  }
});

// ==============================
// SAVE RESPONSES
// ==============================
app.post("/save", async (req, res) => {
  try {
    const { user_id, responses } = req.body;

    if (!user_id || !responses) {
      return res.status(400).json({ error: "Missing data" });
    }

    const pool = await getPool();

    for (const r of responses) {
      await pool.request()
        .input("user_id", sql.NVarChar, user_id)
        .input("category", sql.NVarChar(50), r.category)
        .input("question_id", sql.NVarChar(100), r.question_id)
        .input("answer_value", sql.NVarChar(255), r.answer_value)
        .input("impact_value", sql.Int, r.impact_value || 0)
        .query(`
          MERGE dbo.user_responses AS target
          USING (
            SELECT
              @user_id AS user_id,
              @question_id AS question_id
          ) AS source
          ON target.user_id = source.user_id
          AND target.question_id = source.question_id

          WHEN MATCHED THEN
            UPDATE SET
              answer_value = @answer_value,
              impact_value = @impact_value,
              updated_at = GETDATE()

          WHEN NOT MATCHED THEN
            INSERT (
              user_id,
              category,
              question_id,
              answer_value,
              impact_value,
              created_at,
              updated_at
            )
            VALUES (
              @user_id,
              @category,
              @question_id,
              @answer_value,
              @impact_value,
              GETDATE(),
              GETDATE()
            );
        `);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("save error:", err);
    res.status(500).json({ error: "save failed" });
  }
});

// ==============================
// PROFILE UPDATE
// ==============================
app.post("/profile/update", async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .query(`
        SELECT ISNULL(SUM(impact_value), 0) AS total_impact
        FROM dbo.user_responses
        WHERE user_id = @user_id
      `);

    const totalImpact =
      result.recordset[0]?.total_impact || 0;

    await pool.request()
      .input("user_id", sql.NVarChar, user_id)
      .input("points", sql.Int, totalImpact)
      .query(`
        UPDATE dbo.profiles
        SET wool_points = @points
        WHERE user_id = @user_id
      `);

    res.json({
      success: true,
      totalImpact
    });

  } catch (err) {
    console.error("profile update error:", err);
    res.status(500).json({
      error: "profile update failed"
    });
  }
});
// ==============================
// WALLET - GET
// ==============================
app.get("/wallet", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT business_id, data
        FROM dbo.user_wallet
        WHERE user_id = @user_id
        ORDER BY created_at DESC
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("wallet get error:", err);
    res.status(500).json({ error: "wallet fetch failed" });
  }
});

// ==============================
// WALLET - POST (UPSERT)
// ==============================
app.post("/wallet", async (req, res) => {
  try {
    const { user_id, business_id, data } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("business_id", sql.NVarChar(255), business_id)
      .input("data", sql.NVarChar(sql.MAX), JSON.stringify(data))
      .query(`
        MERGE dbo.user_wallet AS target
        USING (
          SELECT
            @user_id AS user_id,
            @business_id AS business_id
        ) AS source
        ON target.user_id = source.user_id
        AND target.business_id = source.business_id

        WHEN MATCHED THEN
          UPDATE SET
            data = @data,
            updated_at = GETDATE()

        WHEN NOT MATCHED THEN
          INSERT (
            id,
            user_id,
            business_id,
            data,
            created_at,
            updated_at
          )
          VALUES (
            NEWID(),
            @user_id,
            @business_id,
            @data,
            GETDATE(),
            GETDATE()
          );
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("wallet save error:", err);
    res.status(500).json({ error: "wallet save failed" });
  }
});

// ==============================
// WALLET - DELETE
// ==============================
app.delete("/wallet", async (req, res) => {
  try {
    const { user_id, business_id } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("business_id", sql.NVarChar(255), business_id)
      .query(`
        DELETE FROM dbo.user_wallet
        WHERE user_id = @user_id
        AND business_id = @business_id
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("wallet delete error:", err);
    res.status(500).json({ error: "wallet delete failed" });
  }
});

// ==============================
// PREFERENCES - GET
// ==============================
app.get("/preferences", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT *
        FROM dbo.user_preferences
        WHERE user_id = @user_id
      `);

    const row = result.recordset[0];

    if (!row) {
      return res.json(null);
    }

    res.json({
      sheep_head: row.sheep_head,
      learning_preferences: row.learning_preferences
        ? JSON.parse(row.learning_preferences)
        : null
    });

  } catch (err) {
    console.error("preferences get error:", err);
    res.status(500).json({ error: "preferences fetch failed" });
  }
});

// ==============================
// PREFERENCES - POST UPSERT
// ==============================
app.post("/preferences", async (req, res) => {
  try {
    const {
      user_id,
      sheep_head,
      learning_preferences
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("sheep_head", sql.NVarChar(50), sheep_head)
      .input(
        "learning_preferences",
        sql.NVarChar(sql.MAX),
        JSON.stringify(learning_preferences || {})
      )
      .query(`
        MERGE dbo.user_preferences AS target
        USING (
          SELECT @user_id AS user_id
        ) AS source
        ON target.user_id = source.user_id

        WHEN MATCHED THEN
          UPDATE SET
            sheep_head = @sheep_head,
            learning_preferences = @learning_preferences,
            updated_at = GETDATE()

        WHEN NOT MATCHED THEN
          INSERT (
            user_id,
            sheep_head,
            learning_preferences,
            created_at,
            updated_at
          )
          VALUES (
            @user_id,
            @sheep_head,
            @learning_preferences,
            GETDATE(),
            GETDATE()
          );
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("preferences save error:", err);
    res.status(500).json({ error: "preferences save failed" });
  }
});

// ==============================
// BIN DAY - GET
// ==============================
app.get("/bin-day", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT *
        FROM dbo.user_bin_day
        WHERE user_id = @user_id
      `);

    const row = result.recordset[0];

    if (!row) {
      return res.json(null);
    }

    res.json({
      data: row.data ? JSON.parse(row.data) : {},
      dismissed: row.dismissed
    });

  } catch (err) {
    console.error("bin day get error:", err);
    res.status(500).json({ error: "bin day fetch failed" });
  }
});

// ==============================
// BIN DAY - POST UPSERT
// ==============================
app.post("/bin-day", async (req, res) => {
  try {
    const {
      user_id,
      data,
      dismissed
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("data", sql.NVarChar(sql.MAX), JSON.stringify(data || {}))
      .input("dismissed", sql.Bit, dismissed || false)
      .query(`
        MERGE dbo.user_bin_day AS target
        USING (
          SELECT @user_id AS user_id
        ) AS source
        ON target.user_id = source.user_id

        WHEN MATCHED THEN
          UPDATE SET
            data = @data,
            dismissed = @dismissed,
            updated_at = GETDATE()

        WHEN NOT MATCHED THEN
          INSERT (
            user_id,
            data,
            dismissed,
            created_at,
            updated_at
          )
          VALUES (
            @user_id,
            @data,
            @dismissed,
            GETDATE(),
            GETDATE()
          );
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("bin day save error:", err);
    res.status(500).json({ error: "bin day save failed" });
  }
});

// ==============================
// WALK STAMPS - GET
// ==============================
app.get("/walk-stamps", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT *
        FROM dbo.user_walk_stamps
        WHERE user_id = @user_id
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("walk stamps get error:", err);
    res.status(500).json({ error: "walk stamps fetch failed" });
  }
});

// ==============================
// WALK STAMPS - POST UPSERT
// ==============================
app.post("/walk-stamps", async (req, res) => {
  try {
    const { user_id, stamps } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("stamps", sql.NVarChar(100), String(stamps))
      .query(`
        MERGE dbo.user_walk_stamps AS target
        USING (
          SELECT @user_id AS user_id
        ) AS source
        ON target.user_id = source.user_id

        WHEN MATCHED THEN
          UPDATE SET
            stamps = @stamps,
            updated_at = GETDATE()

        WHEN NOT MATCHED THEN
          INSERT (
            user_id,
            stamps,
            created_at,
            updated_at
          )
          VALUES (
            @user_id,
            @stamps,
            GETDATE(),
            GETDATE()
          );
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("walk stamps save error:", err);
    res.status(500).json({ error: "walk stamps save failed" });
  }
});
// ==============================
// SERVER
// ==============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
