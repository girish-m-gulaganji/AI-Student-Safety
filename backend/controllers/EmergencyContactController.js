import EmergencyContact from "../models/emergencyContactModel.js";
import mongoose from "mongoose";
import User from "../models/userModel.js";

/**
 * Add an emergency contact for a user
 */
const addEmergencyContact = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const userId = req.userId;
    if (!userId || !name || !phone) {
      return res.status(400).json({ success: false, error: "userId (auth), name and phone are required" });
    }

    // ensure user exists
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const ec = new EmergencyContact({ userId, name, phone });
    await ec.save();
    return res.status(201).json({ success: true, contact: ec });
  } catch (err) {
    console.error("addEmergencyContact error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
};

/**
 * Get all emergency contacts for a userId (path param)
 */
const getEmergencyContacts = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(400).json({ success: false, error: 'userId required (auth)' });

    const contacts = await EmergencyContact.find({ userId }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: contacts.length, contacts });
  } catch (err) {
    console.error("getEmergencyContacts error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
};

/**
 * Delete an emergency contact by id for the authenticated user
 */
const deleteEmergencyContact = async (req, res) => {
  try {
    const contactId = req.params.id;
    const userId = req.userId;
    if (!contactId || !userId) return res.status(400).json({ success: false, error: 'contact id and auth required' });

    // ensure contact exists and belongs to user
    const contact = await EmergencyContact.findById(contactId).lean();
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    if (String(contact.userId) !== String(userId)) return res.status(403).json({ success: false, error: 'Not authorized to delete this contact' });

    await EmergencyContact.deleteOne({ _id: contactId });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('deleteEmergencyContact error', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
};

/**
 * Notify emergency contacts for a given userId with a location object
 * Uses sendSms from alertController via dynamic import to avoid circular imports
 */
const notifyEmergencyContacts = async (userId, location) => {
  try {
    if (!userId) return null;

    // Resolve legacy string userId to ObjectId if necessary
    let resolvedId = null;
    if (mongoose.isValidObjectId(userId)) {
      resolvedId = userId;
    } else {
      const user = await User.findOne({ userId }).lean();
      if (user) resolvedId = user._id;
    }

    if (!resolvedId) {
      console.warn('notifyEmergencyContacts: no user found for', userId);
      return null;
    }

    // Find contacts by resolved ObjectId
    const contacts = await EmergencyContact.find({ userId: resolvedId }).lean();
    if (!contacts || contacts.length === 0) {
      // nothing to do
      return null;
    }

    // dynamically import sendSms to avoid circular dependency at module load
    const alertModule = await import("./alertController.js");
    const sendSms = alertModule.sendSms;
    if (typeof sendSms !== "function") {
      console.warn("sendSms not available; skipping emergency contact SMS");
      return null;
    }

    const lat = location?.latitude;
    const lon = location?.longitude;
    const coords = (typeof lat === "number" && typeof lon === "number") ? `${lat}, ${lon}` : "(unknown)";

    const body = `🚨 Emergency Alert: Your contact triggered an SOS. Location: ${coords}. Open the app for details.`;

    const results = await Promise.allSettled(
      contacts.map((c) => sendSms(c.phone, body))
    );

    // log failures
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error("Failed to send SMS to", contacts[i]?.phone, r.reason?.message || r.reason);
      }
    });

    return results;
  } catch (err) {
    console.error("notifyEmergencyContacts error:", err?.message || err);
    throw err;
  }
};

export default { addEmergencyContact, getEmergencyContacts, deleteEmergencyContact, notifyEmergencyContacts };
