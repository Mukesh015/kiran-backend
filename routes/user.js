import { pool } from "../db.js";
import express from "express";

const userRouter = express.Router();

userRouter.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, phone FROM users");
    res.status(200).json({
      ok: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("USER FETCH ERROR:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch users",
    });
  }
});

userRouter.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;

    if (!name && !phone) {
      return res.status(400).json({
        ok: false,
        message: "At least one field (name or phone) is required",
      });
    }

    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }

    if (phone) {
      fields.push("phone = ?");
      values.push(phone);
    }

    values.push(id);

    const query = `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE id = ?
    `;

    const [result] = await pool.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      ok: true,
      message: "User updated successfully",
    });
  } catch (error) {
    console.error("UPDATE USER ERROR:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to update user",
    });
  }
});

export default userRouter;
