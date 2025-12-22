// routes/tankCards.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * Get latest row per tank_no from tank_status
 * We group by tank_no and pick the max(current_time)
 */
const latestTankStatusSubquery = `
    SELECT ts1.*
    FROM tank_status ts1
    INNER JOIN (
        SELECT tank_no, MAX(current_time) AS max_time
        FROM tank_status
        GROUP BY tank_no
    ) t2
      ON ts1.tank_no = t2.tank_no
     AND ts1.current_time = t2.max_time
`;

/**
 * GET /api/tank-cards
 * from Master_Tables: device_id, location, tank_no
 * from tank_status: currentLevel, fillPercentage, flowStatus, tank_status,
 *                   tank_alert_message, under_maintenance, disable_alert, current_time
 * from Tank_Parameters: tank_volume
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
    LEFT JOIN (${latestTankStatusSubquery}) ts
        ON ts.tank_no = mt.tank_no
    LEFT JOIN Tank_Parameters tp
        ON tp.tank_no = mt.tank_no
    ORDER BY mt.device_id;
  `;

  try {
    const [rows] = await pool.query(sql);

    const data = rows.map(r => ({
      device_id: r.device_id,
      location: r.location,
      tank_no: r.tank_no,

      currentLevel: r.currentLevel,
      fillPercentage: r.fillPercentage,
      flowStatus: r.flowStatus,
      tank_status: r.tank_status,
      tank_alert_message: r.tank_alert_message,
      under_maintenance: r.under_maintenance,
      disable_alert: r.disable_alert,
      current_time: r.current_time,

      tank_volume: r.tank_volume,
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/tank-cards error:", err);
    return res.status(500).json({ ok: false, message: "DB error" });
  }
});

/**
 * GET /api/tank-cards/:deviceId
 * same join, filtered by device_id
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
    LEFT JOIN (${latestTankStatusSubquery}) ts
        ON ts.tank_no = mt.tank_no
    LEFT JOIN Tank_Parameters tp
        ON tp.tank_no = mt.tank_no
    WHERE mt.device_id = ?
    ORDER BY mt.device_id;
  `;

  try {
    const [rows] = await pool.query(sql, [deviceId]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: "No tank data found for this device_id",
      });
    }

    const data = rows.map(r => ({
      device_id: r.device_id,
      location: r.location,
      tank_no: r.tank_no,

      currentLevel: r.currentLevel,
      fillPercentage: r.fillPercentage,
      flowStatus: r.flowStatus,
      tank_status: r.tank_status,
      tank_alert_message: r.tank_alert_message,
      under_maintenance: r.under_maintenance,
      disable_alert: r.disable_alert,
      current_time: r.current_time,

      tank_volume: r.tank_volume,
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/tank-cards/:deviceId error:", err);
    return res.status(500).json({ ok: false, message: "DB error" });
  }
});

export default router;
