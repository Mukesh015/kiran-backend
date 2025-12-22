import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * Get latest status per tank/device
 * We do NOT use current_time because many rows have NULL time.
 * We use MAX(id) per tank_no → that is your real "last stored data".
 */
const latestStatusPerTank = `
    SELECT ts1.*
    FROM tank_status ts1
    INNER JOIN (
        SELECT tank_no, MAX(id) AS max_id
        FROM tank_status
        GROUP BY tank_no
    ) t2
      ON ts1.tank_no = t2.tank_no
     AND ts1.id = t2.max_id
`;

/**
 * GET /api/devices/latest
 * → returns one row per device_id (even if device never sent)
 */
router.get("/", async (_req, res) => {
  const sql = `
    SELECT
        mt.device_id,
        mt.location,
        mt.tank_no,

        ts.currentLevel,
        ts.fillPercentage,
        ts.flowStatus,
        ts.tank_status,
        ts.tank_alert_message,
        ts.under_maintenance,
        ts.disable_alert,
        ts.current_time,

        tp.tank_volume
    FROM Master_Tables mt
    LEFT JOIN (${latestStatusPerTank}) ts
        ON ts.tank_no = mt.tank_no
    LEFT JOIN Tank_Parameters tp
        ON tp.tank_no = mt.tank_no
    ORDER BY mt.device_id;
  `;

  try {
    const [rows] = await pool.query(sql);

    const data = rows.map((r) => ({
      device_id: r.device_id,
      location: r.location,
      tank_no: r.tank_no,

      // last stored values (may be null if device never sent)
      currentLevel: r.currentLevel ?? null,
      fillPercentage: r.fillPercentage ?? null,
      flowStatus: r.flowStatus ?? "Inactive",
      tank_status: r.tank_status ?? "Inactive",
      tank_alert_message: r.tank_alert_message ?? "No Data",
      under_maintenance: r.under_maintenance ?? 0,
      disable_alert: r.disable_alert ?? 0,
      // you said “time is not important” → we still send it if present
      current_time: r.current_time ?? null,

      tank_volume: r.tank_volume ?? null,
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/devices/latest error:", err);
    return res.status(500).json({ ok: false, message: "DB error" });
  }
});

/**
 * GET /api/devices/latest/:deviceId
 * → always return the last stored record for this device_id,
 *   even if the last stored time is old or NULL
 */
router.get("/:deviceId", async (req, res) => {
  const { deviceId } = req.params;

  const sql = `
    SELECT
        mt.device_id,
        mt.location,
        mt.tank_no,

        ts.currentLevel,
        ts.fillPercentage,
        ts.flowStatus,
        ts.tank_status,
        ts.tank_alert_message,
        ts.under_maintenance,
        ts.disable_alert,
        ts.current_time,

        tp.tank_volume
    FROM Master_Tables mt
    LEFT JOIN (${latestStatusPerTank}) ts
        ON ts.tank_no = mt.tank_no
    LEFT JOIN Tank_Parameters tp
        ON tp.tank_no = mt.tank_no
    WHERE mt.device_id = ?
    LIMIT 1;
  `;

  try {
    const [rows] = await pool.query(sql, [deviceId]);

    // even if there’s no status row, Master_Tables guarantees 1 row
    if (!rows.length) {
      // device_id not even in Master_Tables
      return res
        .status(404)
        .json({ ok: false, message: "device_id not found" });
    }

    const r = rows[0];

    const data = {
      device_id: r.device_id,
      location: r.location,
      tank_no: r.tank_no,
      currentLevel: r.currentLevel ?? null,
      fillPercentage: r.fillPercentage ?? null,
      flowStatus: r.flowStatus ?? "Inactive",
      tank_status: r.tank_status ?? "Inactive",
      tank_alert_message: r.tank_alert_message ?? "No Data",
      under_maintenance: r.under_maintenance ?? 0,
      disable_alert: r.disable_alert ?? 0,
      current_time: r.current_time ?? null,
      tank_volume: r.tank_volume ?? null,
    };

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/devices/latest/:deviceId error:", err);
    return res.status(500).json({ ok: false, message: "DB error" });
  }
});

export default router;
