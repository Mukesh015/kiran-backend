import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

export const pool = mysql.createPool({

  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "root_password_here",
  database: "DSP",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// export const pool = mysql.createPool({
//   host: process.env.DB_HOST,
//   port: Number(process.env.DB_PORT || 3306),
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0
// });
