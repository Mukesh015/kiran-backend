import { pool } from "./db.js";

const seedUsers = async () => {
  try {
    /* 1️⃣ Create table if not exists */
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(15) NOT NULL
      )
    `;

    await pool.query(createTableQuery);
    console.log("✅ users table ensured");

    /* 2️⃣ Insert demo users (idempotent) */
    const insertQuery = `
      INSERT INTO users (id, name, phone) VALUES
        (1, 'Mukesh Gupta', '9876543210'),
        (2, 'Kiran Kumar', '9123456789'),
        (3, 'Rohit Sharma', '9012345678'),
        (4, 'Amit Verma', '9988776655')
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        phone = VALUES(phone)
    `;

    await pool.query(insertQuery);
    console.log("✅ Demo users seeded successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeder failed:", error);
    process.exit(1);
  }
};

seedUsers();
