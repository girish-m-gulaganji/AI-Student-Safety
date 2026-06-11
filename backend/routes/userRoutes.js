import express from "express";
import User from "../models/userModel.js";

const router = express.Router();

/*
  POST /api/users/update-token
  Body:
  {
    userId: "HUZAIFA001",
    deviceToken: "ExponentPushToken[xxxxxx]",
    location: {
      latitude: 12.34,
      longitude: 56.78
    }
  }
*/

router.post("/update-token", async (req, res) => {
  try {
    const { userId, deviceToken, location } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId required",
      });
    }

    const updateData = {};

    // device token
    if (typeof deviceToken === "string" && deviceToken.trim() !== "") {
      updateData.deviceToken = deviceToken;
    }

    // location
    if (
      location &&
      typeof location.latitude === "number" &&
      typeof location.longitude === "number"
    ) {
      updateData.lastLocation = {
        latitude: location.latitude,
        longitude: location.longitude,
        updatedAt: new Date(),
      };
    }

    const updatedUser = await User.findOneAndUpdate(
      { userId },
      { $set: updateData },
      { new: true, upsert: true }
    );

    return res.json({ success: true, user: updatedUser });

  } catch (err) {
    console.error("❌ update-token error", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Test route
router.get("/test", (req, res) => {
  res.send("✅ User route working");
});

export default router;
