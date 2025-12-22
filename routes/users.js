// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const router = express.Router();
const SALT_ROUNDS = 10;

/* -----------------------
   Helper: mask password
   show first 2 chars then '***' (never reveal full hash)
   ----------------------- */
function maskPassword(pwOrHash) {
  if (!pwOrHash) return "*****";
  const s = String(pwOrHash);
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(3);
}

/* -----------------------
   Simple auth shim (demo)
   Reads role/id/username from headers
   ----------------------- */
function authFromHeaders(req, _res, next) {
  const role = req.header("x-user-role") || null;
  const id = req.header("x-user-id") || null;
  const username = req.header("x-username") || null;
  req.auth = {
    role,
    id: id ? Number(id) : null,
    username: username || null,
  };
  next();
}

/* -----------------------
   requireAdmin middleware
   ----------------------- */
function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== "Admin") {
    return res.status(403).json({ ok: false, error: "FORBIDDEN_ADMIN_ONLY" });
  }
  next();
}

/* -----------------------
   format user for response (always mask password)
   ----------------------- */
function formatUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    post: row.post,
    created_at: row.created_at,
    password: maskPassword(row.password),
  };
}

/* apply auth shim to all routes in router */
router.use(authFromHeaders);

/* ==========================================================
   1) LOGIN API  (NO ADMIN CHECK)
   ========================================================== */

/* ----------------------------------------------------------
   POST /api/users/login
   body: { username, password }

   Flow:
   - Find user by username
   - Compare bcrypt hash
   - If ok => return user info (without password)
             and "suggested headers" for future API calls
   ---------------------------------------------------------- */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "MISSING_USERNAME_OR_PASSWORD" });
    }

    // 1) Find user in DB
    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details WHERE username = ? LIMIT 1",
      [username]
    );

    if (!rows.length) {
      // don't reveal which part is wrong
      return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    const user = rows[0];

    // 2) Check password using bcrypt
    const match = await bcrypt.compare(String(password), user.password);
    if (!match) {
      return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    // 3) Decide role (using your "post" column)
    const role = user.post || "Viewer";

    // 4) Respond with safe user info + what headers to send next time
    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        post: user.post,
        role, // same as post for now
        created_at: user.created_at,
      },
      // front-end can store these and send as headers later
      nextRequestHeaders: {
        "x-user-role": role,
        "x-user-id": String(user.id),
        "x-username": user.username,
      },
    });
  } catch (err) {
    console.error("POST /api/users/login error:", err);
    return res.status(500).json({
      ok: false,
      error: "LOGIN_FAILED",
      details: String(err),
    });
  }
});

/* ==========================================================
   2) SPECIAL ROUTES (must be before "/:id")
   ========================================================== */

/* ----------------------------------------------------------
   GET /api/users/login-raw
   Admin only.
   Returns: [{ username, password }] (hash from DB)
   ---------------------------------------------------------- */
router.get("/login-raw", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT username, password FROM User_Details ORDER BY id ASC"
    );

    res.json({
      ok: true,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("GET /api/users/login-raw error:", err);
    res
      .status(500)
      .json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ----------------------------------------------------------
   GET /api/users
   - Returns all users (masked password)
   ---------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details ORDER BY id ASC"
    );
    const data = rows.map(formatUserRow);
    res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error("GET /api/users error:", err);
    res
      .status(500)
      .json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ----------------------------------------------------------
   GET /api/users/:id
   ---------------------------------------------------------- */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    // if id is not a positive number, treat as not found
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details WHERE id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    res.json({ ok: true, user: formatUserRow(rows[0]) });
  } catch (err) {
    console.error("GET /api/users/:id error:", err);
    res
      .status(500)
      .json({ ok: false, error: "DB_READ_FAILED", details: String(err) });
  }
});

/* ----------------------------------------------------------
   POST /api/users  (Admin only)
   ---------------------------------------------------------- */
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { username, password, post } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_USERNAME_OR_PASSWORD",
      });
    }

    const [existing] = await pool.query(
      "SELECT id FROM User_Details WHERE username = ? LIMIT 1",
      [username]
    );
    if (existing.length) {
      return res.status(409).json({ ok: false, error: "USERNAME_EXISTS" });
    }

    const hashed = await bcrypt.hash(String(password), SALT_ROUNDS);

    const [insert] = await pool.query(
      "INSERT INTO User_Details (username, password, post, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
      [username, hashed, post || "Viewer"]
    );

    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details WHERE id = ? LIMIT 1",
      [insert.insertId]
    );

    res.status(201).json({
      ok: true,
      insertedId: insert.insertId,
      user: formatUserRow(rows[0]),
    });
  } catch (err) {
    console.error("POST /api/users error:", err);
    res
      .status(500)
      .json({ ok: false, error: "DB_WRITE_FAILED", details: String(err) });
  }
});

/* ----------------------------------------------------------
   PUT /api/users/:id  (Admin only)
   ---------------------------------------------------------- */
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }

    const { password, post } = req.body || {};
    const updates = [];
    const params = [];

    if (typeof password !== "undefined") {
      const hashed = await bcrypt.hash(String(password), SALT_ROUNDS);
      updates.push("password = ?");
      params.push(hashed);
    }

    if (typeof post !== "undefined") {
      updates.push("post = ?");
      params.push(post);
    }

    if (!updates.length) {
      return res
        .status(400)
        .json({ ok: false, error: "NO_FIELDS_TO_UPDATE" });
    }

    params.push(id);
    const sql = `UPDATE User_Details SET ${updates.join(", ")} WHERE id = ?`;
    const [result] = await pool.query(sql, params);
    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (err) {
    console.error("PUT /api/users/:id error:", err);
    res
      .status(500)
      .json({ ok: false, error: "DB_WRITE_FAILED", details: String(err) });
  }
});

/* ----------------------------------------------------------
   DELETE /api/users/:id  (Admin only)
   ---------------------------------------------------------- */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }

    const [result] = await pool.query(
      "DELETE FROM User_Details WHERE id = ?",
      [id]
    );
    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (err) {
    console.error("DELETE /api/users/:id error:", err);
    res
      .status(500)
      .json({ ok: false, error: "DB_WRITE_FAILED", details: String(err) });
  }
});

export default router;
/* ----------------------------------------------------------
   End of users.js
   ---------------------------------------------------------- */
