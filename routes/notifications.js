// routes/notifications.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const debug =
    req.query.debug === "1" ||
    req.query.debug === "true" ||
    req.query.debug === "yes";

  const { tank_no, location, limit } = req.query;

  const safeLimit = Math.min(parseInt(limit || "500", 10) || 500, 2000);

  // Base condition: last 15 days
  const where = [
    "t.current_time >= (NOW() - INTERVAL 15 DAY)",
  ];
  const params = [];

  if (tank_no) {
    where.push("t.tank_no = ?");
    params.push(tank_no);
  }

  if (location) {
    where.push("t.location = ?");
    params.push(location);
  }

  const whereSql = "WHERE " + where.join(" AND ");

  const sql = `
    SELECT
      t.id,
      t.tank_no,
      t.location,
      t.currentLevel,
      t.fillPercentage,
      t.flowStatus,
      t.tank_status,
      t.tank_alert_message,
      t.under_maintenance,
      t.disable_alert,

      -- Raw timestamp
      t.current_time AS raw_time,

      -- Formatted timestamp: dd/mm/yyyy hh:mm am/pm
      DATE_FORMAT(t.current_time, '%d/%m/%Y %r') AS timestamp

    FROM tank_status t
    ${whereSql}
    ORDER BY t.current_time DESC, t.id DESC
    LIMIT ?
  `;

  params.push(safeLimit);

  try {
    if (debug) {
      console.log("\n======================");
      console.log("🔍 Notifications Debug");
      console.log("======================");
      console.log("SQL Query:", sql);
      console.log("Params:", params);
    }

    const [rows] = await pool.query(sql, params);

    if (debug) {
      console.log("Rows:", rows.length);
      console.log("Sample:", rows[0]);
      console.log("======================\n");
    }

    return res.json({
      ok: true,
      rows,
    });
  } catch (err) {
    console.error("❌ Error:", err);
    return res.status(500).json({
      ok: false,
      error: "DB_ERROR",
      message: err.message,
    });
  }
});

export default router;
