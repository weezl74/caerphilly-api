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
app.post("/responses/save", async (req, res) => {
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
        SELECT
          business_id,
          data
        FROM dbo.user_wallet
        WHERE user_id = @user_id
        ORDER BY created_at DESC
      `);

    const rows = result.recordset.map(row => ({
      business_id: row.business_id,
      data: row.data ? JSON.parse(row.data) : null
    }));

    res.json(rows);

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
// MAP LOCATIONS
// ==============================
app.get("/map-locations", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM dbo.map_locations
      ORDER BY title
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("map-locations error:", err);
    res.status(500).json({ error: "map locations failed" });
  }
});

// ==============================
// BUSINESS CARDS PUBLIC
// ==============================
app.get("/business-cards/public", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM dbo.business_cards
      WHERE status = 'approved'
      ORDER BY business_name
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("business-cards/public error:", err);
    res.status(500).json({ error: "business cards failed" });
  }
});

// ==============================
// LEGACY PUBLIC ROUTE
// (temporary compatibility route)
// ==============================
app.get("/public", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM dbo.business_cards
      WHERE status = 'approved'
      ORDER BY business_name
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("public route error:", err);
    res.status(500).json({ error: "public route failed" });
  }
});

// ==============================
// TRANSLATIONS
// ==============================
app.get("/translations", async (req, res) => {
  try {
    const lang = req.query.lang || "cy";

    const pool = await getPool();

    const result = await pool.request()
      .input("lang", sql.NVarChar(10), lang)
      .query(`
        SELECT
          english_version,
          translation,
          language_code
        FROM dbo.translations
        WHERE language_code = @lang
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("translations error:", err);
    res.status(500).json({ error: "translations failed" });
  }
});

// ==============================
// PLEDGES CATALOGUE
// ==============================
app.get("/pledges-catalogue", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM dbo.pledges
      ORDER BY title
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error("pledges catalogue error:", err);
    res.status(500).json({ error: "pledges catalogue failed" });
  }
});

// ==============================
// BUSINESS CARD (MY BUSINESS)
// ==============================
app.get("/business-cards/me", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT TOP 1 *
        FROM dbo.business_cards
        WHERE user_id = @user_id
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("business-cards/me error:", err);
    res.status(500).json({ error: "business card lookup failed" });
  }
});

// ==============================
// BUSINESS CARD UPSERT
// ==============================
app.post("/business-cards", async (req, res) => {
  try {
    const {
      user_id,
      business_name,
      tagline,
      sector,
      website,
      logo_url,
      pen_portrait,
      climate_goals,
      offer_to_residents,
      offer_to_businesses,
      sector_icon,
      stamps_required,
      reward_text
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("business_name", sql.NVarChar(sql.MAX), business_name || "")
      .input("tagline", sql.NVarChar(sql.MAX), tagline || "")
      .input("sector", sql.NVarChar(sql.MAX), sector || "")
      .input("website", sql.NVarChar(sql.MAX), website || "")
      .input("logo_url", sql.NVarChar(sql.MAX), logo_url || "")
      .input("pen_portrait", sql.NVarChar(sql.MAX), pen_portrait || "")
      .input("climate_goals", sql.NVarChar(sql.MAX), climate_goals || "")
      .input("offer_to_residents", sql.NVarChar(sql.MAX), offer_to_residents || "")
      .input("offer_to_businesses", sql.NVarChar(sql.MAX), offer_to_businesses || "")
      .input("sector_icon", sql.NVarChar(100), sector_icon || "")
      .input("stamps_required", sql.Int, stamps_required || 6)
      .input("reward_text", sql.NVarChar(sql.MAX), reward_text || "")
      .query(`
        IF EXISTS (
          SELECT 1
          FROM dbo.business_cards
          WHERE user_id = @user_id
        )
        BEGIN
          UPDATE dbo.business_cards
          SET
            business_name = @business_name,
            tagline = @tagline,
            sector = @sector,
            website = @website,
            logo_url = @logo_url,
            pen_portrait = @pen_portrait,
            climate_goals = @climate_goals,
            offer_to_residents = @offer_to_residents,
            offer_to_businesses = @offer_to_businesses,
            sector_icon = @sector_icon,
            stamps_required = @stamps_required,
            reward_text = @reward_text,
            updated_at = GETDATE()
          WHERE user_id = @user_id
        END
        ELSE
        BEGIN
          INSERT INTO dbo.business_cards (
            id,
            user_id,
            business_name,
            tagline,
            sector,
            website,
            logo_url,
            pen_portrait,
            climate_goals,
            offer_to_residents,
            offer_to_businesses,
            sector_icon,
            stamps_required,
            reward_text,
            status,
            created_at,
            updated_at
          )
          VALUES (
            NEWID(),
            @user_id,
            @business_name,
            @tagline,
            @sector,
            @website,
            @logo_url,
            @pen_portrait,
            @climate_goals,
            @offer_to_residents,
            @offer_to_businesses,
            @sector_icon,
            @stamps_required,
            @reward_text,
            'pending',
            GETDATE(),
            GETDATE()
          )
        END
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("business-cards save error:", err);
    res.status(500).json({ error: "business card save failed" });
  }
});
// ==============================
// GET USER GROUP
// ==============================
app.get("/users/:user_id/group", async (req, res) => {
  try {
    const { user_id } = req.params;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT TOP 1
          g.id,
          g.name,
          g.code,
          g.created_by
        FROM dbo.group_members gm
        INNER JOIN dbo.groups g
          ON gm.group_id = g.id
        WHERE gm.user_id = @user_id
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("user group error:", err);
    res.status(500).json({ error: "group lookup failed" });
  }
});

// ==============================
// GET GROUP BY ID
// ==============================
app.get("/groups/:id", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("id", sql.Int, req.params.id)
      .query(`
        SELECT *
        FROM dbo.groups
        WHERE id = @id
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("group lookup error:", err);
    res.status(500).json({ error: "group lookup failed" });
  }
});

// ==============================
// GET GROUP BY CODE
// ==============================
app.get("/groups/by-code/:code", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("code", sql.NVarChar(50), req.params.code)
      .query(`
        SELECT *
        FROM dbo.groups
        WHERE code = @code
      `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error("group code error:", err);
    res.status(500).json({ error: "group code lookup failed" });
  }
});

// ==============================
// CREATE GROUP
// ==============================
app.post("/groups", async (req, res) => {
  try {
    const {
      name,
      code,
      created_by
    } = req.body;

    const groupCode =
      code ||
      Math.random()
        .toString(36)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .substring(0, 6);

    const pool = await getPool();

    const result = await pool.request()
      .input("name", sql.NVarChar(255), name)
      .input("code", sql.NVarChar(50), groupCode)
      .input("created_by", sql.UniqueIdentifier, created_by)
      .query(`
        DECLARE @NextId INT;

        SELECT
          @NextId = ISNULL(MAX(id), 0) + 1
        FROM dbo.groups;

        INSERT INTO dbo.groups (
          id,
          name,
          code,
          created_by,
          created_at,
          updated_at
        )
        VALUES (
          @NextId,
          @name,
          @code,
          @created_by,
          GETDATE(),
          GETDATE()
        );

        INSERT INTO dbo.group_members (
          group_id,
          user_id,
          joined_at
        )
        VALUES (
          @NextId,
          @created_by,
          GETDATE()
        );

        SELECT *
        FROM dbo.groups
        WHERE id = @NextId;
      `);

    res.json(result.recordset[0]);

  } catch (err) {
    console.error("group create error:", err);
    res.status(500).json({ error: "group create failed" });
  }
});

// ==============================
// GET GROUP MEMBERS
// ==============================
app.get("/groups/:id/members", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("group_id", sql.Int, req.params.id)
      .query(`
        SELECT
          gm.user_id,
          COALESCE(p.display_name,'Member') AS display_name,
          ISNULL(p.wool_points,0) + ISNULL(p.tree_points,0) AS total_points
        FROM dbo.group_members gm
        LEFT JOIN dbo.profiles p
          ON TRY_CONVERT(uniqueidentifier, p.user_id) = gm.user_id
        WHERE gm.group_id = @group_id
        ORDER BY total_points DESC
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("group members error:", err);
    res.status(500).json({ error: "group members failed" });
  }
});

// ==============================
// JOIN GROUP
// ==============================
app.post("/groups/:id/members", async (req, res) => {
  try {
    const { user_id } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("group_id", sql.Int, req.params.id)
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        IF NOT EXISTS (
          SELECT 1
          FROM dbo.group_members
          WHERE group_id = @group_id
          AND user_id = @user_id
        )
        INSERT INTO dbo.group_members (
          group_id,
          user_id,
          joined_at
        )
        VALUES (
          @group_id,
          @user_id,
          GETDATE()
        )
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("join group error:", err);
    res.status(500).json({ error: "group join failed" });
  }
});

// ==============================
// LEAVE GROUP
// ==============================
app.delete("/groups/:id/members/:user_id", async (req, res) => {
  try {
    const pool = await getPool();

    await pool.request()
      .input("group_id", sql.Int, req.params.id)
      .input("user_id", sql.UniqueIdentifier, req.params.user_id)
      .query(`
        DELETE FROM dbo.group_members
        WHERE group_id = @group_id
        AND user_id = @user_id
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("leave group error:", err);
    res.status(500).json({ error: "group leave failed" });
  }
});
// ==============================
// TREE REQUESTS - GET
// ==============================
app.get("/tree-requests", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT *
        FROM dbo.tree_requests
        WHERE user_id = @user_id
        ORDER BY created_at DESC
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("tree requests get error:", err);
    res.status(500).json({ error: "tree requests fetch failed" });
  }
});

// ==============================
// TREE REQUESTS - CREATE
// ==============================
app.post("/tree-requests", async (req, res) => {
  try {
    const {
      user_id,
      points_used,
      tree_species
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("id", sql.UniqueIdentifier, sql.UniqueIdentifier ? undefined : null)
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("points_used", sql.Int, points_used || 500)
      .input("tree_species", sql.NVarChar(255), tree_species || "")
      .query(`
        INSERT INTO dbo.tree_requests (
          id,
          user_id,
          points_used,
          status,
          tree_species,
          created_at,
          updated_at
        )
        VALUES (
          NEWID(),
          @user_id,
          @points_used,
          'pending',
          @tree_species,
          GETDATE(),
          GETDATE()
        )
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("tree request create error:", err);
    res.status(500).json({ error: "tree request create failed" });
  }
});

// ==============================
// TREE REQUESTS - UPDATE
// ==============================
app.patch("/tree-requests/:id", async (req, res) => {
  try {
    const {
      status,
      what3words_location,
      planting_date
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("id", sql.UniqueIdentifier, req.params.id)
      .input("status", sql.NVarChar(50), status)
      .input("what3words_location", sql.NVarChar(255), what3words_location)
      .input("planting_date", sql.DateTime, planting_date || null)
      .query(`
        UPDATE dbo.tree_requests
        SET
          status = ISNULL(@status, status),
          what3words_location = ISNULL(@what3words_location, what3words_location),
          planting_date = ISNULL(@planting_date, planting_date),
          updated_at = GETDATE()
        WHERE id = @id
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("tree request update error:", err);
    res.status(500).json({ error: "tree request update failed" });
  }
});

// ==============================
// RENEWABLES - GET
// ==============================
app.get("/renewables", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT *
        FROM dbo.user_renewables
        WHERE user_id = @user_id
        ORDER BY purchased_at DESC
      `);

    const rows = result.recordset.map(row => ({
      id: row.id,
      user_id: row.user_id,
      tech_type: row.technology_type,
      lat: row.position_x,
      lng: row.position_y,
      points_cost: row.points_cost,
      placed_at: row.purchased_at
    }));

    res.json(rows);

  } catch (err) {
    console.error("renewables get error:", err);
    res.status(500).json({ error: "renewables fetch failed" });
  }
});

// ==============================
// RENEWABLES - CREATE
// ==============================
app.post("/renewables", async (req, res) => {
  try {
    const {
      user_id,
      tech_type,
      lat,
      lng,
      cooling
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("technology_type", sql.NVarChar(100), tech_type)
      .input("position_x", sql.Float, lat || 0)
      .input("position_y", sql.Float, lng || 0)
      .input("points_cost", sql.Int, Math.round((cooling || 0) * 100))
      .query(`
        INSERT INTO dbo.user_renewables (
          id,
          user_id,
          technology_type,
          points_cost,
          position_x,
          position_y,
          purchased_at
        )
        VALUES (
          NEWID(),
          @user_id,
          @technology_type,
          @points_cost,
          @position_x,
          @position_y,
          GETDATE()
        )
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("renewables create error:", err);
    res.status(500).json({ error: "renewables create failed" });
  }
});

// ==============================
// RENEWABLES - UPDATE
// ==============================
app.patch("/renewables/:id", async (req, res) => {
  try {
    const { position_x, position_y } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("id", sql.UniqueIdentifier, req.params.id)
      .input("position_x", sql.Float, position_x)
      .input("position_y", sql.Float, position_y)
      .query(`
        UPDATE dbo.user_renewables
        SET
          position_x = ISNULL(@position_x, position_x),
          position_y = ISNULL(@position_y, position_y)
        WHERE id = @id
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("renewables update error:", err);
    res.status(500).json({ error: "renewables update failed" });
  }
});

// ==============================
// BUSINESS STAMPS - GET
// ==============================
app.get("/business-stamps", async (req, res) => {
  try {
    const { user_id } = req.query;

    const pool = await getPool();

    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .query(`
        SELECT *
        FROM dbo.user_business_stamps
        WHERE user_id = @user_id
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error("business stamps get error:", err);
    res.status(500).json({ error: "business stamps fetch failed" });
  }
});

// ==============================
// BUSINESS STAMPS - UPSERT
// ==============================
app.post("/business-stamps", async (req, res) => {
  try {
    const {
      user_id,
      business_card_id,
      stamps
    } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("user_id", sql.UniqueIdentifier, user_id)
      .input("business_card_id", sql.UniqueIdentifier, business_card_id)
      .input("stamps", sql.Int, stamps)
      .query(`
        MERGE dbo.user_business_stamps AS target
        USING (
          SELECT
            @user_id AS user_id,
            @business_card_id AS business_card_id
        ) AS source
        ON target.user_id = source.user_id
        AND target.business_card_id = source.business_card_id

        WHEN MATCHED THEN
          UPDATE SET
            stamps = @stamps,
            updated_at = GETDATE()

        WHEN NOT MATCHED THEN
          INSERT (
            id,
            user_id,
            business_card_id,
            stamps,
            created_at,
            updated_at
          )
          VALUES (
            NEWID(),
            @user_id,
            @business_card_id,
            @stamps,
            GETDATE(),
            GETDATE()
          );
      `);

    res.json({ success: true });

  } catch (err) {
    console.error("business stamps save error:", err);
    res.status(500).json({ error: "business stamps save failed" });
  }
});
// ==============================
// SERVER
// ==============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
