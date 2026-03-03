import express from "express";
import { pool } from "../db.js";
import axios from "axios"; // required for calling update-data

const router = express.Router();

function getLocalISTTimestamp() {
  const now = new Date();

  return now
    .toLocaleString("sv-SE", {
      timeZone: "Asia/Kolkata",
      hour12: false,
    })
    .replace("T", " ");
}

/**
 * POST /api/transactions
 */
router.post("/", async (req, res) => {
  try {
    const { device_id, tank_no, location, ultra_height } = req.body;

    // Keep IST formatted time
    const localTime = getLocalISTTimestamp();

    // 🔥 New timestamp in milliseconds
    const lastInserted = Date.now();

    console.log("Using IST time:", localTime);
    console.log("Last Inserted (ms):", lastInserted);

    if (!device_id || !tank_no || !location) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_FIELDS",
        details: "device_id, tank_no and location are required",
      });
    }

    const [devRows] = await pool.query(
      "SELECT 1 FROM Master_Tables WHERE device_id = ? LIMIT 1",
      [device_id],
    );

    if (devRows.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "UNKNOWN_DEVICE_ID",
        device_id,
      });
    }

    const sql = `
      INSERT INTO Transaction_Table
        (device_id, tank_no, location, ultra_height, date_time, last_inserted)
      VALUES
        (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        tank_no       = VALUES(tank_no),
        location      = VALUES(location),
        ultra_height  = VALUES(ultra_height),
        date_time     = VALUES(date_time),
        last_inserted = VALUES(last_inserted);
    `;

    const [result] = await pool.query(sql, [
      device_id,
      tank_no,
      location,
      ultra_height ?? null,
      localTime,
      lastInserted,
    ]);

    // Non-blocking call
    const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;

    axios
      .post(`${baseUrl}/api/update-data`, {
        device_id,
        tank_no,
        location,
        ultra_height,
        date_time: localTime,
        last_inserted: lastInserted,
      })
      .catch((err) => {
        console.error("[transactions] update-data FAILED:", err.message);
      });

    return res.json({
      ok: true,
      affectedRows: result.affectedRows,
      message: result.affectedRows === 1 ? "INSERTED" : "UPDATED_EXISTING_ROW",
      updateDataTriggered: true,
    });
  } catch (err) {
    console.error("POST /api/transactions fatal error:", err);
    return res.status(500).json({
      ok: false,
      error: "DB_WRITE_FAILED",
      details: String(err),
    });
  }
});

/**
 * GET /api/transactions?limit=50
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 500);

    const [rows] = await pool.query(
      `
        SELECT
          device_id,
          last_inserted,
          tank_no,
          location,
          ultra_height,
          date_time
        FROM Transaction_Table
        ORDER BY date_time DESC
        LIMIT ?;
      `,
      [limit],
    );

    return res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/transactions error:", err);
    return res.status(500).json({
      ok: false,
      error: "DB_READ_FAILED",
      details: String(err),
    });
  }
});

export default router;
