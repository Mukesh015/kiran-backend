import express from "express";
import { pool } from "../db.js";

const reportsRouter = express.Router();

reportsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = (page - 1) * limit;

    const { tank, startDate, endDate } = req.query;

    const baseQuery = `
      FROM (
        SELECT
          tank_no,
          LAG(date_time) OVER (
            PARTITION BY tank_no
            ORDER BY date_time
          ) AS offline_time,
          date_time AS online_time,
          TIMESTAMPDIFF(
            MINUTE,
            LAG(date_time) OVER (
              PARTITION BY tank_no
              ORDER BY date_time
            ),
            date_time
          ) AS diff_minutes
        FROM Transaction_Table
      ) t
      WHERE offline_time IS NOT NULL
        AND diff_minutes > 15
    `;

    let whereClause = "";
    const params = [];

    if (tank && tank !== "All") {
      whereClause += " AND tank_no = ?";
      params.push(tank);
    }

    if (startDate && endDate) {
      whereClause += " AND DATE(online_time) BETWEEN DATE(?) AND DATE(?)";
      params.push(startDate, endDate);
    }

    // Count
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total ${baseQuery} ${whereClause}`,
      params,
    );

    // Data
    const [rows] = await pool.query(
      `
      SELECT tank_no, offline_time, online_time, diff_minutes
      ${baseQuery}
      ${whereClause}
      ORDER BY offline_time DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), Number(offset)],
    );

    const data = rows.map((r) => {
      const hrs = Math.floor(r.diff_minutes / 60);
      const mins = r.diff_minutes % 60;

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
    res.status(500).json({ ok: false });
  }
});

/**
 * 2️⃣ CSV EXPORT API
 * GET /reports/export?tank=BS 3B&startDate=2026-03-01&endDate=2026-03-10
 */
reportsRouter.get("/export", async (req, res) => {
  try {
    const { tank, startDate, endDate } = req.query;

    /**
     * Step 1: Calculate diff on full dataset
     */
    const baseQuery = `
      FROM (
        SELECT
          tank_no,
          LAG(date_time) OVER (
            PARTITION BY tank_no
            ORDER BY date_time
          ) AS offline_time,
          date_time AS online_time,
          TIMESTAMPDIFF(
            MINUTE,
            LAG(date_time) OVER (
              PARTITION BY tank_no
              ORDER BY date_time
            ),
            date_time
          ) AS diff_minutes
        FROM Transaction_Table
      ) t
      WHERE offline_time IS NOT NULL
        AND diff_minutes > 15
    `;

    /**
     * Step 2: Apply filters AFTER LAG
     */
    let whereClause = "";
    const params = [];

    if (tank && tank !== "All") {
      whereClause += " AND tank_no = ?";
      params.push(tank);
    }

    if (startDate && endDate) {
      whereClause += " AND DATE(online_time) BETWEEN DATE(?) AND DATE(?)";
      params.push(startDate, endDate);
    }

    /**
     * Step 3: Final query
     */
    const query = `
      SELECT tank_no, offline_time, online_time, diff_minutes
      ${baseQuery}
      ${whereClause}
      ORDER BY offline_time DESC
    `;

    const [rows] = await pool.query(query, params);

    /**
     * Step 4: Generate CSV
     */
    let csv = "Tank Name,Offline Time,Online Time,Duration\n";

    rows.forEach((r) => {
      const hrs = Math.floor(r.diff_minutes / 60);
      const mins = r.diff_minutes % 60;

      csv += `${r.tank_no},${r.offline_time},${r.online_time},${hrs} hr ${mins} min\n`;
    });

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=offline-logs.csv",
    );
    res.setHeader("Content-Type", "text/csv");

    res.status(200).send(csv);
  } catch (err) {
    console.error("export error:", err);
    res.status(500).json({
      ok: false,
      error: "CSV_EXPORT_FAILED",
    });
  }
});

export default reportsRouter;
