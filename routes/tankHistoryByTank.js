// routes/tankHistoryByTank.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * Cylindrical horizontal tank volume (partially filled)
 * D = diameter (m)
 * L = length (m)
 * h = depth of water (m)
 * returns m^3
 */
function horizontalCylinderVolume(D, L, h) {
  const R = D / 2;
  if (h <= 0) return 0;
  if (h >= D) return Math.PI * R * R * L;

  const term1 = R * R * Math.acos((R - h) / R);
  const term2 = (R - h) * Math.sqrt(2 * R * h - h * h);
  const area = term1 - term2; // m^2

  return L * area; // m^3
}

/**
 * GET /api/tanks/history
 *
 * Query:
 *  - tank_no (required)
 *  - start   (YYYY-MM-DD, required)
 *  - end     (YYYY-MM-DD, required)
 *  - debug   (=1 optional)
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

    // Fetch from transactions + parameters
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
      return res.json({
        ok: true,
        meta: { tank_no, start, end },
        total_points: 0,
        history: [],
      });
    }

    const history = rows.map((r, idx) => {
      const isFireTank = r.tank_no === "FIRE-TANK";

      // Common fields
      const sensor =
        r.ultra_height != null ? Number(r.ultra_height) : null;
      const tankVolumeL =
        r.tank_volume != null ? Number(r.tank_volume) : 0;

      let volumeL = null;
      let volumePct = null;
      let depth = null;

      // 🔥 FIRE-TANK → use EXACT same rectangular formula as updateData.js
      if (isFireTank && sensor != null) {
        // NOTE: These constants intentionally match updateData.js
        const WIDTH_M = 8.9;     // meters
        const LENGTH_M = 5.15;   // meters
        const MAX_HEIGHT_M = 17.9; // meters (total tank height)

        // water height = total height – distance from top (ultra_height)
        let waterHeightM = MAX_HEIGHT_M - sensor;

        // clamp between 0 and MAX_HEIGHT_M
        if (waterHeightM < 0) waterHeightM = 0;
        if (waterHeightM > MAX_HEIGHT_M) waterHeightM = MAX_HEIGHT_M;

        depth = waterHeightM; // for debug / output

        const volumeM3 = WIDTH_M * LENGTH_M * waterHeightM; // m³
        volumeL = volumeM3 * 1000; // litres

        if (tankVolumeL > 0) {
          volumePct = (volumeL / tankVolumeL) * 100;
        }
      }

      // 🟢 NORMAL CYLINDRICAL TANKS
      if (!isFireTank) {
        const D = Number(r.diameter_breadth ?? 0); // m
        const L = Number(r.length ?? 0);           // m

        if (sensor != null && D > 0 && L > 0) {
          const rawDepth = D - sensor;
          depth = Math.max(0, Math.min(rawDepth, D));

          const volM3 = horizontalCylinderVolume(D, L, depth);
          volumeL = volM3 * 1000; // litres

          if (tankVolumeL > 0) {
            volumePct = (volumeL / tankVolumeL) * 100;
          }
        }
      }

      return {
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
        rows: rows.length,
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
