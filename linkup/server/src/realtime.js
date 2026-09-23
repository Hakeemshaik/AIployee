import { db, friendIds, getUser, publicUser, now } from './db.js';

// userId -> Map(socketId -> { visible: boolean })
const sockets = new Map();
let io = null;

export const setIO = (instance) => { io = instance; };
export const getIO = () => io;

export function addSocket(userId, socketId) {
  if (!sockets.has(userId)) sockets.set(userId, new Map());
  const wasOnline = sockets.get(userId).size > 0;
  sockets.get(userId).set(socketId, { visible: true });
  return !wasOnline;
}

export function removeSocket(userId, socketId) {
  const m = sockets.get(userId);
  if (!m) return false;
  m.delete(socketId);
  if (m.size === 0) {
    sockets.delete(userId);
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), userId);
    return true; // went offline
  }
  return false;
}

export function setVisible(userId, socketId, visible) {
  const s = sockets.get(userId)?.get(socketId);
  if (s) s.visible = !!visible;
}

export const isOnline = (userId) => (sockets.get(userId)?.size || 0) > 0;
export const isVisible = (userId) => [...(sockets.get(userId)?.values() || [])].some((s) => s.visible);

// What friends see. "invisible" users look offline.
export function presenceOf(u) {
  const online = isOnline(u.id);
  const status = !online || u.status === 'invisible' ? 'offline' : u.status;
  return { ...publicUser(u), status, online: online && u.status !== 'invisible' };
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds, event, payload) {
  for (const uid of new Set(userIds)) emitToUser(uid, event, payload);
}

export function broadcastPresence(userId) {
  const u = getUser(userId);
  if (!u) return;
  const p = presenceOf(u);
  emitToUsers(friendIds(userId), 'presence', p);
  // The user sees their own real status (including invisible).
  emitToUser(userId, 'presence', { ...publicUser(u), online: isOnline(userId), self: true });
}
