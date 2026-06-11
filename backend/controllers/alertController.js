// backend/controllers/alertController.js
import Alert from "../models/alertModel.js";
import User from "../models/userModel.js";
import { sendExpoPush } from "../utils/fcm.js"; // make sure this file exports sendExpoPush
import { sendAlertEmail } from "../utils/mailer.js"; // optional - keep if implemented
import Twilio from "twilio";
import { config } from "../config/index.js";

import EmergencyContactController from "./EmergencyContactController.js";
const notifyEmergencyContacts = EmergencyContactController.notifyEmergencyContacts;

const twilioClient =
  config?.twilio?.accountSid && config?.twilio?.authToken
    ? Twilio(config.twilio.accountSid, config.twilio.authToken)
    : null;

// -------------------------
// Helpers
// -------------------------
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Haversine (meters)
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function minimalSmsText(alert) {
  const user = alert.userId || "unknown";
  return `🚨 Emergency Alert: ${user} — Check email/app for details.`;
}

function fullSmsBody(alert) {
  const user = alert.userId || "unknown";
  const msg = (alert.message || "(no message)").toString();
  const lat = alert.location?.latitude;
  const lon = alert.location?.longitude;
  const hasCoords = typeof lat === "number" && typeof lon === "number";
  const timeStr = alert.createdAt
    ? new Date(alert.createdAt).toLocaleString()
    : new Date().toLocaleString();
  const lines = [];
  lines.push(`🚨 Emergency Alert: ${user}`);
  lines.push("AI Student Safety <aistudentsafety@gmail.com>");
  lines.push(timeStr);
  lines.push("");
  lines.push(`User: ${user}`);
  lines.push(`Time: ${timeStr}`);
  if (hasCoords) lines.push(`Location: ${lat}, ${lon} — Open in Google Maps`);
  lines.push("");
  lines.push(`Message: ${msg}`);
  return lines.join("\n");
}

/**
 * Send a short fallback SMS via Twilio (if configured).
 * Marks alert.sms.fallbackSent = true when sent.
 */
async function sendFallbackForAlert(alert) {
  if (!twilioClient) {
    console.warn("Twilio not configured; skipping fallback SMS");
    return null;
  }
  const to =
    config.alerts?.smsReceiver ||
    process.env.ALERT_SMS_RECEIVER ||
    alert.sms?.to ||
    null;
  const from = config.twilio?.fromNumber || null;
  if (!to || !from) {
    console.warn("Twilio to/from not configured; skipping fallback SMS");
    return null;
  }

  const body = minimalSmsText(alert);
  try {
    const msg = await twilioClient.messages.create({ body, from, to });
    alert.sms = alert.sms || {};
    alert.sms.fallbackSent = true;
    alert.sms.updatedAt = new Date();
    await alert.save();
    console.log("Fallback SMS sent", msg.sid, "to", to);
    return msg;
  } catch (err) {
    console.error("Fallback SMS error:", err?.message || err);
    throw err;
  }
}

/**
 * Send SMS (full body) using Twilio if available.
 * Returns Twilio message object or null.
 */
export async function sendSms(to, body) {
  if (!twilioClient) {
    console.warn("Twilio not configured; skipping SMS to", to);
    return null;
  }
  if (!config.twilio?.fromNumber) {
    console.warn("Twilio from number not configured; skipping SMS to", to);
    return null;
  }
  try {
    const createOpts = { body, from: config.twilio.fromNumber, to };
    if (process.env.TWILIO_STATUS_CALLBACK) {
      createOpts.statusCallback = process.env.TWILIO_STATUS_CALLBACK;
    }
    const msg = await twilioClient.messages.create(createOpts);
    console.log("SMS create response:", {
      sid: msg.sid,
      status: msg.status,
      to: msg.to,
      from: msg.from,
    });
    return msg;
  } catch (err) {
    console.error("Twilio send error:", err?.message || err);
    throw err;
  }
}

// -------------------------
// Controller: createAlert
// -------------------------
export const createAlert = async (req, res) => {
  try {
    const bodyUserId = req.body?.userId;
    const userId = req.user?.id || bodyUserId;
    const { location, message } = req.body;

    if (!userId) return res.status(400).json({ success: false, error: "userId required (auth)" });
    if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number") {
      return res.status(400).json({ success: false, error: "Valid location required" });
    }
    if (!message) {
      return res.status(400).json({ success: false, error: "message required" });
    }

    // Save alert
    const alert = new Alert({ userId, location, message });
    await alert.save();

    // 1) Send email (non-blocking - log failures)
    (async () => {
      try {
        if (typeof sendAlertEmail === "function") {
          await sendAlertEmail({
            userId,
            latitude: location.latitude,
            longitude: location.longitude,
            message,
            createdAt: alert.createdAt,
          });
          console.log("📧 Alert email sent");
        }
      } catch (e) {
        console.error("📧 Email send failed:", e?.message || e);
      }
    })();

    // 🔔 Notify Emergency Contacts
(async () => {
  try {
    await notifyEmergencyContacts(userId, location);
  } catch (e) {
    console.error("Emergency contact SMS failed:", e);
  }
})();


    // 2) Send short SMS (best-effort) and save metadata
    (async () => {
      try {
        const smsTo = config.alerts?.smsReceiver || process.env.ALERT_SMS_RECEIVER || null;
        if (smsTo) {
          const smsBody = minimalSmsText(alert);
          try {
            const msg = await sendSms(smsTo, smsBody);
            if (msg) {
              alert.sms = {
                sid: msg.sid,
                status: msg.status,
                to: msg.to,
                from: msg.from,
                errorCode: msg.errorCode,
                errorMessage: msg.errorMessage,
                updatedAt: new Date(),
                fallbackSent: false,
              };
              await alert.save();
              // If Twilio reports failed immediately, trigger fallback
              if ((msg.status === "failed" || msg.status === "undelivered") || msg.errorCode) {
                try {
                  await sendFallbackForAlert(alert);
                } catch (fbErr) {
                  console.error("Fallback send failed (immediate):", fbErr?.message || fbErr);
                }
              }
            }
          } catch (smsErr) {
            console.error("SMS send failed:", smsErr?.message || smsErr);
            try {
              await sendFallbackForAlert(alert);
            } catch (fbErr) {
              console.error("Fallback send failed (catch):", fbErr?.message || fbErr);
            }
          }
        } else {
          console.log("No SMS receiver configured, skipping SMS");
        }
      } catch (e) {
        console.error("Unexpected SMS workflow error:", e?.message || e);
      }
    })();

    // 3) Hyperlocal push: find nearby users and send expo pushes
    try {
      const RADIUS_METERS = Number(process.env.RADIUS_METERS || 1000); // default 1000m
      const lat1 = Number(location.latitude);
      const lon1 = Number(location.longitude);

      // Find candidate users that have lastLocation and deviceToken
      const candidates = await User.find({
        "lastLocation.latitude": { $exists: true },
        "lastLocation.longitude": { $exists: true },
        deviceToken: { $exists: true, $ne: null },
      }).lean();

      const tokensToNotify = [];

      for (const u of candidates) {
        try {
          if (!u.lastLocation) continue;
          const lat2 = Number(u.lastLocation.latitude);
          const lon2 = Number(u.lastLocation.longitude);
          const d = distanceMeters(lat1, lon1, lat2, lon2);
          if (d <= RADIUS_METERS) {
            // avoid notifying the alert originator (if present)
            // avoid notifying the alert originator (supports legacy userId or ObjectId)
            if (u.userId && userId && String(u.userId) === String(userId)) continue;
            if (u._id && userId && String(u._id) === String(userId)) continue;
            if (u.deviceToken) tokensToNotify.push(u.deviceToken);
          }
        } catch (inner) {
          console.warn("Distance compute error for user", u._id, inner?.message || inner);
        }
      }

      if (tokensToNotify.length > 0) {
        try {
          await sendExpoPush(
            tokensToNotify,
            "🚨 Emergency Nearby",
            "Someone nearby triggered an SOS. Open the app for details.",
            { alertId: String(alert._id), latitude: String(lat1), longitude: String(lon1) }
          );
          console.log("Push notifications sent to", tokensToNotify.length, "devices");
        } catch (pushErr) {
          console.error("Push send error:", pushErr?.message || pushErr);
        }
      } else {
        console.log("No nearby device tokens to notify");
      }
    } catch (notifyErr) {
      console.error("Hyperlocal notify error:", notifyErr?.message || notifyErr);
    }

    // Respond to caller
    return res.status(201).json({ success: true, alert });

  } catch (err) {
    console.error("createAlert error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
};

// -------------------------
// Twilio Status Callback endpoint for delivery receipts
// -------------------------
export const smsStatusCallback = async (req, res) => {
  try {
    const { MessageSid, MessageStatus, To, From, ErrorCode, ErrorMessage } = req.body;
    console.log("Twilio status callback:", { MessageSid, MessageStatus, To, From, ErrorCode, ErrorMessage });

    try {
      const alert = await Alert.findOne({ "sms.sid": MessageSid });
      if (alert) {
        alert.sms = alert.sms || {};
        alert.sms.status = MessageStatus;
        alert.sms.errorCode = ErrorCode ? Number(ErrorCode) : undefined;
        alert.sms.errorMessage = ErrorMessage || undefined;
        alert.sms.updatedAt = new Date();
        await alert.save();

        const failed = MessageStatus === "failed" || MessageStatus === "undelivered";
        if (failed && !alert.sms.fallbackSent) {
          try {
            await sendFallbackForAlert(alert);
          } catch (fbErr) {
            console.error("Fallback send failed (callback):", fbErr?.message || fbErr);
          }
        }
      } else {
        console.log("No alert found with sms.sid", MessageSid);
      }
    } catch (dbErr) {
      console.error("Failed to update Alert with SMS status:", dbErr?.message || dbErr);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("smsStatusCallback error:", err?.message || err);
    res.status(500).send("ERR");
  }
};

// -------------------------
// Get all alerts
// -------------------------
export const getAllAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ createdAt: -1 }).limit(200);
    res.status(200).json({ success: true, count: alerts.length, alerts });
  } catch (error) {
    console.error("getAllAlerts error:", error?.message || error);
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
};
