// routes/updateInstallation.js
import express from "express";
import { pool } from "../db.js";

const router = express.Router();

/**
 * PATCH /api/update-installation
 *
 * Accepts:
 *  - Query params: ?tank_no=BS-7A&installation_date=2025-11-20
 *  - OR JSON body: { "tank_no": "BS-7A", "installation_date": "2025-11-20" }
 *
 * Optional: ?debug=1
 */
router.post("/", async (req, res) => {
  const debug = req.query.debug === "1";

  // Read from query first, then body
  const tank_no =
    req.query.tank_no ||
    (req.body && req.body.tank_no) ||
    null;

  const installation_date =
    req.query.installation_date ||
    (req.body && req.body.installation_date) ||
    null;

  if (!tank_no) {
    return res.status(400).json({
      ok: false,
      error: "tank_no is required",
    });
  }

  if (!installation_date) {
    return res.status(400).json({
      ok: false,
      error: "installation_date is required",
    });
  }

  const sql = `
    UPDATE tanks_master
    SET installation_date = ?
    WHERE tank_no = ?
  `;

  try {
    if (debug) {
      console.log("[update-installation] SQL =", sql.trim());
      console.log("[update-installation] params =", [installation_date, tank_no]);
    }

    const [result] = await pool.query(sql, [installation_date, tank_no]);

    if (debug) {
      console.log("[update-installation] affectedRows =", result.affectedRows);
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        error: "TANK_NOT_FOUND",
        tank_no,
      });
    }

    return res.json({
      ok: true,
      message: "installation_date updated",
      tank_no,
      installation_date,
    });
  } catch (err) {
    console.error("[update-installation] ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "DB_ERROR",
      details: debug ? String(err.message || err) : undefined,
    });
  }
});

export default router;
