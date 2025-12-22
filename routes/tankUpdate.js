// routes/tankUpdate.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * Update tank info in:
 *   - tanks_master:  imei, sim, ssid, installation_date, ultrasonic_status (optional)
 *   - tank_specifications: diameter_mm, length_mm, height_mm,
 *                          tank_volume_m3, free_volume_m3,
 *                          upper_safe_limit_pct, lower_safe_limit_pct
 *
 * Accepts values from either query OR JSON body.
 *
 * Example JSON body (POST/PATCH /api/tank-update?debug=1):
 *  {
 *    "tank_no": "BS-7A",
 *    "imei": "8991302401250042741",
 *    "sim": "4274",
 *    "ssid": "Plumule_BS-7A_E05",
 *    "installation_date": "2025-11-20",
 *    "diameter_mm": 2000,
 *    "length_mm": 5050,
 *    "height_mm": 2500,
 *    "tank_volume_m3": 12.7,
 *    "free_volume_m3": 3.4,
 *    "upper_safe_limit_pct": 80,
 *    "lower_safe_limit_pct": 20
 *  }
 *
 * Optional: ?debug=1
 */

function readField(req, name) {
  // Prefer body, fall back to query
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, name)) {
    return req.body[name];
  }
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, name)) {
    return req.query[name];
  }
  return undefined;
}

async function handleTankUpdate(req, res) {
  const debug = req.query.debug === "1";

  // tank_no is mandatory
  const tank_no = readField(req, "tank_no");

  if (!tank_no) {
    return res.status(400).json({
      ok: false,
      error: "tank_no is required",
    });
  }

  // ---------- Collect fields for tanks_master ----------
  const masterFieldMap = {
    imei: "imei",
    sim: "sim",
    ssid: "ssid",
    installation_date: "installation_date",
    ultrasonic_status: "ultrasonic_status", // if you want to update this as well
  };

  const masterUpdates = [];
  const masterParams = [];

  for (const [inputName, columnName] of Object.entries(masterFieldMap)) {
    const value = readField(req, inputName);
    if (value !== undefined) {
      masterUpdates.push(`${columnName} = ?`);
      masterParams.push(value);
    }
  }

  // ---------- Collect fields for tank_specifications ----------
  const specFieldMap = {
    diameter_mm: "diameter_mm",
    length_mm: "length_mm",
    height_mm: "height_mm",
    tank_volume_m3: "tank_volume_m3",
    free_volume_m3: "free_volume_m3",
    upper_safe_limit_pct: "upper_safe_limit_pct",
    lower_safe_limit_pct: "lower_safe_limit_pct",
  };

  const specUpdates = [];
  const specParams = [];

  for (const [inputName, columnName] of Object.entries(specFieldMap)) {
    const value = readField(req, inputName);
    if (value !== undefined) {
      specUpdates.push(`${columnName} = ?`);
      specParams.push(value);
    }
  }

  // If nothing to update, return bad request
  if (masterUpdates.length === 0 && specUpdates.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "NO_FIELDS_TO_UPDATE",
      message: "Provide at least one field to update",
    });
  }

  let masterResult = null;
  let specResult = null;

  // Use pool.getConnection (no pool.promise) 
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // ----- Update tanks_master if needed -----
    if (masterUpdates.length > 0) {
      const masterSql = `
        UPDATE tanks_master
        SET ${masterUpdates.join(", ")}
        WHERE tank_no = ?
      `;
      masterParams.push(tank_no);

      if (debug) {
        console.log("[TANK_UPDATE] master SQL:", masterSql.trim());
        console.log("[TANK_UPDATE] master params:", masterParams);
      }

      const [result] = await conn.query(masterSql, masterParams);
      masterResult = result;
    }

    // ----- Update tank_specifications if needed -----
    if (specUpdates.length > 0) {
      const specSql = `
        UPDATE tank_specifications
        SET ${specUpdates.join(", ")}
        WHERE tank_no = ?
      `;
      specParams.push(tank_no);

      if (debug) {
        console.log("[TANK_UPDATE] spec SQL:", specSql.trim());
        console.log("[TANK_UPDATE] spec params:", specParams);
      }

      const [result] = await conn.query(specSql, specParams);
      specResult = result;
    }

    const masterAffected = masterResult?.affectedRows ?? 0;
    const specAffected = specResult?.affectedRows ?? 0;

    if (masterAffected === 0 && specAffected === 0) {
      // No row matched this tank_no in either table
      await conn.commit();
      if (debug) {
        console.warn("[TANK_UPDATE] No rows updated for tank_no =", tank_no);
      }
      return res.status(404).json({
        ok: false,
        error: "TANK_NOT_FOUND",
        tank_no,
      });
    }

    await conn.commit();

    return res.json({
      ok: true,
      message: "Tank parameters updated successfully",
      tank_no,
      master: masterResult
        ? {
            affectedRows: masterResult.affectedRows,
            changedRows: masterResult.changedRows ?? undefined,
          }
        : null,
      specifications: specResult
        ? {
            affectedRows: specResult.affectedRows,
            changedRows: specResult.changedRows ?? undefined,
          }
        : null,
    });
  } catch (err) {
    await conn.rollback();
    console.error("[TANK_UPDATE] DB error:", err);
    return res.status(500).json({
      ok: false,
      error: "DATABASE_ERROR",
      details: debug ? String(err.message || err) : undefined,
    });
  } finally {
    conn.release();
  }
}

// Support both POST and PATCH for updates, GET for quick testing
router.post("/", handleTankUpdate);
router.patch("/", handleTankUpdate);
router.get("/", handleTankUpdate); // optional: keep if you want debug via query

export default router;
