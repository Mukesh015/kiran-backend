// routes/tankMaster.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * GET /api/tank-master
 *
 * Uses:
 *   - tanks_master      : SIM / IMEI / SSID / installation / ultrasonic
 *   - Tank_Parameters   : tank_volume, upper_safe_limit_pct, lower_safe_limit_pct
 *
 * Returns one combined row per tank.
 */
router.get("/", async (req, res) => {
  const debug = req.query.debug === "1";

  const sql = `
    SELECT
      tm.id,
      tm.serial_no,
      tm.tank_no                       AS tank_name,
      tm.sim                           AS sim_number,
      tm.imei                          AS imei_number,
      tm.ssid,
      tm.ultrasonic_status,
      tm.installation_date,

      -- From Tank_Parameters
      tp.tank_volume,
      tp.upper_safe_limit_pct          AS safe_max_level_l,
      tp.lower_safe_limit_pct          AS safe_min_level_l

    FROM tanks_master tm
    LEFT JOIN Tank_Parameters tp
      ON tm.tank_no = tp.tank_no
    ORDER BY tm.serial_no ASC
  `;

  try {
    if (debug) {
      console.log("[tank-master][GET] SQL =", sql.trim());
    }

    const [rows] = await pool.query(sql);

    if (debug) {
      console.log("[tank-master][GET] rows =", rows.length);
      if (rows.length > 0) {
        console.log("[tank-master][GET] sample row =", rows[0]);
      }
    }

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error("[tank-master][GET] ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "DB_ERROR",
      details: debug ? String(err.message || err) : undefined,
    });
  }
});

/**
 * POST /api/tank-master
 *
 * Body (JSON):
 * {
 *   "tank_no": "CS21",
 *   "sim_number": "...",          // optional
 *   "imei_number": "...",         // optional
 *   "ssid": "...",                // optional
 *   "ultrasonic_status": "...",   // optional
 *   "safe_max_level_l": 1287.26,  // HIGH limit  (Tank_Parameters.upper_safe_limit_pct)
 *   "safe_min_level_l": 1094.54,  // LOW limit   (Tank_Parameters.lower_safe_limit_pct)
 *   "installation_date": "2025-11-25"  // optional
 * }
 *
 * This:
 *   1) UPSERTs into tanks_master  (SIM/IMEI/SSID/ultrasonic/install)
 *   2) UPSERTs into Tank_Parameters (only safe limits)
 */
router.post("/", async (req, res) => {
  const debug = req.query.debug === "1";
  const body = req.body || {};

  const {
    tank_no,
    sim_number,
    imei_number,
    ssid,
    ultrasonic_status,
    safe_max_level_l,
    safe_min_level_l,
    installation_date,
  } = body;

  // ---------- Basic validation ----------
  if (!tank_no || typeof tank_no !== "string" || !tank_no.trim()) {
    return res.status(400).json({
      ok: false,
      error: "TANK_NO_REQUIRED",
    });
  }

  const trimTankNo = tank_no.trim();

  const toNullableNumber = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };

  const safeMax = toNullableNumber(safe_max_level_l);
  const safeMin = toNullableNumber(safe_min_level_l);

  const installDate =
    installation_date && String(installation_date).trim() !== ""
      ? String(installation_date).trim()
      : null;

  if (debug) {
    console.log("[tank-master][POST] payload =", {
      tank_no: trimTankNo,
      sim_number,
      imei_number,
      ssid,
      ultrasonic_status,
      safeMax,
      safeMin,
      installDate,
    });
  }

  // ======================================================
  // 1) UPSERT INTO tanks_master
  // ======================================================
  const sqlMaster = `
    INSERT INTO tanks_master (
      tank_no,
      sim,
      imei,
      ssid,
      ultrasonic_status,
      installation_date
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sim               = VALUES(sim),
      imei              = VALUES(imei),              -- ✅ FIXED: imei, not "ime"
      ssid              = VALUES(ssid),
      ultrasonic_status = VALUES(ultrasonic_status),
      installation_date = VALUES(installation_date)
  `;

  const paramsMaster = [
    trimTankNo,
    sim_number || null,
    imei_number || null,
    ssid || null,
    ultrasonic_status || null,
    installDate,
  ];

  // ======================================================
  // 2) UPSERT INTO Tank_Parameters (only safe limits)
  // ======================================================
  const sqlParams = `
    INSERT INTO Tank_Parameters (
      tank_no,
      upper_safe_limit_pct,
      lower_safe_limit_pct
    )
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      upper_safe_limit_pct = VALUES(upper_safe_limit_pct),
      lower_safe_limit_pct = VALUES(lower_safe_limit_pct)
  `;

  const paramsParams = [trimTankNo, safeMax, safeMin];

  try {
    if (debug) {
      console.log("[tank-master][POST] SQL master =", sqlMaster.trim());
      console.log("[tank-master][POST] params master =", paramsMaster);
      console.log("[tank-master][POST] SQL params =", sqlParams.trim());
      console.log("[tank-master][POST] params params =", paramsParams);
    }

    // Run both queries
    const [resMaster] = await pool.query(sqlMaster, paramsMaster);
    const [resParams] = await pool.query(sqlParams, paramsParams);

    if (debug) {
      console.log("[tank-master][POST] result master =", resMaster);
      console.log("[tank-master][POST] result params =", resParams);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[tank-master][POST] ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "DB_ERROR",
      details: debug ? String(err.message || err) : undefined,
    });
  }
});

export default router;
