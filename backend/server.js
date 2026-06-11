// Load environment variables first
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import connectDB from "./config/db.js";

// Import routes
import alertRoutes from "./routes/alertRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import emergencyContactRoutes from "./routes/EmergencyContactRoutes.js";

console.log("🔗 GSCRIPT_URL =", process.env.GSCRIPT_URL);

const app = express();

// Middlewares
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// Connect to MongoDB
connectDB();

// Default root route
app.get("/", (req, res) => {
  res.send("✅ AI Student Safety Backend Running...");
});

// ------------------------
// Mount all API routes
// ------------------------
console.log("📌 Mounting API routes...");

app.use("/api/auth", authRoutes);     // ⭐ Login / Register
app.use("/api/users", userRoutes);    // ⭐ Token + Location update
app.use("/api/alerts", alertRoutes);  // ⭐ SOS Alerts
app.use("/api/emergency-contacts", emergencyContactRoutes); // Emergency Contacts

console.log("✅ All routes mounted successfully");

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
