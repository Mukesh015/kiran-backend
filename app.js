// app.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// ------------------ ROUTES IMPORT ------------------
import tankStatusRouter from "./routes/tankStatus.js";
import transactionsRouter from "./routes/transactions.js";
import tanksRoutes from "./routes/tank.js";
import notificationsRouter from "./routes/notifications.js";
import tankCurrentRouter from "./routes/tankCurrent.js";
import usersRouter from "./routes/users.js";
import tankCardsRouter from "./routes/tankCards.js";
import deviceLatestRouter from "./routes/deviceLatest.js";
import transactionHistoryRouter from "./routes/transactionHistory.js";
import tankDetailsRouter from "./routes/tankDetails.js";
import transactionHistoryBasicRouter from "./routes/transactionHistoryBasic.js";
import tankHistoryByTankRouter from "./routes/tankHistoryByTank.js";
import tankMasterRouter from "./routes/tankMaster.js";
import tankUpdateRouter from "./routes/tankUpdate.js";
import updateInstallationRouter from "./routes/updateInstallation.js";
import updateDataRouter from "./routes/updateData.js";
import authRouter from "./routes/auth.js"; // ✅ auth (username+password, JWT)
import reportsRouter from "./routes/reports.js";
import smsLogRouter from "./routes/smsLog.js";
import userRouter from "./routes/user.js";

dotenv.config();

const app = express();

// -------------------------------------------------------
// MIDDLEWARES
// -------------------------------------------------------
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "DSP Smart Aqua API is running",
  });
});

// -------------------------------------------------------
// ROUTES
// -------------------------------------------------------

// 1) Tank master

app.use("/api/user", userRouter);

app.use("/api/tank-master", tankMasterRouter);

// 2) Notifications (last 15 days from tank_status)
app.use("/api/notifications", notificationsRouter);

// 3) Core tank routes (legacy /api/tank, etc.)
app.use("/api", tanksRoutes);

// 4) Tank cards / status / current / details
app.use("/api/tank-cards", tankCardsRouter);
app.use("/api/tank-status", tankStatusRouter);
app.use("/api/tank-current", tankCurrentRouter);
app.use("/api/tank-details", tankDetailsRouter);

// 5) Device latest
app.use("/api/device-latest", deviceLatestRouter);

// 6) Transactions (MQTT bridge hits this)
app.use("/api/transactions", transactionsRouter);

// 7) Historical data
app.use("/api/transactions-history", transactionHistoryRouter);
app.use("/api/transactions-history/basic", transactionHistoryBasicRouter);

// 8) Historical volume by tank_no + date range
app.use("/api/tanks", tankHistoryByTankRouter);

// 9) Users (old users router, if you still use it)
// app.use("/api/users", usersRouter);

// 10) Tank update
app.use("/api/tank-update", tankUpdateRouter);

// 11) Installation date update
app.use("/api/update-installation", updateInstallationRouter);

// 12) UPDATE-DATA → called from transactions.js to populate tank_status
app.use("/api/update-data", updateDataRouter);

// 13) AUTH (username/password + JWT)
app.use("/api/auth", authRouter);

app.use("/api/tank/logs", reportsRouter);
app.use("/api/tank/sms-logs", smsLogRouter);

// ---------- 404 fallback ----------
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "ROUTE_NOT_FOUND",
    url: req.originalUrl,
  });
});

// ---------- Start server ----------
const port = Number(process.env.API_PORT || process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`API listening on :${port}`);
});

export default app;
