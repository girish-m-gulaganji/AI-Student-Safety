import jwt from "jsonwebtoken";
import User from "../models/userModel.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export default async function auth(req, res, next) {
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Invalid token' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    // attach user minimal info
    req.user = { id: payload.id, email: payload.email };

    // optional: load user from DB for convenience
    try {
      const u = await User.findById(payload.id).lean();
      if (u) req.user.name = u.name;
    } catch (e) {}

    return next();
  } catch (err) {
    console.error('auth middleware error', err?.message || err);
    return res.status(500).json({ success: false, error: 'Auth middleware failure' });
  }
}
