import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * volume of horizontal cylinder partly filled
 * D = diameter (m)
 * L = length (m)
 * h = liquid depth from bottom (m)
 * returns m^3
 */
function horizontalCylinderVolume(D, L, h) {
  const R = D / 2;
  if (h <= 0) return 0;
  if (h >= D) return Math.PI * R * R * L; // full

  // V = L * (R^2 * acos((R - h)/R) - (R - h) * sqrt(2Rh - h^2))
  const term1 = R * R * Math.acos((R - h) / R);
  const term2 = (R - h) * Math.sqrt(2 * R * h - h * h);
  const area = term1 - term2; // m^2
  return L * area; // m^3
}

/**
 * decide status + message from actual volume and safe limits (liters)
 */
function statusFromLimits(actualL, minL, maxL) {
  if (actualL == null) {
    return { tank_status: "Unknown", tank_alert_message: "No reading" };
  }

  if (minL == null && maxL == null) {
    return { tank_status: "OK", tank_alert_message: "Normal" };
  }

  if (maxL != null && actualL >= maxL) {
    return { tank_status: "Warning", tank_alert_message: "High level" };
  }

  if (minL != null && actualL <= minL) {
    return { tank_status: "Warning", tank_alert_message: "Low level" };
  }

  return { tank_status: "OK", tank_alert_message: "Normal" };
}

/**
 * Helper: build one tank object with 30-minute rule applied
 */
function buildTankResponseRow(row) {
  const STALE_TIMEOUT_MINUTES = 15; // testing (change to 15 in production)

  const minutesSinceLast =
    row.minutes_since_last != null ? Number(row.minutes_since_last) : null;

  const isStale =
    minutesSinceLast == null || minutesSinceLast > STALE_TIMEOUT_MINUTES;

  const lastTime = row.date_time ? new Date(row.date_time) : null;

  const tankNo = row.tank_no;
  const D = Number(row.diameter_breadth ?? 0);
  const L = Number(row.length ?? 0);
  const capacityL = row.tank_volume != null ? Number(row.tank_volume) : null;

  const sensor = row.ultra_height != null ? Number(row.ultra_height) : null;

  // -------------------------
  // DEPTH CALCULATION
  // -------------------------
  let depth = null;

  if (sensor != null) {
    if (tankNo === "FIRE-TANK") {
      const MAX_HEIGHT_M = 17.9;
      depth = MAX_HEIGHT_M - sensor;
      depth = Math.max(0, Math.min(depth, MAX_HEIGHT_M));
    } else if (D > 0) {
      depth = D - sensor;
      depth = Math.max(0, Math.min(depth, D));
    }
  }

  // -------------------------
  // VOLUME CALCULATION
  // -------------------------
  let rawVolumeL = null;

  if (depth != null) {
    if (tankNo === "FIRE-TANK") {
      const WIDTH_M = 8.9;
      const LENGTH_M = 5.15;
      rawVolumeL = WIDTH_M * LENGTH_M * depth * 1000;
    } else if (D > 0 && L > 0) {
      rawVolumeL = horizontalCylinderVolume(D, L, depth) * 1000;
    }
  }

  const maxL =
    row.upper_safe_limit_pct != null ? Number(row.upper_safe_limit_pct) : null;

  const minL =
    row.lower_safe_limit_pct != null ? Number(row.lower_safe_limit_pct) : null;

  let effectiveVolumeL = rawVolumeL;
  let tank_status;
  let tank_alert_message;

  if (isStale) {
    effectiveVolumeL = 0;
    tank_status = "Inactive";
    tank_alert_message =
      "No reading in last " + STALE_TIMEOUT_MINUTES + " minute(s)";
  } else {
    const s = statusFromLimits(rawVolumeL, minL, maxL);
    tank_status = s.tank_status;
    tank_alert_message = s.tank_alert_message;
  }

  if (isStale) {
    console.warn(
      `[STALE TANK DETECTED]
        Device: ${row.device_id}
        Tank: ${row.tank_no}
        Location: ${row.location}
        Minutes Since Last: ${minutesSinceLast}
        Last Update: ${row.date_time}`,
    );
  }

  let fillPct = null;
  if (capacityL && effectiveVolumeL != null) {
    fillPct = Number(((effectiveVolumeL / capacityL) * 100).toFixed(1));
  }

  return {
    device_id: row.device_id,
    tank_no: row.tank_no,
    location: row.location,

    last_updated: lastTime ? lastTime.toISOString() : null,

    minutes_since_last: minutesSinceLast,
    stale: isStale, // frontend can use this to show border red or green

    geometry: {
      diameter_m: D,
      length_m: L,
      capacity_l: capacityL,
    },

    raw_reading: {
      ultra_height_m: sensor,
      water_depth_m: depth,
      volume_l: rawVolumeL != null ? Number(rawVolumeL.toFixed(1)) : null,
    },

    effective: {
      volume_l:
        effectiveVolumeL != null ? Number(effectiveVolumeL.toFixed(1)) : null,
      fill_percentage: fillPct,
    },

    limits_l: {
      min_l: minL,
      max_l: maxL,
    },

    tank_status,
    tank_alert_message,
  };
}

/**
 * GET /api/tank-current/all
 *
 * Returns ALL tanks with:
 *  - last transaction data (from Transaction_Table)
 *  - computed volume & fill%
 *  - 30-minute rule (stale => 0, Inactive)
 */

router.get("/all", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `
SELECT
  m.device_id,
  m.tank_no,
  m.location,
  p.diameter_breadth,
  p.length,
  p.tank_volume,
  p.upper_safe_limit_pct,
  p.lower_safe_limit_pct,
  t.ultra_height,
  t.date_time,
  TIMESTAMPDIFF(MINUTE, t.date_time, NOW()) AS minutes_since_last
FROM Master_Tables m
LEFT JOIN Tank_Parameters p
  ON m.tank_no = p.tank_no
LEFT JOIN (
  SELECT tt1.*
  FROM Transaction_Table tt1
  INNER JOIN (
    SELECT device_id, MAX(date_time) AS max_time
    FROM Transaction_Table
    GROUP BY device_id
  ) tmax
    ON tt1.device_id = tmax.device_id
   AND tt1.date_time = tmax.max_time
) t
  ON t.device_id = m.device_id
ORDER BY m.device_id;
      `,
    );

    const data = rows.map((r) => buildTankResponseRow(r));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/tank-current/all error:", err);
    res.status(500).json({
      ok: false,
      error: "DB_READ_FAILED",
      details: String(err),
    });
  }
});

/**
 * GET /api/tank-current/current/:device_id
 * Single tank by device_id
 */
router.get("/current/:device_id", async (req, res) => {
  try {
    const deviceId = req.params.device_id;

    const [rows] = await pool.query(
      `
      SELECT
        m.device_id,
        m.tank_no,
        m.location,
        p.diameter_breadth,
        p.length,
        p.tank_volume,
        p.upper_safe_limit_pct,
        p.lower_safe_limit_pct,
        t.ultra_height,
        t.date_time
      FROM Master_Tables m
      LEFT JOIN Tank_Parameters p
        ON m.tank_no = p.tank_no
      LEFT JOIN (
        SELECT tt1.*
        FROM Transaction_Table tt1
        INNER JOIN (
          SELECT device_id, MAX(date_time) AS max_time
          FROM Transaction_Table
          WHERE device_id = ?
          GROUP BY device_id
        ) tmax
          ON tt1.device_id = tmax.device_id
         AND tt1.date_time = tmax.max_time
      ) t
        ON t.device_id = m.device_id
      WHERE m.device_id = ?
      LIMIT 1;
      `,
      [deviceId, deviceId],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: "NO_DEVICE", device_id: deviceId });
    }

    const obj = buildTankResponseRow(rows[0]);
    return res.json({ ok: true, data: obj });
  } catch (err) {
    console.error("GET /api/tank-current/current/:device_id error:", err);
    res.status(500).json({
      ok: false,
      error: "DB_READ_FAILED",
      details: String(err),
    });
  }
});

export default router;
