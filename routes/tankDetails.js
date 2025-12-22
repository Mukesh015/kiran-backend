// routes/tankDetails.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * GET /api/tank-details/:deviceId
 *
 * Pulls the latest row per tank from tank_status,
 * joins to Master_Tables to map device_id -> tank_no,
 * joins to Tank_Parameters to get capacity,
 * then filters by the requested deviceId.
 *
 * Returns a single object — exactly what your card UI wants.
 */
router.get("/:deviceId", async (req, res) => {
  const { deviceId } = req.params;

  // latest reading per tank, then filter by device
  const sql = `
    SELECT 
        mt.device_id,
        mt.location,
        ts.tankCode,
        ts.currentLevel                             AS working_volume_l,
        ts.fillPercentage                           AS fill_pct,
        tp.tank_volume                              AS capacity_l,
        (tp.tank_volume - ts.currentLevel)          AS free_volume_l,
        ts.flowStatus,
        ts.tank_status,
        ts.tank_alert_message,
        ts.current_time                             AS updated_at
    FROM (
        -- get latest status per tank
        SELECT ts.*
        FROM tank_status ts
        JOIN (
            SELECT tankCode, MAX(current_time) AS max_time
            FROM tank_status
            GROUP BY tankCode
        ) latest
          ON ts.tankCode = latest.tankCode
         AND ts.current_time = latest.max_time
    ) ts
    JOIN Master_Tables mt
      ON mt.tank_no = ts.tankCode
    LEFT JOIN Tank_Parameters tp
      ON tp.tank_no = ts.tankCode
    WHERE mt.device_id = ?
    LIMIT 1;
  `;

  try {
    const [rows] = await pool.query(sql, [deviceId]);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: "No tank data found for this device_id",
      });
    }

    const r = rows[0];

    // normalize numeric fields (frontend hates nulls/strings)
    const workingVolume = Number(r.working_volume_l || 0);
    const capacity = Number(r.capacity_l || 0);
    const freeVolume = Number(r.free_volume_l || 0);
    const fillPct = Number(r.fill_pct || 0);

    return res.json({
      ok: true,
      data: {
        device_id: r.device_id,
        tank_code: r.tankCode,
        location: r.location,
        working_volume_l: workingVolume,
        capacity_l: capacity,
        free_volume_l: freeVolume,
        fill_percentage: fillPct,
        flow_status: r.flowStatus,
        tank_status: r.tank_status,
        alert_message: r.tank_alert_message,
        updated_at: r.updated_at,
      },
    });
  } catch (err) {
    console.error("GET /api/tank-details/:deviceId failed:", err);
    return res.status(500).json({
      ok: false,
      message: "Database error",
    });
  }
});

export default router;
