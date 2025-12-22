// routes/tankCards.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// ✅ latest row per tank, using ID (reliable)
const latestTankStatusSubquery = `
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

// ------------------------------------------------------------------
// GET /api/tank-cards
// ------------------------------------------------------------------
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

      currentLevel: r.currentLevel ?? null,
      fillPercentage: r.fillPercentage ?? null,
      flowStatus: r.flowStatus ?? "Inactive",
      tank_status: r.tank_status ?? "Inactive",
      tank_alert_message: r.tank_alert_message ?? "No Data",
      under_maintenance: r.under_maintenance ?? 0,
      disable_alert: r.disable_alert ?? 0,
      current_time: r.current_time ?? null,

      tank_volume: r.tank_volume ?? null,
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/tank-cards error:", err);
    return res.status(500).json({ ok: false, message: "DB error" });
  }
});

// ------------------------------------------------------------------
// GET /api/tank-cards/:deviceId
// ------------------------------------------------------------------
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

      currentLevel: r.currentLevel ?? null,
      fillPercentage: r.fillPercentage ?? null,
      flowStatus: r.flowStatus ?? "Inactive",
      tank_status: r.tank_status ?? "Inactive",
      tank_alert_message: r.tank_alert_message ?? "No Data",
      under_maintenance: r.under_maintenance ?? 0,
      disable_alert: r.disable_alert ?? 0,
      current_time: r.current_time ?? null,

      tank_volume: r.tank_volume ?? null,
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/tank-cards/:deviceId error:", err);
    return res.status(500).json({ ok: false, message: "DB error" });
  }
});

export default router;
