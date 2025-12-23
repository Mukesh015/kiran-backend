import { pool } from "../db.js";
import express from "express";

const smsLogRouter = express.Router();

/**
 * GET high & low level tank alerts
 * One response per tank per user (paginated)
 */
smsLogRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = (page - 1) * limit;

    /* 🔢 total count */
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM tank_status ts
      CROSS JOIN users u
      WHERE ts.tank_alert_message IN ('High level', 'Low level')
        AND ts.disable_alert = 0
    `;

    const [[{ total }]] = await pool.query(countQuery);

    /* 📄 paginated data */
    const dataQuery = `
      SELECT
        ts.id AS tank_status_id,
        ts.tank_no,
        ts.location,
        ts.tank_alert_message,
        ts.current_time,

        u.id AS user_id,
        u.name AS user_name,
        u.phone AS user_phone

      FROM tank_status ts
      CROSS JOIN users u
      WHERE ts.tank_alert_message IN ('High level', 'Low level')
        AND ts.disable_alert = 0
      ORDER BY ts.current_time DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [limit, offset]);

    const response = rows.map((row) => ({
      id: row.tank_status_id,
      tank_name: row.tank_no,
      location: row.location,
      alert: row.tank_alert_message,
      time: row.current_time,
      user: {
        id: row.user_id,
        name: row.user_name,
        phone: row.user_phone,
      },
    }));

    res.status(200).json({
      ok: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: response,
    });
  } catch (error) {
    console.error("SMS LOG ALERT ERROR:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch tank alerts",
    });
  }
});

export default smsLogRouter;
