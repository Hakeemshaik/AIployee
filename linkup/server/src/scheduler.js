import { db } from './db.js';
import { notify } from './notify.js';
import { formatWhen } from './time.js';

function humanLead(mins) {
  if (mins >= 1440 && mins % 1440 === 0) return mins === 1440 ? 'tomorrow' : `in ${mins / 1440} days`;
  if (mins >= 60 && mins % 60 === 0) return mins === 60 ? 'in 1 hour' : `in ${mins / 60} hours`;
  return `in ${mins} min`;
}

async function tick() {
  const nowMs = Date.now();
  const due = db.prepare(`SELECT * FROM events WHERE reminder_sent = 0 AND start_at > ?`).all(new Date(nowMs - 5 * 60000).toISOString());
  for (const e of due) {
    const startMs = Date.parse(e.start_at);
    if (startMs - e.reminder_minutes * 60000 > nowMs) continue;
    db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(e.id);
    const members = db.prepare(`SELECT user_id FROM event_members WHERE event_id = ? AND rsvp != 'declined'`).all(e.id).map((r) => r.user_id);
    const minsLeft = Math.max(0, Math.round((startMs - nowMs) / 60000));
    const lead = minsLeft <= 1 ? 'now' : humanLead(Math.abs(minsLeft - e.reminder_minutes) <= 1 ? e.reminder_minutes : minsLeft);
    const actions = e.type === 'call' && e.call_room
      ? [{ action: 'join', title: 'Join call', url: `/call/${e.call_room}` }]
      : [{ action: 'open', title: 'View plan', url: `/event/${e.id}` }];
    await notify(members, {
      kind: 'reminder',
      title: `Reminder: ${e.title} ${lead === 'now' ? 'is starting' : lead}`,
      body: [formatWhen(e.start_at, e.end_at), e.location, e.notes].filter(Boolean).join(' · ').slice(0, 240),
      url: `/event/${e.id}`,
      tag: `reminder-${e.id}`,
      actions,
      alwaysPush: true,
    });
  }
}

export function startScheduler() {
  setInterval(() => tick().catch((e) => console.warn('[scheduler]', e.message)), 30000);
  setTimeout(() => tick().catch(() => {}), 3000);
}
