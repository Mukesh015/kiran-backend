// routes/tankHistoryByTank.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * Volume of a horizontal cylinder partly filled
 * D = diameter (m)
 * L = length (m)
 * h = liquid depth from bottom (m)
 * returns m^3
 */
function horizontalCylinderVolume(D, L, h) {
  const R = D / 2;
  if (h <= 0) return 0;
  if (h >= D) return Math.PI * R * R * L; // full
  const term1 = R * R * Math.acos((R - h) / R);
  const term2 = (R - h) * Math.sqrt(2 * R * h - h * h);
  const area = term1 - term2; // m^2
  return L * area;            // m^3
}

/**
 * GET /api/tanks/history
 *
 * Query params:
 *   - tank_no  (required)
 *   - start    (YYYY-MM-DD, required)
 *   - end      (YYYY-MM-DD, required)
 *   - debug=1  (optional)
 *
 * Uses:
 *   Transaction_Table  (ultra_height, date_time, location, device_id)
 *   Tank_Parameters    (diameter_breadth, length, tank_volume)
 *
 * Returns all points in that date range with:
 *   - water_volume_l      (litres)
 *   - volume_percentage   (% of tank volume)
 */
router.get("/history", async (req, res) => {
  try {
    let { tank_no, start, end, debug } = req.query;

    tank_no = String(tank_no || "").trim();
    start = String(start || "").trim();
    end = String(end || "").trim();

    if (!tank_no || !start || !end) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PARAMS",
        message: "tank_no, start and end are required",
      });
    }

    const startDateTime = `${start} 00:00:00`;
    const endDateTime = `${end} 23:59:59`;

    // IMPORTANT: no tt.id here – Transaction_Table has no id column
    const [rows] = await pool.query(
      `
      SELECT
        tt.device_id,
        tt.tank_no,
        tt.location,
        tt.ultra_height,
        tt.date_time,
        tp.diameter_breadth,
        tp.length,
        tp.tank_volume
      FROM Transaction_Table tt
      JOIN Tank_Parameters tp
        ON tp.tank_no = tt.tank_no
      WHERE tt.tank_no = ?
        AND tt.date_time BETWEEN ? AND ?
      ORDER BY tt.date_time ASC;
      `,
      [tank_no, startDateTime, endDateTime]
    );

    console.log(
      `[TANK_HISTORY] tank_no=${tank_no}, rows=${rows.length}, range=${startDateTime} -> ${endDateTime}`
    );

    if (!rows.length) {
      const resp = {
        ok: true,
        meta: { tank_no, start, end },
        total_points: 0,
        history: [],
      };

      if (debug === "1") {
        resp.debug = {
          startDateTime,
          endDateTime,
          rowCount: 0,
        };
      }

      return res.json(resp);
    }

    const history = rows.map((r, idx) => {
      const D = Number(r.diameter_breadth ?? 0); // m
      const L = Number(r.length ?? 0);           // m
      const sensor =
        r.ultra_height != null ? Number(r.ultra_height) : null; // m
      const tankVolumeL =
        r.tank_volume != null ? Number(r.tank_volume) : 0;      // L

      // depth of water from bottom (sensor on top)
      let depth = null;
      if (sensor != null && D > 0) {
        depth = D - sensor;
        if (depth < 0) depth = 0;
        if (depth > D) depth = D;
      }

      let volumeL = null;
      let volumePct = null;

      if (depth != null && D > 0 && L > 0) {
        const volM3 = horizontalCylinderVolume(D, L, depth);
        volumeL = volM3 * 1000; // m^3 → litres
        if (tankVolumeL > 0) {
          volumePct = (volumeL / tankVolumeL) * 100;
        }
      }

      return {
        // local id for frontend – not from DB
        id: idx + 1,

        device_id: r.device_id,
        tank_no: r.tank_no,
        location: r.location,
        date_time: r.date_time,

        ultra_height_m: sensor,
        water_depth_m: depth,

        tank_volume_l: tankVolumeL,
        water_volume_l:
          volumeL != null ? Number(volumeL.toFixed(1)) : null,
        volume_percentage:
          volumePct != null ? Number(volumePct.toFixed(1)) : null,
      };
    });

    const response = {
      ok: true,
      meta: { tank_no, start, end },
      total_points: history.length,
      history,
    };

    if (debug === "1") {
      response.debug = {
        startDateTime,
        endDateTime,
        rowCount: rows.length,
        firstRow: history[0],
      };
    }

    return res.json(response);
  } catch (err) {
    console.error("GET /api/tanks/history error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      details: String(err),
    });
  }
});

export default router;
