import { db, id } from './db.js';
import { emitToUser, isVisible } from './realtime.js';
import { sendPush } from './push.js';

/**
 * Create a notification for each user: store it, deliver in-app via socket,
 * and send a Web Push with the full content when the app isn't open on screen.
 *
 * opts: { kind, title, body, url, data, actions: [{action,title,url}], tag, requireInteraction, alwaysPush }
 */
export async function notify(userIds, opts) {
  const out = [];
  for (const uid of new Set(userIds)) {
    const n = {
      id: id(),
      user_id: uid,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      url: opts.url || '/',
      data: { ...(opts.data || {}), actions: opts.actions || [] },
      read: 0,
      created_at: new Date().toISOString(),
    };
    if (opts.store !== false) {
      db.prepare(
        'INSERT INTO notifications (id, user_id, kind, title, body, url, data, read, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(n.id, uid, n.kind, n.title, n.body, n.url, JSON.stringify(n.data), 0, n.created_at);
    }
    emitToUser(uid, 'notification', n);

    // If the app is open and visible on any device, the in-app toast/ring handles it.
    // Otherwise send a real push notification with the actual content.
    if (opts.alwaysPush || !isVisible(uid)) {
      sendPush(uid, {
        id: n.id,
        title: n.title,
        body: n.body,
        url: n.url,
        kind: n.kind,
        tag: opts.tag || n.id,
        actions: (opts.actions || []).slice(0, 2),
        requireInteraction: !!opts.requireInteraction,
        timestamp: Date.now(),
      }).catch((e) => console.warn('[push] error', e.message));
    }
    out.push(n);
  }
  return out;
}
