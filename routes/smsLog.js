import { pool } from "../db.js";
import express from "express";

const smsLogRouter = express.Router();

smsLogRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = (page - 1) * limit;

    /* ==========================
       TOTAL COUNT (LATEST ALERTS)
    ========================== */
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM (
        SELECT 1
        FROM tank_status ts
        WHERE ts.tank_alert_message IN ('High level', 'Low level')
          AND ts.disable_alert = 0
        GROUP BY ts.tank_no, ts.tank_alert_message
      ) x
    `;

    const [[{ total }]] = await pool.query(countQuery);

    /* ==========================
       DATA (LATEST ALERT × USERS)
    ========================== */
    const dataQuery = `
      SELECT
        t.id,
        t.tank_no,
        t.location,
        t.tank_alert_message,
        t.current_time,

        u.id    AS user_id,
        u.name  AS user_name,
        u.phone AS user_phone

      FROM (
        SELECT
          ts.*,
          ROW_NUMBER() OVER (
            PARTITION BY ts.tank_no, ts.tank_alert_message
            ORDER BY ts.current_time DESC
          ) AS rn
        FROM tank_status ts
        WHERE ts.tank_alert_message IN ('High level', 'Low level')
          AND ts.disable_alert = 0
      ) t
      CROSS JOIN users u
      WHERE t.rn = 1
      ORDER BY t.current_time DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [limit, offset]);

    /* ==========================
       RESPONSE (YOUR STRUCTURE)
    ========================== */
    const response = rows.map((row) => ({
      id: row.id,
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
