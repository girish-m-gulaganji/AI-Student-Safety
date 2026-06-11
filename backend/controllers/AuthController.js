import User from "../models/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function pbkdf2Hash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}$${hash}`;
}

function pbkdf2Compare(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return candidate === hash;
}

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "name, email and password required" });
    }

    let existing = await User.findOne({ email });
    if (existing && existing.password) {
      return res.status(400).json({ success: false, error: "Email already registered" });
    }

    let hash;
    try {
      const salt = await bcrypt.genSalt(10);
      hash = await bcrypt.hash(password, salt);
    } catch (e) {
      // fallback
      hash = pbkdf2Hash(password);
    }

    let u;
    if (existing) {
      // existing user record without password — update it
      existing.name = name || existing.name;
      existing.password = hash;
      await existing.save();
      u = existing;
    } else {
      u = new User({ name, email, password: hash });
      await u.save();
    }

    // generate token with payload { id }
    const token = jwt.sign({ id: String(u._id) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({ success: true, user: { _id: u._id, name: u.name, email: u.email, token } });
  } catch (err) {
    console.error("register error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: "email and password required" });

    console.log('AuthController.login attempt for', email);
    const user = await User.findOne({ email });
    console.log('AuthController.login user found?', !!user);
    if (user) {
      const pw = String(user.password || '');
      const preview = pw.length > 10 ? pw.slice(0, 10) + '...' + pw.slice(-8) : pw;
      console.log('AuthController.login stored password preview:', preview);
      console.log('AuthController.login password looks like:', {
        containsDollar: pw.includes('$'),
        startsWithBcrypt: pw.startsWith('$2'),
        length: pw.length,
      });
    }
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    let match = false;
    try {
      match = await bcrypt.compare(password, user.password);
      console.log('AuthController.login bcrypt.compare result:', match);
      if (!match) {
        // try legacy pbkdf2 compare as a fallback when bcrypt check fails
        match = pbkdf2Compare(password, user.password);
        console.log('AuthController.login fallback pbkdf2Compare result:', match);
      }
    } catch (e) {
      // bcrypt may not be usable in some environments; try legacy pbkdf2
      match = pbkdf2Compare(password, user.password);
      console.log('AuthController.login pbkdf2Compare (catch) result:', match, e?.message || '');
    }

    if (!match) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const token = jwt.sign({ id: String(user._id) }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, token } });
  } catch (err) {
    console.error("login error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
};

export default { register, login };
