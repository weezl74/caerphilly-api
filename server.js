
const express = require("express");
const sql = require("mssql");

const app = express();
app.use(express.json());

// SQL connection config
const config = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DB,
  options: {
    encrypt: true
  }
};

// Health check
app.get("/", (req, res) => {
  res.send("API working ✅");
});

// Get leaderboard
app.get("/profile", async (req, res) => {
  try {
    await sql.connect(config);

    const result = await sql.query(`
      SELECT user_id, display_name, username, wool_points, tree_points
      FROM profiles
    `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save profile
app.post("/profile", async (req, res) => {
  try {
    const { user_id, display_name, username, account_type } = req.body;

    await sql.connect(config);

    await sql.query`
      MERGE profiles AS target
      USING (SELECT ${user_id} AS user_id) AS source
      ON target.user_id = source.user_id
      WHEN MATCHED THEN
        UPDATE SET
          display_name = ${display_name},
          username = ${username},
          account_type = ${account_type || "resident"}
      WHEN NOT MATCHED THEN
        INSERT (user_id, display_name, username, account_type)
        VALUES (${user_id}, ${display_name}, ${username}, ${account_type || "resident"});
    `;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
