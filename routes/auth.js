// routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const router = express.Router();

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SUPER_SECRET";
const JWT_EXPIRES_IN = "8h";

// Mask password/hash for safe display
function maskPassword(pwOrHash) {
  if (!pwOrHash) return "*****";
  const s = String(pwOrHash);
  if (s.length <= 4) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(6);
}

// Create JWT token
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.post || "Viewer",
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Middleware: verify JWT from Authorization: Bearer <token>
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res
        .status(401)
        .json({ ok: false, error: "NO_TOKEN", message: "Missing Bearer token" });
    }

    const token = parts[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload; // { id, username, role }
    next();
  } catch (err) {
    console.error("JWT verify error:", err);
    return res
      .status(401)
      .json({ ok: false, error: "INVALID_TOKEN", details: String(err) });
  }
}

/* ----------------------------------------------------------
   POST /api/auth/register
   body: { username, password, post? }

   - checks if username exists
   - hashes password
   - saves to User_Details
   - returns created user (masked password)
---------------------------------------------------------- */
router.post("/register", async (req, res) => {
  try {
    const { username, password, post } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_USERNAME_OR_PASSWORD",
      });
    }

    // Check if username exists
    const [existing] = await pool.query(
      "SELECT id FROM User_Details WHERE username = ? LIMIT 1",
      [username]
    );
    if (existing.length) {
      return res.status(409).json({
        ok: false,
        error: "USERNAME_EXISTS",
      });
    }

    const hashed = await bcrypt.hash(String(password), SALT_ROUNDS);

    const [insert] = await pool.query(
      "INSERT INTO User_Details (username, password, post, created_at) VALUES (?, ?, ?, NOW())",
      [username, hashed, post || "Viewer"]
    );

    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details WHERE id = ? LIMIT 1",
      [insert.insertId]
    );
    const user = rows[0];

    return res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        post: user.post,
        created_at: user.created_at,
        passwordMasked: maskPassword(user.password),
      },
    });
  } catch (err) {
    console.error("POST /api/auth/register error:", err);
    return res.status(500).json({
      ok: false,
      error: "REGISTER_FAILED",
      details: String(err),
    });
  }
});

/* ----------------------------------------------------------
   GET /api/auth/check-username?username=...
   - returns whether username is available or not
---------------------------------------------------------- */
router.get("/check-username", async (req, res) => {
  try {
    const username = req.query.username;

    if (!username) {
      return res
        .status(400)
        .json({ ok: false, error: "USERNAME_REQUIRED" });
    }

    const [rows] = await pool.query(
      "SELECT id FROM User_Details WHERE username = ? LIMIT 1",
      [username]
    );

    const exists = rows.length > 0;

    return res.json({
      ok: true,
      username,
      exists,
    });
  } catch (err) {
    console.error("GET /api/auth/check-username error:", err);
    return res.status(500).json({
      ok: false,
      error: "CHECK_USERNAME_FAILED",
      details: String(err),
    });
  }
});

/* ----------------------------------------------------------
   POST /api/auth/login
   body: { username, password }

   - verifies user & password
   - returns JWT token + user info + masked password
---------------------------------------------------------- */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_USERNAME_OR_PASSWORD",
      });
    }

    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details WHERE username = ? LIMIT 1",
      [username]
    );

    if (!rows.length) {
      return res
        .status(401)
        .json({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    const user = rows[0];

    const match = await bcrypt.compare(String(password), user.password);
    if (!match) {
      return res
        .status(401)
        .json({ ok: false, error: "INVALID_CREDENTIALS" });
    }

    const token = generateToken(user);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        post: user.post,
        role: user.post || "Viewer",
        created_at: user.created_at,
        passwordMasked: maskPassword(user.password),
      },
    });
  } catch (err) {
    console.error("POST /api/auth/login error:", err);
    return res.status(500).json({
      ok: false,
      error: "LOGIN_FAILED",
      details: String(err),
    });
  }
});

/* ----------------------------------------------------------
   GET /api/auth/me
   headers: Authorization: Bearer <token>

   - verifies JWT
   - fetches user from DB
   - returns user info + masked password
---------------------------------------------------------- */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.id;

    const [rows] = await pool.query(
      "SELECT id, username, password, post, created_at FROM User_Details WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    }

    const user = rows[0];

    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        post: user.post,
        role: user.post || "Viewer",
        created_at: user.created_at,
        passwordMasked: maskPassword(user.password),
      },
    });
  } catch (err) {
    console.error("GET /api/auth/me error:", err);
    return res.status(500).json({
      ok: false,
      error: "ME_FAILED",
      details: String(err),
    });
  }
});

export default router;