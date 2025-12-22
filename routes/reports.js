import express from "express";
import { pool } from "../db.js";

const reportsRouter = express.Router();

reportsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = (page - 1) * limit;

    /**
     * Base query: get last two records per tank
     */
    const baseQuery = `
      FROM (
        SELECT
          tank_no,
          date_time AS online_time,
          LAG(date_time) OVER (
            PARTITION BY tank_no
            ORDER BY date_time
          ) AS offline_time,
          TIMESTAMPDIFF(
            MINUTE,
            LAG(date_time) OVER (
              PARTITION BY tank_no
              ORDER BY date_time
            ),
            date_time
          ) AS offline_minutes
        FROM Transaction_Table
      ) t
      WHERE offline_time IS NOT NULL
        AND offline_minutes >= 180
    `;

    /**
     * total count (for pagination)
     */
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total ${baseQuery}`
    );

    /**
     * paginated rows
     */
    const [rows] = await pool.query(
      `
      SELECT
        tank_no,
        offline_time,
        online_time,
        offline_minutes
      ${baseQuery}
      ORDER BY offline_time DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    /**
     * format response
     */
    const data = rows.map((r) => {
      const hrs = Math.floor(r.offline_minutes / 60);
      const mins = r.offline_minutes % 60;

      return {
        tankname: r.tank_no,
        offline_time: r.offline_time,
        online_time: r.online_time,
        duration: `${hrs} hr ${mins} min`,
      };
    });

    res.json({
      ok: true,
      pagination: {
        totalRecords: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        limit,
      },
      data,
    });
  } catch (err) {
    console.error("offline logs error:", err);
    res.status(500).json({ ok: false, error: "DB_ERROR_OFFLINE_LOGS" });
  }
});

export default reportsRouter;
