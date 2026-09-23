import express from 'express';
import bcrypt from 'bcryptjs';
import {
  db, id, now, publicUser, getUser, friendIds, areFriends, isMember, memberIds, parseRow,
} from './db.js';
import { signToken, requireAuth, signInvite, verifyInvite } from './auth.js';
import { presenceOf, broadcastPresence, emitToUser, emitToUsers, isOnline } from './realtime.js';
import { notify } from './notify.js';
import { vapid, saveSubscription, removeSubscription, sendPush } from './push.js';
import { runAI, normalizePlan, aiInfo } from './ai.js';
import { formatWhen, zonedToDate, TZ } from './time.js';

export const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const COLORS = ['#7c5cff', '#ff5c8a', '#22c7a9', '#ffb020', '#3fa7ff', '#ff7a45', '#a3e635', '#e879f9'];
const STATUSES = ['available', 'busy', 'work', 'away', 'invisible'];
const TYPES = ['trip', 'hangout', 'meeting', 'call', 'event'];

// ---------- config ----------
api.get('/config', (req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    ice.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD });
  }
  res.json({
    appName: process.env.APP_NAME || 'Linkup',
    vapidPublicKey: vapid.publicKey,
    iceServers: ice,
    registrationCodeRequired: !!process.env.REGISTRATION_CODE,
    timezone: TZ,
    ai: { model: aiInfo.model },
  });
});

// ---------- auth ----------
api.post('/auth/register', wrap(async (req, res) => {
  const { username, display_name, password, code } = req.body || {};
  // A friend's invite link counts as the invite code.
  if (process.env.REGISTRATION_CODE && code !== process.env.REGISTRATION_CODE && !verifyInvite(req.body?.invite || '')) return bad(res, 'Wrong invite code');
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username || '')) return bad(res, 'Username: 3-20 letters, numbers, _ or .');
  if (!password || password.length < 6) return bad(res, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'Username taken');
  const uid = id();
  const color = COLORS[db.prepare('SELECT COUNT(*) c FROM users').get().c % COLORS.length];
  db.prepare('INSERT INTO users (id, username, display_name, password_hash, color) VALUES (?,?,?,?,?)').run(
    uid, username, (display_name || username).trim().slice(0, 40), await bcrypt.hash(password, 10), color
  );
  ensureAIConversation(uid);
  res.json({ token: signToken(uid), user: publicUser(getUser(uid)) });
}));

api.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return bad(res, 'Wrong username or password', 401);
  ensureAIConversation(u.id);
  res.json({ token: signToken(u.id), user: publicUser(u) });
}));

// Who sent this invite link (shown on the sign-up screen before you have an account).
api.get('/invite-link/:token', (req, res) => {
  const u = verifyInvite(req.params.token);
  if (!u) return bad(res, 'This invite link has expired', 404);
  res.json({ user: publicUser(u) });
});

api.use(requireAuth);

api.get('/invite-link', (req, res) => res.json({ token: signInvite(req.user.id) }));

// Accept an invite link: become friends both ways and open a chat.
api.post('/invite-link/accept', wrap(async (req, res) => {
  const inviter = verifyInvite(req.body?.token || '');
  if (!inviter) return bad(res, 'This invite link has expired', 404);
  if (inviter.id === req.user.id) return bad(res, "That's your own link");
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?,?), (?,?)').run(inviter.id, req.user.id, req.user.id, inviter.id);
  db.prepare(`UPDATE friend_requests SET status = 'accepted' WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`).run(inviter.id, req.user.id, req.user.id, inviter.id);
  let dm = db.prepare(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
     JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
     WHERE c.is_group = 0 AND c.is_ai = 0`
  ).get(req.user.id, inviter.id)?.id;
  if (!dm) {
    dm = id();
    db.prepare('INSERT INTO conversations (id, name, is_group) VALUES (?, NULL, 0)').run(dm);
    for (const u of [req.user.id, inviter.id]) db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(dm, u);
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body) VALUES (?, ?, NULL, 'system', ?)`).run(id(), dm, `${req.user.display_name} joined with ${inviter.display_name}'s link. Say hi!`);
  }
  await notify([inviter.id], {
    kind: 'friend_accept', title: `${req.user.display_name} joined Linkup`,
    body: 'You are now friends. Say hi!', url: `/chat/${dm}`,
  });
  emitToUsers([inviter.id, req.user.id], 'friends:changed', {});
  emitToUsers([inviter.id, req.user.id], 'conversations:changed', {});
  res.json({ conversation_id: dm, friend: publicUser(inviter) });
}));

api.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

api.patch('/me', (req, res) => {
  const { display_name, status, status_text } = req.body || {};
  if (status !== undefined && !STATUSES.includes(status)) return bad(res, 'Bad status');
  db.prepare(
    `UPDATE users SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), status_text = COALESCE(?, status_text) WHERE id = ?`
  ).run(display_name?.trim().slice(0, 40) || null, status ?? null, status_text !== undefined ? String(status_text).slice(0, 80) : null, req.user.id);
  broadcastPresence(req.user.id);
  res.json({ user: publicUser(getUser(req.user.id)) });
});

// ---------- push ----------
api.post('/push/subscribe', (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return bad(res, 'Bad subscription');
  saveSubscription(req.user.id, sub);
  res.json({ ok: true });
});
api.post('/push/unsubscribe', (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});
api.post('/push/test', wrap(async (req, res) => {
  const r = await sendPush(req.user.id, {
    id: id(), title: 'Notifications are working', body: `Hey ${req.user.display_name}, this is what your alerts will look like.`,
    url: '/alerts', kind: 'test', tag: 'test', actions: [], timestamp: Date.now(),
  });
  res.json(r);
}));

// ---------- friends ----------
function friendsPayload(uid) {
  const friends = friendIds(uid).map(getUser).filter(Boolean).map(presenceOf);
  const incoming = db.prepare(
    `SELECT u.*, r.id AS request_id FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ? AND r.status = 'pending'`
  ).all(uid).map((r) => ({ request_id: r.request_id, user: publicUser(r) }));
  const outgoing = db.prepare(
    `SELECT u.*, r.id AS request_id FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ? AND r.status = 'pending'`
  ).all(uid).map((r) => ({ request_id: r.request_id, user: publicUser(r) }));
  return { friends, incoming, outgoing };
}

api.get('/friends', (req, res) => res.json(friendsPayload(req.user.id)));

api.post('/friends/request', wrap(async (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get((req.body?.username || '').replace(/^@/, ''));
  if (!target) return bad(res, 'No one with that username', 404);
  if (target.id === req.user.id) return bad(res, "That's you");
  if (areFriends(req.user.id, target.id)) return bad(res, 'Already friends');
  // If they already asked me, accept straight away.
  const reverse = db.prepare(`SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`).get(target.id, req.user.id);
  if (reverse) {
    acceptFriend(reverse);
    return res.json({ accepted: true });
  }
  db.prepare(
    `INSERT INTO friend_requests (id, from_id, to_id) VALUES (?,?,?) ON CONFLICT(from_id, to_id) DO UPDATE SET status = 'pending'`
  ).run(id(), req.user.id, target.id);
  await notify([target.id], {
    kind: 'friend_request',
    title: 'New friend request',
    body: `${req.user.display_name} (@${req.user.username}) wants to add you`,
    url: '/',
  });
  emitToUser(target.id, 'friends:changed', {});
  res.json({ sent: true });
}));

function acceptFriend(r) {
  db.prepare(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`).run(r.id);
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?,?), (?,?)').run(r.from_id, r.to_id, r.to_id, r.from_id);
  const accepter = getUser(r.to_id);
  notify([r.from_id], {
    kind: 'friend_accept', title: 'Friend request accepted',
    body: `${accepter.display_name} is now your friend. Say hi!`, url: '/',
  });
  emitToUsers([r.from_id, r.to_id], 'friends:changed', {});
}

api.post('/friends/requests/:id/respond', (req, res) => {
  const r = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND to_id = ?').get(req.params.id, req.user.id);
  if (!r) return bad(res, 'Request not found', 404);
  if (req.body?.accept) acceptFriend(r);
  else db.prepare(`UPDATE friend_requests SET status = 'declined' WHERE id = ?`).run(r.id);
  res.json(friendsPayload(req.user.id));
});

api.delete('/friends/:id', (req, res) => {
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(
    req.user.id, req.params.id, req.params.id, req.user.id
  );
  emitToUsers([req.user.id, req.params.id], 'friends:changed', {});
  res.json({ ok: true });
});

// ---------- availability ----------
api.get('/availability', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return bad(res, 'from and to required');
  const uids = [req.user.id, ...friendIds(req.user.id)];
  const users = uids.map(getUser).filter(Boolean).map((u) => (u.id === req.user.id ? { ...publicUser(u), online: true, me: true } : presenceOf(u)));
  const ph = uids.map(() => '?').join(',');
  const blocks = db.prepare(`SELECT * FROM availability WHERE user_id IN (${ph}) AND date BETWEEN ? AND ? ORDER BY date, start_time`).all(...uids, from, to)
    .map((b) => (b.user_id === req.user.id ? b : { ...b, note: '' })); // notes are private
  const fromISO = zonedToDate(from, '00:00').toISOString();
  const toISO = zonedToDate(to, '23:59').toISOString();
  const evRows = db.prepare(
    `SELECT e.*, m.user_id AS member_id, m.rsvp FROM events e JOIN event_members m ON m.event_id = e.id
     WHERE m.user_id IN (${ph}) AND m.rsvp != 'declined' AND e.end_at >= ? AND e.start_at <= ?`
  ).all(...uids, fromISO, toISO);
  const mine = new Set(db.prepare('SELECT event_id FROM event_members WHERE user_id = ?').all(req.user.id).map((r) => r.event_id));
  // Friends' events I'm not part of show up only as "busy", no details.
  const events = evRows.map((e) => mine.has(e.id)
    ? { id: e.id, user_id: e.member_id, title: e.title, type: e.type, start_at: e.start_at, end_at: e.end_at, rsvp: e.rsvp, visible: true }
    : { id: null, user_id: e.member_id, title: 'Busy', type: 'private', start_at: e.start_at, end_at: e.end_at, visible: false });
  res.json({ users, blocks, events });
});

api.post('/availability', (req, res) => {
  const { date, kind, start_time, end_time, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return bad(res, 'Bad date');
  if (!['busy', 'work', 'free'].includes(kind)) return bad(res, 'Bad kind');
  const timed = start_time && end_time;
  if (timed && !(start_time < end_time)) return bad(res, 'End must be after start');
  if (!timed) db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ? AND start_time IS NULL').run(req.user.id, date);
  const aid = id();
  db.prepare('INSERT INTO availability (id, user_id, date, start_time, end_time, kind, note) VALUES (?,?,?,?,?,?,?)').run(
    aid, req.user.id, date, timed ? start_time : null, timed ? end_time : null, kind, String(note || '').slice(0, 80)
  );
  emitToUsers([req.user.id, ...friendIds(req.user.id)], 'availability:changed', { user_id: req.user.id });
  res.json(db.prepare('SELECT * FROM availability WHERE id = ?').get(aid));
});

api.delete('/availability/:id', (req, res) => {
  db.prepare('DELETE FROM availability WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  emitToUsers([req.user.id, ...friendIds(req.user.id)], 'availability:changed', { user_id: req.user.id });
  res.json({ ok: true });
});

api.delete('/availability', (req, res) => {
  db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?').run(req.user.id, req.query.date || '');
  emitToUsers([req.user.id, ...friendIds(req.user.id)], 'availability:changed', { user_id: req.user.id });
  res.json({ ok: true });
});

// ---------- events ----------
function eventPayload(eid) {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eid);
  if (!e) return null;
  e.members = db.prepare('SELECT m.rsvp, u.* FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = ?')
    .all(eid).map((r) => ({ ...publicUser(r), rsvp: r.rsvp }));
  e.creator = publicUser(getUser(e.creator_id));
  return e;
}

export async function createEvent(creator, input) {
  const type = TYPES.includes(input.type) ? input.type : 'hangout';
  const start = new Date(input.start_at);
  const end = new Date(input.end_at || input.start_at);
  if (!input.title?.trim()) throw Object.assign(new Error('Title required'), { status: 400 });
  if (isNaN(start) || isNaN(end) || end < start) throw Object.assign(new Error('Bad start/end time'), { status: 400 });
  const invited = [...new Set((input.participant_ids || []).filter((u) => u !== creator.id && (areFriends(creator.id, u) || (input.conversation_id && isMember(input.conversation_id, u)))))];
  const eid = id();
  const reminder = Number.isFinite(+input.reminder_minutes) ? +input.reminder_minutes : type === 'trip' ? 1440 : 60;
  db.prepare(
    `INSERT INTO events (id, creator_id, title, type, start_at, end_at, location, notes, conversation_id, call_room, reminder_minutes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(eid, creator.id, input.title.trim().slice(0, 120), type, start.toISOString(), end.toISOString(),
    String(input.location || '').slice(0, 200), String(input.notes || '').slice(0, 2000), input.conversation_id || null,
    type === 'call' ? id() : null, reminder);
  db.prepare(`INSERT INTO event_members (event_id, user_id, rsvp) VALUES (?, ?, 'going')`).run(eid, creator.id);
  for (const u of invited) db.prepare(`INSERT OR IGNORE INTO event_members (event_id, user_id) VALUES (?, ?)`).run(eid, u);

  const e = eventPayload(eid);
  const when = formatWhen(e.start_at, e.end_at);
  await notify(invited, {
    kind: 'event_invite',
    title: `${creator.display_name} invited you: ${e.title}`,
    body: [when, e.location, e.notes].filter(Boolean).join(' · ').slice(0, 240),
    url: `/event/${eid}`,
    data: { event_id: eid },
    actions: [
      { action: 'going', title: 'Going', url: `/event/${eid}?act=going` },
      { action: 'maybe', title: 'Maybe', url: `/event/${eid}?act=maybe` },
    ],
  });
  emitToUsers([creator.id, ...invited], 'events:changed', { event_id: eid });
  emitToUsers([creator.id, ...invited], 'availability:changed', {});
  return e;
}

api.get('/events', (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const ids = db.prepare(
    `SELECT e.id FROM events e JOIN event_members m ON m.event_id = e.id WHERE m.user_id = ? AND e.end_at >= ? ORDER BY e.start_at`
  ).all(req.user.id, since).map((r) => r.id);
  res.json({ events: ids.map(eventPayload) });
});

api.get('/events/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM event_members WHERE event_id = ? AND user_id = ?').get(req.params.id, req.user.id)) return bad(res, 'Not found', 404);
  res.json({ event: eventPayload(req.params.id) });
});

api.post('/events', wrap(async (req, res) => {
  try {
    res.json({ event: await createEvent(req.user, req.body || {}) });
  } catch (e) {
    if (e.status) return bad(res, e.message, e.status);
    throw e;
  }
}));

api.patch('/events/:id', wrap(async (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e || e.creator_id !== req.user.id) return bad(res, 'Only the creator can edit', 403);
  const b = req.body || {};
  const start = b.start_at ? new Date(b.start_at).toISOString() : e.start_at;
  const end = b.end_at ? new Date(b.end_at).toISOString() : e.end_at;
  const reminder = Number.isFinite(+b.reminder_minutes) ? +b.reminder_minutes : e.reminder_minutes;
  const type = TYPES.includes(b.type) ? b.type : e.type;
  const resetReminder = start !== e.start_at || reminder !== e.reminder_minutes;
  db.prepare(`UPDATE events SET title = ?, type = ?, start_at = ?, end_at = ?, location = ?, notes = ?, reminder_minutes = ?,
      reminder_sent = CASE WHEN ? THEN 0 ELSE reminder_sent END, call_room = COALESCE(call_room, ?) WHERE id = ?`)
    .run(b.title ?? e.title, type, start, end, b.location ?? e.location, b.notes ?? e.notes, reminder, resetReminder ? 1 : 0,
      type === 'call' ? id() : null, e.id);
  if (Array.isArray(b.add_participant_ids)) {
    const add = b.add_participant_ids.filter((u) => areFriends(req.user.id, u));
    for (const u of add) db.prepare('INSERT OR IGNORE INTO event_members (event_id, user_id) VALUES (?, ?)').run(e.id, u);
  }
  const ev = eventPayload(e.id);
  const others = ev.members.map((m) => m.id).filter((u) => u !== req.user.id);
  await notify(others, {
    kind: 'event_update', title: `Updated: ${ev.title}`,
    body: `${req.user.display_name} changed the plan · ${[formatWhen(ev.start_at, ev.end_at), ev.location].filter(Boolean).join(' · ')}`,
    url: `/event/${ev.id}`, tag: `event-${ev.id}`,
  });
  emitToUsers(ev.members.map((m) => m.id), 'events:changed', { event_id: ev.id });
  emitToUsers(ev.members.map((m) => m.id), 'availability:changed', {});
  res.json({ event: ev });
}));

api.delete('/events/:id', wrap(async (req, res) => {
  const ev = eventPayload(req.params.id);
  if (!ev || ev.creator_id !== req.user.id) return bad(res, 'Only the creator can cancel', 403);
  db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  const others = ev.members.map((m) => m.id).filter((u) => u !== req.user.id);
  await notify(others, {
    kind: 'event_cancel', title: `Cancelled: ${ev.title}`,
    body: `${req.user.display_name} cancelled ${formatWhen(ev.start_at, ev.end_at)}`, url: '/plans',
  });
  emitToUsers(ev.members.map((m) => m.id), 'events:changed', { event_id: ev.id });
  emitToUsers(ev.members.map((m) => m.id), 'availability:changed', {});
  res.json({ ok: true });
}));

api.post('/events/:id/rsvp', wrap(async (req, res) => {
  const rsvp = req.body?.rsvp;
  if (!['going', 'maybe', 'declined'].includes(rsvp)) return bad(res, 'Bad RSVP');
  const r = db.prepare('UPDATE event_members SET rsvp = ? WHERE event_id = ? AND user_id = ?').run(rsvp, req.params.id, req.user.id);
  if (!r.changes) return bad(res, 'Not invited', 404);
  const ev = eventPayload(req.params.id);
  if (ev.creator_id !== req.user.id) {
    const word = { going: 'is going to', maybe: 'might come to', declined: "can't make" }[rsvp];
    await notify([ev.creator_id], {
      kind: 'rsvp', title: `${req.user.display_name} ${word} ${ev.title}`,
      body: `${ev.members.filter((m) => m.rsvp === 'going').length} going · ${formatWhen(ev.start_at, ev.end_at)}`,
      url: `/event/${ev.id}`, tag: `rsvp-${ev.id}`,
    });
  }
  emitToUsers(ev.members.map((m) => m.id), 'events:changed', { event_id: ev.id });
  emitToUsers([req.user.id, ...friendIds(req.user.id)], 'availability:changed', {});
  res.json({ event: ev });
}));

// ---------- conversations ----------
function ensureAIConversation(uid) {
  const existing = db.prepare(
    `SELECT c.id FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE c.is_ai = 1 AND m.user_id = ?`
  ).get(uid);
  if (existing) return existing.id;
  const cid = id();
  db.prepare(`INSERT INTO conversations (id, name, is_group, is_ai) VALUES (?, 'Planner', 0, 1)`).run(cid);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(cid, uid);
  db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, kind, body) VALUES (?, ?, NULL, 'ai', ?)`).run(
    id(), cid, "I'm Planner. Tell me what you want to do and who with. I'll find a time you're all free, book it and set a reminder."
  );
  return cid;
}

function convSummary(c, uid) {
  const members = db.prepare('SELECT u.* FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?')
    .all(c.id).map((u) => (u.id === uid ? { ...publicUser(u), me: true } : presenceOf(u)));
  const last = parseRow(db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(c.id));
  const lr = db.prepare('SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(c.id, uid)?.last_read_at;
  const unread = db.prepare(
    `SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND (sender_id IS NULL OR sender_id != ?) AND created_at > ?`
  ).get(c.id, uid, lr || '').c;
  const others = members.filter((m) => !m.me);
  const title = c.is_ai ? 'Planner' : c.name || others.map((m) => m.display_name).join(', ') || 'Just you';
  const reads = Object.fromEntries(db.prepare('SELECT user_id, last_read_at FROM conversation_members WHERE conversation_id = ?').all(c.id).map((r) => [r.user_id, r.last_read_at]));
  return { ...c, title, members, reads, last_message: last ? messagePayload(last) : null, unread };
}

function messagePayload(m) {
  const s = m.sender_id ? getUser(m.sender_id) : null;
  return { ...m, sender: s ? publicUser(s) : null };
}

api.get('/conversations', (req, res) => {
  ensureAIConversation(req.user.id);
  const rows = db.prepare(
    `SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE m.user_id = ? ORDER BY c.updated_at DESC`
  ).all(req.user.id);
  res.json({ conversations: rows.map((c) => convSummary(c, req.user.id)) });
});

api.get('/conversations/:id', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return bad(res, 'Not found', 404);
  res.json({ conversation: convSummary(db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id), req.user.id) });
});

api.post('/conversations', (req, res) => {
  const ids = [...new Set((req.body?.member_ids || []).filter((u) => areFriends(req.user.id, u)))];
  if (!ids.length) return bad(res, 'Pick at least one friend');
  if (ids.length === 1 && !req.body?.name) {
    const dm = db.prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.is_group = 0 AND c.is_ai = 0`
    ).get(req.user.id, ids[0]);
    if (dm) return res.json({ conversation: convSummary(db.prepare('SELECT * FROM conversations WHERE id = ?').get(dm.id), req.user.id) });
  }
  const cid = id();
  const isGroup = ids.length > 1 || !!req.body?.name;
  db.prepare('INSERT INTO conversations (id, name, is_group) VALUES (?, ?, ?)').run(cid, isGroup ? String(req.body?.name || '').slice(0, 60) || null : null, isGroup ? 1 : 0);
  for (const u of [req.user.id, ...ids]) db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(cid, u);
  emitToUsers([req.user.id, ...ids], 'conversations:changed', {});
  res.json({ conversation: convSummary(db.prepare('SELECT * FROM conversations WHERE id = ?').get(cid), req.user.id) });
});

api.get('/conversations/:id/messages', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return bad(res, 'Not found', 404);
  const before = req.query.before || '9999';
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 60')
    .all(req.params.id, before).reverse().map((m) => messagePayload(parseRow(m)));
  res.json({ messages: rows });
});

api.post('/conversations/:id/read', (req, res) => {
  const at = now();
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(at, req.params.id, req.user.id);
  emitToUsers(memberIds(req.params.id), 'read', { conversation_id: req.params.id, user_id: req.user.id, at });
  res.json({ ok: true });
});

async function postMessage(convId, senderId, kind, body, data = null) {
  const mid = id();
  const ts = now();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, kind, body, data, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(mid, convId, senderId, kind, body, data ? JSON.stringify(data) : null, ts);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, convId);
  if (senderId) db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(ts, convId, senderId);
  const msg = messagePayload(parseRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(mid)));
  const members = memberIds(convId);
  emitToUsers(members, 'message', msg);

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  const recipients = members.filter((u) => u !== senderId);
  const sender = senderId ? getUser(senderId) : null;
  const from = sender ? sender.display_name : 'Planner';
  let title = conv.is_group ? `${from} in ${conv.name || 'group chat'}` : from;
  let text = body;
  if (kind === 'plan' && data?.plan) {
    const p = data.plan;
    title = `Planner suggested: ${p.title}`;
    text = [p.start_at ? formatWhen(p.start_at, p.end_at) : 'date not set yet', p.location].filter(Boolean).join(' · ') + ' · Tap to confirm';
  }
  await notify(recipients, {
    kind: 'message', title, body: text.slice(0, 240), url: `/chat/${convId}`, tag: `chat-${convId}`,
    data: { conversation_id: convId }, store: kind === 'plan',
  });
  return msg;
}

const aiBusy = new Set();
async function aiRespond(convId, requesterId, mode, instruction) {
  if (aiBusy.has(convId)) return;
  aiBusy.add(convId);
  const members = memberIds(convId);
  emitToUsers(members, 'ai:thinking', { conversation_id: convId, on: true });
  try {
    const conv = db.prepare('SELECT is_ai FROM conversations WHERE id = ?').get(convId);
    // Your private Planner chat can see and invite all your friends.
    const opts = conv?.is_ai ? { memberIdsOverride: [requesterId, ...friendIds(requesterId)], personal: true } : {};
    const { reply, plan } = await runAI(convId, { mode, requesterId, instruction, ...opts });
    if (reply) await postMessage(convId, null, 'ai', reply);
    if (plan) await postMessage(convId, null, 'plan', plan.title, { plan, status: 'proposed', requested_by: requesterId });
    else if (mode === 'plan' && !reply) await postMessage(convId, null, 'ai', "I couldn't find a plan in the chat yet. Mention what, when and where and tap Plan it again.");
  } catch (e) {
    console.warn('[ai] error', e.message);
    await postMessage(convId, null, 'ai', `I'm offline right now (${e.name === 'AbortError' ? 'timed out' : 'cannot reach the local model'}). Try again in a bit.`);
  } finally {
    aiBusy.delete(convId);
    emitToUsers(members, 'ai:thinking', { conversation_id: convId, on: false });
  }
}

api.post('/conversations/:id/messages', wrap(async (req, res) => {
  const convId = req.params.id;
  if (!isMember(convId, req.user.id)) return bad(res, 'Not found', 404);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return bad(res, 'Empty message');
  const msg = await postMessage(convId, req.user.id, 'text', body);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (conv.is_ai || /(^|\s)@ai\b/i.test(body)) aiRespond(convId, req.user.id, 'reply', body.replace(/@ai\b/gi, '').trim());
  res.json({ message: msg });
}));

api.post('/conversations/:id/plan', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return bad(res, 'Not found', 404);
  if (aiBusy.has(req.params.id)) return bad(res, 'Planner is already working on it', 409);
  aiRespond(req.params.id, req.user.id, 'plan');
  res.json({ started: true });
});

// Confirm (optionally edited) plan card -> real event + invites.
api.post('/messages/:id/confirm-plan', wrap(async (req, res) => {
  const m = parseRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id));
  if (!m || m.kind !== 'plan' || !isMember(m.conversation_id, req.user.id)) return bad(res, 'Not found', 404);
  if (m.data.status === 'created') return res.json({ event_id: m.data.event_id });
  const convRow = db.prepare('SELECT is_ai FROM conversations WHERE id = ?').get(m.conversation_id);
  const members = (convRow?.is_ai ? [req.user.id, ...friendIds(req.user.id)] : memberIds(m.conversation_id)).map(getUser).filter(Boolean);
  const edited = { ...m.data.plan, ...(req.body || {}) };
  if (req.body?.participant_ids) edited.participants = members.filter((u) => req.body.participant_ids.includes(u.id)).map((u) => u.username);
  else edited.participants = members.filter((u) => m.data.plan.participant_ids.includes(u.id)).map((u) => u.username);
  const plan = normalizePlan(edited, members);
  if (!plan.start_at) return bad(res, 'Pick a date first');
  const ids = plan.participant_ids.includes(req.user.id) ? plan.participant_ids : [req.user.id, ...plan.participant_ids];
  const ev = await createEvent(req.user, { ...plan, participant_ids: ids, conversation_id: m.conversation_id });
  const data = { ...m.data, plan, status: 'created', event_id: ev.id, confirmed_by: req.user.id };
  db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(JSON.stringify(data), m.id);
  const updated = messagePayload(parseRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id)));
  emitToUsers(memberIds(m.conversation_id), 'message:update', updated);
  await postMessage(m.conversation_id, null, 'system', `${req.user.display_name} locked it in: ${ev.title} · ${formatWhen(ev.start_at, ev.end_at)}. Invites sent.`);
  res.json({ event_id: ev.id });
}));

// ---------- quick invites (video call / chill) ----------
api.post('/invites', wrap(async (req, res) => {
  const { to_ids = [], kind = 'call', message = '' } = req.body || {};
  if (!['call', 'chill'].includes(kind)) return bad(res, 'Bad kind');
  const to = [...new Set(to_ids)].filter((u) => areFriends(req.user.id, u));
  if (!to.length) return bad(res, 'Pick a friend');
  const room = kind === 'call' ? id() : null;
  const created = [];
  for (const uid of to) {
    const iid = id();
    db.prepare('INSERT INTO invites (id, from_id, to_id, kind, message, room_id) VALUES (?,?,?,?,?,?)').run(iid, req.user.id, uid, kind, String(message).slice(0, 200), room);
    const inv = { id: iid, kind, message, room_id: room, from: publicUser(req.user), created_at: now() };
    created.push(inv);
    emitToUser(uid, 'invite', inv);
    await notify([uid], {
      kind: `invite_${kind}`,
      title: kind === 'call' ? `${req.user.display_name} wants to video call` : `${req.user.display_name} wants to chill`,
      body: message || (kind === 'call' ? 'Tap to join the call' : 'You down? Tap to answer'),
      url: `/invite/${iid}`,
      tag: `invite-${iid}`,
      requireInteraction: kind === 'call',
      data: { invite_id: iid, room_id: room },
      actions: [
        { action: 'accept', title: kind === 'call' ? 'Join' : "I'm down", url: `/invite/${iid}?act=accept` },
        { action: 'decline', title: 'Not now', url: `/invite/${iid}?act=decline` },
      ],
    });
  }
  res.json({ invites: created, room_id: room });
}));

// Call history: every video call you started or were invited to.
api.get('/calls', (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM invites WHERE kind = 'call' AND (from_id = ? OR to_id = ?) ORDER BY created_at DESC LIMIT 120`
  ).all(req.user.id, req.user.id);
  const byRoom = new Map();
  for (const r of rows) {
    const outgoing = r.from_id === req.user.id;
    const key = outgoing ? r.room_id : r.id;
    const other = publicUser(getUser(outgoing ? r.to_id : r.from_id));
    if (!other) continue;
    if (!byRoom.has(key)) byRoom.set(key, { id: key, room_id: r.room_id, outgoing, people: [], status: r.status, created_at: r.created_at });
    const c = byRoom.get(key);
    c.people.push(other);
    if (r.status === 'accepted') c.status = 'accepted';
  }
  const calls = [...byRoom.values()].map((c) => ({ ...c, missed: !c.outgoing && c.status !== 'accepted' }));
  res.json({ calls: calls.slice(0, 60) });
});

api.get('/invites', (req, res) => {
  const since = new Date(Date.now() - 12 * 3600000).toISOString();
  const rows = db.prepare(`SELECT * FROM invites WHERE to_id = ? AND status = 'pending' AND created_at > ? ORDER BY created_at DESC`).all(req.user.id, since);
  res.json({ invites: rows.map((r) => ({ ...r, from: publicUser(getUser(r.from_id)) })) });
});

api.get('/invites/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE id = ? AND (to_id = ? OR from_id = ?)').get(req.params.id, req.user.id, req.user.id);
  if (!r) return bad(res, 'Not found', 404);
  res.json({ invite: { ...r, from: publicUser(getUser(r.from_id)) } });
});

api.post('/invites/:id/respond', wrap(async (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE id = ? AND to_id = ?').get(req.params.id, req.user.id);
  if (!r) return bad(res, 'Not found', 404);
  const accept = !!req.body?.accept;
  db.prepare('UPDATE invites SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', r.id);
  const what = r.kind === 'call' ? 'video call' : 'chill';
  await notify([r.from_id], {
    kind: 'invite_response',
    title: accept ? `${req.user.display_name} accepted your ${what}` : `${req.user.display_name} can't right now`,
    body: accept ? (r.kind === 'call' ? 'Joining the call now' : "They're down. Sort out the details in chat.") : `Declined your ${what} invite`,
    url: r.kind === 'call' && accept ? `/call/${r.room_id}` : '/',
  });
  emitToUser(r.from_id, 'invite:response', { invite_id: r.id, accept, by: publicUser(req.user) });
  res.json({ ok: true, room_id: r.room_id });
}));

// ---------- notifications ----------
api.get('/notifications', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id).map((n) => parseRow(n));
  res.json({ notifications: rows, unread: rows.filter((n) => !n.read).length });
});
api.post('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});
api.post('/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- AI: schedule straight onto the calendar ----------
// "gym with Sipho friday after work" -> plan with a time that works for everyone + a reminder.
api.post('/ai/schedule', wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) return bad(res, 'Tell Planner what to schedule');
  const hint = req.body?.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? ` (the user has ${req.body.date} selected on their calendar)` : '';
  try {
    const out = await runAI(null, {
      mode: 'schedule', requesterId: req.user.id, instruction: text + hint,
      memberIdsOverride: [req.user.id, ...friendIds(req.user.id)],
    });
    res.json(out);
  } catch (e) {
    console.warn('[ai] schedule error', e.message);
    res.status(503).json({ error: e.name === 'AbortError' ? 'Planner timed out, try again' : 'Planner is offline (cannot reach your local model)' });
  }
}));

// ---------- AI status ----------
api.get('/ai/status', wrap(async (req, res) => {
  try {
    const r = await fetch(`${aiInfo.base}/models`, { signal: AbortSignal.timeout(4000) });
    res.json({ online: r.ok, model: aiInfo.model });
  } catch {
    res.json({ online: false, model: aiInfo.model });
  }
}));

export { isOnline };
