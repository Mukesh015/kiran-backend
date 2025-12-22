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
  const now = new Date();
  const lastTime = row.date_time ? new Date(row.date_time) : null;

  let minutesSinceLast = null;
  let isStale = true;
  if (lastTime && !Number.isNaN(lastTime.getTime())) {
    minutesSinceLast = (now.getTime() - lastTime.getTime()) / (1000 * 60);
    isStale = minutesSinceLast > 30; // > 30 minutes => stale
  } else {
    isStale = true;
  }

  const tankNo = row.tank_no;
  const D = Number(row.diameter_breadth ?? 0); // m
  const L = Number(row.length ?? 0); // m
  const capacityL = row.tank_volume != null ? Number(row.tank_volume) : null;
  const sensor =
    row.ultra_height != null ? Number(row.ultra_height) : null;

  // water depth from bottom
  let depth = null;
  if (sensor != null) {
    if (tankNo === "FIRE-TANK") {
      // 🔥 FIRE-TANK: rectangular height = 17.9 - ultra_height
      const MAX_HEIGHT_M = 17.9;
      depth = MAX_HEIGHT_M - sensor;
      if (depth < 0) depth = 0;
      if (depth > MAX_HEIGHT_M) depth = MAX_HEIGHT_M;
    } else if (D > 0) {
      // default cylindrical tanks: depth = D - sensor
      depth = D - sensor;
      if (depth < 0) depth = 0;
      if (depth > D) depth = D;
    }
  }

  // raw volume from last reading
  let rawVolumeL = null;
  if (depth != null) {
    if (tankNo === "FIRE-TANK") {
      // 🔥 FIRE-TANK rectangular volume:
      // volume (m³) = 8.9 × 5.15 × depth
      const WIDTH_M = 8.9;
      const LENGTH_M = 5.15;
      const volM3 = WIDTH_M * LENGTH_M * depth;
      rawVolumeL = volM3 * 1000; // to liters
    } else if (D > 0 && L > 0) {
      const volM3 = horizontalCylinderVolume(D, L, depth);
      rawVolumeL = volM3 * 1000; // to liters
    }
  }

  const maxL =
    row.upper_safe_limit_pct != null
      ? Number(row.upper_safe_limit_pct)
      : null;
  const minL =
    row.lower_safe_limit_pct != null
      ? Number(row.lower_safe_limit_pct)
      : null;

  let effectiveVolumeL = rawVolumeL;
  let tank_status;
  let tank_alert_message;

  if (isStale) {
    // *** 30-minute rule ***
    effectiveVolumeL = 0;
    tank_status = "Inactive";
    tank_alert_message = "No reading in last 30 minutes";
  } else {
    const s = statusFromLimits(rawVolumeL, minL, maxL);
    tank_status = s.tank_status;
    tank_alert_message = s.tank_alert_message;
  }

  let fillPct = null;
  if (capacityL != null && capacityL > 0 && effectiveVolumeL != null) {
    fillPct = Number(((effectiveVolumeL / capacityL) * 100).toFixed(1));
  }

  return {
    device_id: row.device_id,
    tank_no: row.tank_no,
    location: row.location,

    last_updated: lastTime ? lastTime.toISOString() : null,
    minutes_since_last:
      minutesSinceLast != null ? Number(minutesSinceLast.toFixed(1)) : null,
    stale: isStale,

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
          GROUP BY device_id
        ) tmax
          ON tt1.device_id = tmax.device_id
         AND tt1.date_time = tmax.max_time
      ) t
        ON t.device_id = m.device_id
      ORDER BY m.device_id;
      `
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
      [deviceId, deviceId]
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
