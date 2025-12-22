// routes/updateData.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * Helper: volume of a horizontal cylinder segment (litres)
 * D, L, h are in meters.
 * D = diameter, L = length, h = liquid depth from the bottom.
 */
function horizontalCylinderVolumeLitres(D, L, h) {
  const Dnum = Number(D);
  const Lnum = Number(L);
  let hnum = Number(h);

  if (
    !Number.isFinite(Dnum) ||
    !Number.isFinite(Lnum) ||
    !Number.isFinite(hnum)
  ) {
    return 0;
  }

  if (Dnum <= 0 || Lnum <= 0) return 0;
  if (hnum <= 0) return 0;

  const r = Dnum / 2;

  // Clamp h between 0 and 2r
  if (hnum < 0) hnum = 0;
  if (hnum > 2 * r) hnum = 2 * r;

  // Area of circular segment
  const areaSegment =
    r * r * Math.acos((r - hnum) / r) -
    (r - hnum) * Math.sqrt(2 * r * hnum - hnum * hnum);

  const volumeM3 = areaSegment * Lnum;
  return volumeM3 * 1000; // m³ → litres
}

/**
 * POST /api/update-data
 * Called from /api/transactions and can also be called manually from Postman.
 * Only tank_no is mandatory; location is optional.
 */
router.post("/", async (req, res) => {
  try {
    const {
      device_id,
      tank_no,
      location,
      ultra_height,
      date_time,
      installation_date, // accepted but not used here
    } = req.body || {};

    // 🔸 Only tank_no is mandatory
    if (!tank_no) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_FIELDS",
        message: "tank_no is required in update-data",
      });
    }

    // Normalized tank number (for comparisons like FIRE-TANK)
    const tankNoTrimmed =
      typeof tank_no === "string" ? tank_no.trim() : tank_no;

    // ----------------------------------------------------
    // 0) Resolve location if not provided
    // ----------------------------------------------------
    let locValue = location ?? null;

    if (locValue == null) {
      // 0a) Try last location from tank_status
      const [statusRows] = await pool.query(
        `
          SELECT location
          FROM tank_status
          WHERE tank_no = ?
          ORDER BY id DESC
          LIMIT 1;
        `,
        [tank_no]
      );
      if (statusRows.length > 0 && statusRows[0].location != null) {
        locValue = statusRows[0].location;
      }
    }

    if (locValue == null) {
      // 0b) Try last location from Transaction_Table
      const [txRows] = await pool.query(
        `
          SELECT location
          FROM Transaction_Table
          WHERE tank_no = ?
          ORDER BY date_time DESC
          LIMIT 1;
        `,
        [tank_no]
      );
      if (txRows.length > 0 && txRows[0].location != null) {
        locValue = txRows[0].location;
      }
    }

    if (locValue == null) {
      // 0c) Final fallback – must NOT be NULL because column is NOT NULL
      locValue = "Unknown";
    }

    // ----------------------------------------------------
    // 1) Fetch tank parameters
    // ----------------------------------------------------
    const [paramRows] = await pool.query(
      `
        SELECT
          tank_no,
          diameter_breadth,
          length,
          tank_volume,
          upper_safe_limit_pct,
          lower_safe_limit_pct
        FROM Tank_Parameters
        WHERE tank_no = ?
        LIMIT 1;
      `,
      [tank_no]
    );

    if (paramRows.length === 0) {
      console.warn(
        "[update-data] No Tank_Parameters row for tank_no:",
        tank_no
      );
    }

    const params = paramRows[0] || {};
    const D = params.diameter_breadth;
    const L = params.length;
    const capacityLitres = Number(params.tank_volume) || 0;
    const upperSafeLitres = Number(params.upper_safe_limit_pct) || 0;
    const lowerSafeLitres = Number(params.lower_safe_limit_pct) || 0;

    // ----------------------------------------------------
    // 2) Compute depth, volume & fill%
    // ----------------------------------------------------
    const ultraH = Number(ultra_height);
    let currentLevelLitres = 0;
    let fillPercentage = 0;

    // 🔥 SPECIAL CASE: FIRE-TANK → rectangular calculation
    if (tankNoTrimmed === "FIRE-TANK" && Number.isFinite(ultraH)) {
      const WIDTH_M = 8.9; // meters
      const LENGTH_M = 5.15; // meters
      const MAX_HEIGHT_M = 17.9; // meters (total tank height)

      // water height = total height – distance from top
      let waterHeightM = MAX_HEIGHT_M - ultraH;

      // clamp water height in [0, MAX_HEIGHT_M]
      if (waterHeightM < 0) waterHeightM = 0;
      if (waterHeightM > MAX_HEIGHT_M) waterHeightM = MAX_HEIGHT_M;

      const volumeM3 = WIDTH_M * LENGTH_M * waterHeightM; // m³
      currentLevelLitres = volumeM3 * 1000; // L

      if (capacityLitres > 0) {
        fillPercentage = (currentLevelLitres / capacityLitres) * 100;
      }

      console.log("[update-data] FIRE-TANK rectangular calc:", {
        ultraH,
        waterHeightM,
        volumeM3,
        currentLevelLitres,
        capacityLitres,
        fillPercentage,
      });
    } else if (Number.isFinite(ultraH) && D != null && L != null) {
      // 🌐 DEFAULT horizontal cylinder for all other tanks
      const depth = Math.max(0, Number(D) - ultraH);
      currentLevelLitres = horizontalCylinderVolumeLitres(D, L, depth);

      if (capacityLitres > 0) {
        fillPercentage = (currentLevelLitres / capacityLitres) * 100;
      }
    }

    // ----------------------------------------------------
    // 3) Decide status & alert using safe limits
    // ----------------------------------------------------
    let flowStatus = "Normal";
    let tankStatus = "OK";
    let tankAlertMessage = "Normal";

    if (!Number.isFinite(ultraH)) {
      tankStatus = "No Data";
      tankAlertMessage = "No valid level";
      flowStatus = "Inactive";
    } else if (capacityLitres > 0) {
      if (upperSafeLitres > 0 && currentLevelLitres >= upperSafeLitres) {
        tankStatus = "Warning";
        tankAlertMessage = "High level";
      } else if (
        lowerSafeLitres > 0 &&
        currentLevelLitres <= lowerSafeLitres
      ) {
        tankStatus = "Warning";
        tankAlertMessage = "Low level";
      } else {
        tankStatus = "OK";
        tankAlertMessage = "Normal";
      }
    } else {
      // No capacity known; basic low-level check
      if (ultraH <= 0) {
        tankStatus = "Warning";
        tankAlertMessage = "Low level";
      }
    }

    // ----------------------------------------------------
    // 4) Insert into tank_status
    // ----------------------------------------------------
    const sql = `
      INSERT INTO tank_status (
        tank_no,
        location,
        currentLevel,
        fillPercentage,
        flowStatus,
        tank_status,
        tank_alert_message,
        under_maintenance,
        disable_alert
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 0, 0
      );
    `;

    const insertParams = [
      tank_no,
      locValue, // <-- guaranteed NON-NULL now
      currentLevelLitres,
      Number.isFinite(fillPercentage) ? fillPercentage : 0,
      flowStatus,
      tankStatus,
      tankAlertMessage,
    ];

    console.log("[update-data] tank_status insert:", {
      tank_no,
      location: locValue,
      currentLevelLitres,
      fillPercentage,
      flowStatus,
      tankStatus,
      tankAlertMessage,
    });

    const [result] = await pool.query(sql, insertParams);

    return res.json({
      ok: true,
      insertedRows: result.affectedRows,
      message: "tank_status updated from update-data",
      debug: {
        capacityLitres,
        upperSafeLitres,
        lowerSafeLitres,
        currentLevelLitres,
        fillPercentage,
        location: locValue,
      },
    });
  } catch (err) {
    console.error("[update-data] ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "UPDATE_DATA_FAILED",
      details: err.message,
    });
  }
});

export default router;
