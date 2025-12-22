// routes/tank.js (ESM)
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/* ---------- helpers ---------- */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Compute dashboard metrics from params + latest ultrasonic reading.
 * Assumptions:
 * - p.height is the tank internal height in meters.
 * - r.ultra_height is the distance (m) from sensor to liquid surface (top-mounted).
 * - p.tank_volume is total capacity (liters).
 */
function computeMetrics(p, r) {
  const capacityL = Number(p?.tank_volume ?? 0);   // liters
  const H = Number(p?.height ?? 0);                // meters
  const ul = (r?.ultra_height ?? null);

  if (!H || ul == null) {
    return {
      level_pct: null,
      working_volume_l: null,
      free_volume_l: null,
      capacity_l: capacityL,
      status_tag: r?.ul_status ?? null
    };
  }

  // liquid height = tank height - ultrasonic distance
  let liquidH = H - Number(ul);
  liquidH = clamp(liquidH, 0, H);

  const levelPct = (liquidH / H) * 100;
  const workingL = capacityL * (levelPct / 100);
  const freeL = Math.max(capacityL - workingL, 0);

  const lowPct = Number(p?.lower_safe_limit_pct ?? NaN);
  const upPct  = Number(p?.upper_safe_limit_pct ?? NaN);
  let tag = r?.ul_status ?? null;

  if (!isNaN(lowPct) && !isNaN(upPct)) {
    if (levelPct >= upPct) tag = "High";
    else if (levelPct <= lowPct) tag = "Low";
    else if (!tag) tag = "Normal";
  }

  return {
    level_pct: Number(levelPct.toFixed(1)),
    working_volume_l: Number(workingL.toFixed(1)),
    free_volume_l: Math.round(freeL),
    capacity_l: Math.round(capacityL),
    status_tag: tag
  };
}

/* ---------- SQL snippets ---------- */
// latest row in Transaction_Table per device
const LATEST_TX_JOIN = `
  JOIN (
    SELECT device_id, MAX(date_time) AS max_dt
    FROM Transaction_Table
    GROUP BY device_id
  ) as tmax
    ON t.device_id = tmax.device_id AND t.date_time = tmax.max_dt
`;

/* ============================================================
   GET /api/tanks/cards
   One row per device with computed dashboard metrics
   ============================================================ */
router.get("/cards", async (_req, res) => {
  try {
    const sql = `
      SELECT
        m.device_id,
        m.tank_no,
        m.location           AS master_location,
        p.diameter_breadth, p.length, p.height, p.tank_volume,
        p.upper_safe_limit_pct, p.lower_safe_limit_pct,
        p.pipe_size, p.pipe_dia, p.pipe_volume, p.required_volume,
        t.date_time, t.location AS tx_location,
        t.ultra_height, t.lidar_height, t.ul_status
      FROM Master_Tables m
      LEFT JOIN Tank_Parameters p  ON p.tank_no = m.tank_no
      LEFT JOIN Transaction_Table t ON t.device_id = m.device_id
      ${LATEST_TX_JOIN}
      ORDER BY m.device_id;
    `;
    const [rows] = await pool.query(sql);

    const data = rows.map(r => {
      const params = {
        height: r.height,
        tank_volume: r.tank_volume,
        upper_safe_limit_pct: r.upper_safe_limit_pct,
        lower_safe_limit_pct: r.lower_safe_limit_pct
      };
      const reading = {
        ultra_height: r.ultra_height,
        lidar_height: r.lidar_height,
        ul_status: r.ul_status
      };
      const metrics = computeMetrics(params, reading);

      return {
        device_id: r.device_id,
        tank_no: r.tank_no,
        location: r.tx_location ?? r.master_location ?? null,
        last_updated: r.date_time ? (r.date_time.toISOString?.() ?? r.date_time) : null,
        readings: {
          ultra_height: r.ultra_height ?? null,
          lidar_height: r.lidar_height ?? null,
          ul_status: r.ul_status ?? null
        },
        params: {
          height_m: r.height ?? null,
          tank_volume_l: r.tank_volume ?? null,
          upper_safe_limit_pct: r.upper_safe_limit_pct ?? null,
          lower_safe_limit_pct: r.lower_safe_limit_pct ?? null,
          pipe_size: r.pipe_size ?? null,
          pipe_dia: r.pipe_dia ?? null,
          pipe_volume: r.pipe_volume ?? null,
          required_volume: r.required_volume ?? null
        },
        metrics
      };
    });

    res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/tanks/cards error:", err);
    res.status(500).json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ============================================================
   GET /api/tanks/:tank_no
   Single tank latest info
   ============================================================ */
router.get("/:tank_no", async (req, res) => {
  try {
    const tankNo = String(req.params.tank_no).trim();

    const sql = `
      SELECT
        m.device_id,
        m.tank_no,
        m.location           AS master_location,
        p.diameter_breadth, p.length, p.height, p.tank_volume,
        p.upper_safe_limit_pct, p.lower_safe_limit_pct,
        p.pipe_size, p.pipe_dia, p.pipe_volume, p.required_volume,
        t.date_time, t.location AS tx_location,
        t.ultra_height, t.lidar_height, t.ul_status
      FROM Master_Tables m
      LEFT JOIN Tank_Parameters p  ON p.tank_no = m.tank_no
      LEFT JOIN Transaction_Table t ON t.device_id = m.device_id
      ${LATEST_TX_JOIN}
      WHERE m.tank_no = ?
      LIMIT 1;
    `;
    const [rows] = await pool.query(sql, [tankNo]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "TANK_NOT_FOUND" });

    const r = rows[0];
    const params = {
      height: r.height,
      tank_volume: r.tank_volume,
      upper_safe_limit_pct: r.upper_safe_limit_pct,
      lower_safe_limit_pct: r.lower_safe_limit_pct
    };
    const reading = {
      ultra_height: r.ultra_height,
      lidar_height: r.lidar_height,
      ul_status: r.ul_status
    };
    const metrics = computeMetrics(params, reading);

    const payload = {
      device_id: r.device_id,
      tank_no: r.tank_no,
      location: r.tx_location ?? r.master_location ?? null,
      last_updated: r.date_time ? (r.date_time.toISOString?.() ?? r.date_time) : null,
      readings: {
        ultra_height: r.ultra_height ?? null,
        lidar_height: r.lidar_height ?? null,
        ul_status: r.ul_status ?? null
      },
      params: {
        height_m: r.height ?? null,
        tank_volume_l: r.tank_volume ?? null,
        upper_safe_limit_pct: r.upper_safe_limit_pct ?? null,
        lower_safe_limit_pct: r.lower_safe_limit_pct ?? null,
        pipe_size: r.pipe_size ?? null,
        pipe_dia: r.pipe_dia ?? null,
        pipe_volume: r.pipe_volume ?? null,
        required_volume: r.required_volume ?? null
      },
      metrics
    };

    res.json({ ok: true, data: payload });
  } catch (err) {
    console.error("GET /api/tanks/:tank_no error:", err);
    res.status(500).json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ============================================================
   GET /api/tanks/history/by-device/:device_id
   Raw history (existing)
   ============================================================ */
router.get("/history/by-device/:device_id", async (req, res) => {
  try {
    const deviceId = String(req.params.device_id).trim();
    const limit = Math.min(Number(req.query.limit ?? 300), 1000);

    const sql = `
      SELECT device_id, date_time, tank_no, location, ultra_height, lidar_height, ul_status
      FROM Transaction_Table
      WHERE device_id = ?
      ORDER BY date_time DESC
      LIMIT ?;
    `;
    const [rows] = await pool.query(sql, [deviceId, limit]);

    const data = rows.map(r => ({
      device_id: r.device_id,
      date_time: r.date_time ? (r.date_time.toISOString?.() ?? r.date_time) : null,
      tank_no: r.tank_no ?? null,
      location: r.location ?? null,
      ultra_height: r.ultra_height ?? null,
      lidar_height: r.lidar_height ?? null,
      ul_status: r.ul_status ?? null
    }));

    res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/tanks/history/by-device error:", err);
    res.status(500).json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ============================================================
   NEW: GET /api/tanks/analysis/by-device/:device_id
   (optional, keeps your earlier requirement)
   ============================================================ */
router.get("/analysis/by-device/:device_id", async (req, res) => {
  try {
    const deviceId = String(req.params.device_id).trim();
    const limit = Math.min(Number(req.query.limit ?? 30), 30);

    const sql = `
      SELECT device_id, date_time, tank_no, location, ultra_height, lidar_height, ul_status
      FROM Transaction_Table
      WHERE device_id = ?
      ORDER BY date_time DESC
      LIMIT ?;
    `;
    const [rows] = await pool.query(sql, [deviceId, limit]);

    if (!rows.length) {
      return res.json({
        ok: true,
        device_id: deviceId,
        limit_used: limit,
        count: 0,
        analysis: null
      });
    }

    let ulMin = Number.POSITIVE_INFINITY;
    let ulMax = Number.NEGATIVE_INFINITY;
    let ulSum = 0;
    let ulCount = 0;

    let lidarMin = Number.POSITIVE_INFINITY;
    let lidarMax = Number.NEGATIVE_INFINITY;
    let lidarSum = 0;
    let lidarCount = 0;

    const statusCounts = {};

    rows.forEach(r => {
      if (r.ultra_height != null) {
        const v = Number(r.ultra_height);
        if (!Number.isNaN(v)) {
          ulMin = Math.min(ulMin, v);
          ulMax = Math.max(ulMax, v);
          ulSum += v;
          ulCount += 1;
        }
      }
      if (r.lidar_height != null) {
        const v = Number(r.lidar_height);
        if (!Number.isNaN(v)) {
          lidarMin = Math.min(lidarMin, v);
          lidarMax = Math.max(lidarMax, v);
          lidarSum += v;
          lidarCount += 1;
        }
      }
      const st = r.ul_status ?? "UNKNOWN";
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });

    const newest = rows[0];
    const oldest = rows[rows.length - 1];

    const analysis = {
      period: {
        from: oldest.date_time ? (oldest.date_time.toISOString?.() ?? oldest.date_time) : null,
        to: newest.date_time ? (newest.date_time.toISOString?.() ?? newest.date_time) : null,
      },
      ultra_height: {
        min: ulCount ? Number(ulMin.toFixed(3)) : null,
        max: ulCount ? Number(ulMax.toFixed(3)) : null,
        avg: ulCount ? Number((ulSum / ulCount).toFixed(3)) : null,
        samples: ulCount
      },
      lidar_height: {
        min: lidarCount ? Number(lidarMin.toFixed(3)) : null,
        max: lidarCount ? Number(lidarMax.toFixed(3)) : null,
        avg: lidarCount ? Number((lidarSum / lidarCount).toFixed(3)) : null,
        samples: lidarCount
      },
      status_counts: statusCounts
    };

    res.json({
      ok: true,
      device_id: deviceId,
      limit_used: limit,
      count: rows.length,
      analysis,
      data: rows.map(r => ({
        device_id: r.device_id,
        date_time: r.date_time ? (r.date_time.toISOString?.() ?? r.date_time) : null,
        tank_no: r.tank_no ?? null,
        location: r.location ?? null,
        ultra_height: r.ultra_height ?? null,
        lidar_height: r.lidar_height ?? null,
        ul_status: r.ul_status ?? null
      }))
    });
  } catch (err) {
    console.error("GET /api/tanks/analysis/by-device error:", err);
    res.status(500).json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ============================================================
   NEW: GET /api/tanks/history/search
   search by tank_no + location + date + time, max 30
   Example:
   /api/tanks/history/search?tank_no=BS-7B&location=Battery-2%20WF&date=2025-11-03&time=16:23
   ============================================================ */
router.get("/history/search", async (req, res) => {
  try {
    const tankNo = (req.query.tank_no || "").trim();
    const location = (req.query.location || "").trim();
    const date = (req.query.date || "").trim();   // YYYY-MM-DD
    const time = (req.query.time || "").trim();   // HH:MM
    const limit = Math.min(Number(req.query.limit || 30), 30);

    if (!tankNo || !location) {
      return res.status(400).json({
        ok: false,
        error: "tank_no_and_location_required"
      });
    }

    // build cutoff datetime
    let dtCutoff = null;
    if (date && time) {
      dtCutoff = `${date} ${time}:00`;
    } else if (date) {
      dtCutoff = `${date} 23:59:59`;
    }

    let sql = `
      SELECT device_id, date_time, tank_no, location,
             ultra_height, lidar_height, ul_status
      FROM Transaction_Table
      WHERE tank_no = ?
        AND (location = ? OR location IS NULL)
    `;
    const params = [tankNo, location];

    if (dtCutoff) {
      sql += ` AND date_time <= ? `;
      params.push(dtCutoff);
    }

    sql += ` ORDER BY date_time DESC LIMIT ?; `;
    params.push(limit);

    const [rows] = await pool.query(sql, params);

    const data = rows.map(r => ({
      device_id: r.device_id,
      date_time: r.date_time ? (r.date_time.toISOString?.() ?? r.date_time) : null,
      tank_no: r.tank_no ?? null,
      location: r.location ?? null,
      ultra_height: r.ultra_height ?? null,
      lidar_height: r.lidar_height ?? null,
      ul_status: r.ul_status ?? null
    }));

    res.json({
      ok: true,
      count: data.length,
      tank_no: tankNo,
      location,
      cutoff: dtCutoff,
      data
    });
  } catch (err) {
    console.error("GET /api/tanks/history/search error:", err);
    res.status(500).json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

export default router;
