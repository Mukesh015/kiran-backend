// routes/transactions.js
import express from "express";
import { pool } from "../db.js";
import axios from "axios"; // required for calling update-data

const router = express.Router();

/**
 * POST /api/transactions
 */
router.post("/", async (req, res) => {
  try {
    const { device_id, tank_no, location, ultra_height, date_time } = req.body;

    // Basic validation
    if (!device_id || !tank_no || !location) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_FIELDS",
        details: "device_id, tank_no and location are required",
      });
    }

    // Check device exists
    const [devRows] = await pool.query(
      "SELECT 1 FROM Master_Tables WHERE device_id = ? LIMIT 1",
      [device_id]
    );

    if (devRows.length === 0) {
      console.warn("[transactions] UNKNOWN_DEVICE:", device_id);
      return res.status(400).json({
        ok: false,
        error: "UNKNOWN_DEVICE_ID",
        device_id,
      });
    }

    // Insert or update the transaction row
    const sql = `
      INSERT INTO Transaction_Table
        (device_id, tank_no, location, ultra_height, date_time)
      VALUES
        (?, ?, ?, ?, COALESCE(?, NOW()))
      ON DUPLICATE KEY UPDATE
        tank_no      = VALUES(tank_no),
        location     = VALUES(location),
        ultra_height = VALUES(ultra_height),
        date_time    = VALUES(date_time);
    `;

    const [result] = await pool.query(sql, [
      device_id,
      tank_no,
      location,
      ultra_height ?? null,
      date_time ?? null,
    ]);

    // =======================================================================
    // 🔥 NON-BLOCKING call to /api/update-data (to populate tank_status)
    // =======================================================================

    const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const payload = {
      device_id,
      tank_no,
      location,
      ultra_height,
      date_time,
    };

    // Non-blocking fire-and-forget call
    axios
      .post(`${baseUrl}/api/update-data`, payload)
      .then((resp) => {
        console.log("[transactions] ✔ update-data triggered:", resp.data);
      })
      .catch((err) => {
        console.error("[transactions] ❌ update-data FAILED:", err.message);
      });

    // =======================================================================

    return res.json({
      ok: true,
      affectedRows: result.affectedRows,
      message:
        result.affectedRows === 1 ? "INSERTED" : "UPDATED_EXISTING_ROW",
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
          tank_no,
          location,
          ultra_height,
          date_time
        FROM Transaction_Table
        ORDER BY date_time DESC
        LIMIT ?;
      `,
      [limit]
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
