import { SERVER_DIR } from './env.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { db, getUser, publicUser, memberIds } from './db.js';
import { verifyToken } from './auth.js';
import { api } from './api.js';
import { setIO, addSocket, removeSocket, setVisible, broadcastPresence, emitToUsers } from './realtime.js';
import { startScheduler } from './scheduler.js';
import { aiInfo } from './ai.js';

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);
app.use('/api', (err, req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Serve the built PWA.
const WEB = process.env.WEB_DIST || path.join(SERVER_DIR, '..', 'web', 'dist');
if (fs.existsSync(WEB)) {
  app.use(express.static(WEB, {
    setHeaders: (res, file) => {
      if (file.endsWith('sw.js') || file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => res.sendFile(path.join(WEB, 'index.html')));
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
setIO(io);

// room -> Map(socketId -> user)
const callRooms = new Map();

function canJoinCall(uid, room) {
  return !!(
    db.prepare('SELECT 1 FROM invites WHERE room_id = ? AND (from_id = ? OR to_id = ?)').get(room, uid, uid) ||
    db.prepare('SELECT 1 FROM events e JOIN event_members m ON m.event_id = e.id WHERE e.call_room = ? AND m.user_id = ?').get(room, uid)
  );
}

function leaveCall(socket) {
  const room = socket.data.callRoom;
  if (!room) return;
  const peers = callRooms.get(room);
  peers?.delete(socket.id);
  socket.leave(`call:${room}`);
  socket.to(`call:${room}`).emit('call:peer-left', { socketId: socket.id });
  if (peers && peers.size === 0) callRooms.delete(room);
  socket.data.callRoom = null;
}

io.use((socket, next) => {
  const user = verifyToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('unauthorized'));
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  socket.join(`user:${uid}`);
  if (addSocket(uid, socket.id)) broadcastPresence(uid);

  socket.on('visibility', ({ visible } = {}) => setVisible(uid, socket.id, visible));

  socket.on('typing', ({ conversation_id } = {}) => {
    const members = memberIds(conversation_id || '');
    if (!members.includes(uid)) return;
    const u = getUser(uid);
    emitToUsers(members.filter((m) => m !== uid), 'typing', { conversation_id, user: publicUser(u) });
  });

  // ---- WebRTC signaling (mesh, joiner sends offers to everyone already in the room) ----
  socket.on('call:join', ({ room } = {}, ack) => {
    if (!room || !canJoinCall(uid, room)) return ack?.({ error: 'Not allowed in this call' });
    leaveCall(socket);
    if (!callRooms.has(room)) callRooms.set(room, new Map());
    const peers = callRooms.get(room);
    if (peers.size >= 6) return ack?.({ error: 'Call is full (max 6)' });
    const user = publicUser(getUser(uid));
    const existing = [...peers.entries()].map(([socketId, u]) => ({ socketId, user: u }));
    peers.set(socket.id, user);
    socket.data.callRoom = room;
    socket.join(`call:${room}`);
    socket.to(`call:${room}`).emit('call:peer-joined', { socketId: socket.id, user });
    ack?.({ peers: existing, self: socket.id });
  });

  socket.on('call:signal', ({ to, data } = {}) => {
    const room = socket.data.callRoom;
    if (!room || !callRooms.get(room)?.has(to)) return;
    io.to(to).emit('call:signal', { from: socket.id, data });
  });

  socket.on('call:media', (state = {}) => {
    const room = socket.data.callRoom;
    if (room) socket.to(`call:${room}`).emit('call:media', { socketId: socket.id, ...state });
  });

  socket.on('call:leave', () => leaveCall(socket));

  socket.on('disconnect', () => {
    leaveCall(socket);
    if (removeSocket(uid, socket.id)) broadcastPresence(uid);
  });
});

startScheduler();

server.listen(PORT, () => {
  console.log(`Linkup running on http://localhost:${PORT}`);
  console.log(`AI: ${aiInfo.model} @ ${aiInfo.base}`);
});
