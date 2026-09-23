import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, getUser } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, 'jwt_secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s);
  return s;
}
const SECRET = loadSecret();

export const signToken = (userId) => jwt.sign({ sub: userId }, SECRET, { expiresIn: '180d' });

// Invite links: a signed "add me" token. Opening it and signing in makes you friends straight away.
export const signInvite = (userId) => jwt.sign({ inv: userId }, SECRET, { expiresIn: '30d' });
export function verifyInvite(token) {
  try { const { inv } = jwt.verify(token, SECRET); return getUser(inv) || null; } catch { return null; }
}

export function verifyToken(token) {
  try {
    const { sub } = jwt.verify(token, SECRET);
    return getUser(sub) || null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = token && verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}
