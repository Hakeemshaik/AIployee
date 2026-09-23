import { db, memberIds, getUser } from './db.js';
import { TZ, nextDays, zonedToDate, dateKey, timeKey } from './time.js';

const BASE = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'llama3.2:3b';
const KEY = process.env.LLM_API_KEY || 'ollama';
const TIMEOUT = Number(process.env.LLM_TIMEOUT_MS || 180000);
const JSON_MODE = process.env.LLM_JSON_MODE !== 'false';

export const aiInfo = { base: BASE, model: MODEL };

async function chat(messages) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        stream: false,
        ...(JSON_MODE ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(t);
  }
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

function scheduleContext(userIds, days) {
  const from = days[0].date;
  const to = days[days.length - 1].date;
  const lines = [];
  for (const uid of userIds) {
    const u = getUser(uid);
    if (!u) continue;
    const blocks = db
      .prepare('SELECT * FROM availability WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time')
      .all(uid, from, to)
      .map((a) => `${a.date} ${a.kind}${a.start_time ? ` ${a.start_time}-${a.end_time}` : ' all day'}`);
    const evs = db
      .prepare(
        `SELECT e.* FROM events e JOIN event_members m ON m.event_id = e.id
         WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.end_at >= ? ORDER BY e.start_at LIMIT 15`
      )
      .all(uid, new Date().toISOString())
      .map((e) => `${dateKey(e.start_at)} ${timeKey(e.start_at)} event "${e.title}"`);
    const all = [...blocks, ...evs];
    lines.push(`- ${u.display_name} (@${u.username}): ${all.length ? all.join('; ') : 'nothing blocked, free every day'}`);
  }
  return lines.join('\n');
}

function transcript(convId, limit = 40) {
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(convId, limit)
    .reverse();
  return rows
    .map((m) => {
      if (m.kind === 'plan') return `Planner: [proposed a plan card]`;
      const who = m.sender_id ? getUser(m.sender_id)?.display_name || 'Someone' : 'Planner';
      return `${who}: ${m.body}`;
    })
    .join('\n');
}

const SYSTEM = `You are "Planner", the AI inside a friends' planning app. Friends chat, and you help them
turn conversations into real plans (trips, hangouts, meetings, video calls, events) on their shared calendar.
You ALWAYS answer with a single JSON object and nothing else:
{
  "reply": "short, casual message (max 2 sentences)",
  "plan": null OR {
    "title": "short event title",
    "type": "trip" | "hangout" | "meeting" | "call" | "event",
    "date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD or null (only for multi-day trips)",
    "start_time": "HH:MM 24h, or null if no time was said (the app then picks the first free slot)",
    "end_time": "HH:MM 24h or null",
    "location": "place or empty string",
    "notes": "key details agreed (who brings what, budget, etc.) or empty string",
    "participants": ["username", ...],
    "reminder_minutes": number of minutes before the start to remind everyone (15, 30, 60, 120 or 1440)
  }
}
Rules:
- Resolve relative dates ("this Saturday", "tomorrow", "next weekend") using the calendar provided. Never invent a past date.
- Pick times when the people involved are free according to their schedules. "After work" means 17:30 or later.
- Pick a sensible reminder: calls 15, hangouts 60, meetings 30, trips 1440 (a day before), unless they asked for one.
- participants are usernames from the member list.
- If people ask when others are free, answer from the schedules provided.`;

export async function runAI(convId, { mode = 'reply', requesterId, instruction = '', memberIdsOverride, personal = false } = {}) {
  const ids = memberIdsOverride || memberIds(convId);
  const members = ids.map(getUser).filter(Boolean);
  const days = nextDays(21);
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());
  const requester = getUser(requesterId);

  const context = `Now: ${nowStr} (${TZ}).
Calendar (next 21 days):
${days.map((d) => `${d.date} = ${d.label}`).join('\n')}

${mode === 'schedule' || personal ? `The user is ${requester?.display_name} (username: ${requester?.username}). Their friends:` : 'Members of this chat:'}
${members.map((m) => `- ${m.display_name} (username: ${m.username})`).join('\n')}

Schedules (busy / work blocks and events already booked):
${scheduleContext(ids, days)}
${convId ? `\nChat so far:\n${transcript(convId) || '(empty)'}` : ''}`;

  const who = requester?.display_name || 'A member';
  const ask = {
    plan: `${who} tapped "Plan it". Extract the plan being discussed in the chat above and return it in "plan". Put a one-line summary in "reply". If there is truly nothing to plan, set "plan": null and say what's missing.`,
    schedule: `${who} wants you to put this on the calendar: "${instruction}". Always return a "plan". Include ${requester?.username} in participants plus only the friends they mentioned. Choose the date and time, and a reminder. In "reply", say in one line when you booked it and why that slot works.`,
    reply: personal
      ? `${who} (in their private chat with you) says: "${instruction}". Answer in "reply". If they want something booked, planned or reminded, fill "plan": include ${requester?.username} plus only the friends they mention, pick a time when those people are free, and a reminder.`
      : `${who} asked you: "${instruction}". Answer in "reply". If they are asking you to set up / book / plan something, also fill "plan".`,
  }[mode];

  const raw = await chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${context}\n\n${ask}` },
  ]);
  const parsed = extractJSON(raw);
  if (!parsed) return { reply: raw.trim().slice(0, 1000) || "I couldn't work that out, try again?", plan: null };
  const solo = mode === 'schedule' || personal;
  const defaultIds = solo ? [requesterId] : null;
  return {
    reply: String(parsed.reply || '').slice(0, 1000),
    plan: parsed.plan ? normalizePlan(parsed.plan, members, { defaultIds, requesterId: solo ? requesterId : null, from: searchFromHint(instruction) }) : null,
  };
}

const TYPES = ['trip', 'hangout', 'meeting', 'call', 'event'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const pad = (t) => t.padStart(5, '0');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DEFAULT_TIMES = { trip: ['08:00', '18:00'], meeting: ['10:00', '11:00'], call: ['19:00', '20:00'], hangout: ['18:00', '21:00'], event: ['18:00', '21:00'] };
const WORK = [8 * 60, 17 * 60];
const DEFAULT_REMINDER = { trip: 1440, meeting: 30, call: 15, hangout: 60, event: 60 };

/** Busy intervals (minutes from local midnight) for a set of users on a date. */
function busyIntervals(userIds, date) {
  const dayStart = zonedToDate(date, '00:00').getTime();
  const out = [];
  for (const uid of userIds) {
    for (const b of db.prepare(`SELECT * FROM availability WHERE user_id = ? AND date = ? AND kind IN ('busy','work')`).all(uid, date)) {
      // An all-day "work" block means office hours; evenings stay open. All-day "busy" blocks the whole day.
      out.push(b.start_time ? [toMin(b.start_time), toMin(b.end_time)] : b.kind === 'work' ? [WORK[0], WORK[1]] : [0, 1440]);
    }
    const evs = db.prepare(
      `SELECT e.start_at, e.end_at FROM events e JOIN event_members m ON m.event_id = e.id
       WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.start_at < ? AND e.end_at > ?`
    ).all(uid, new Date(dayStart + 86400000).toISOString(), new Date(dayStart).toISOString());
    for (const e of evs) {
      out.push([Math.max(0, (Date.parse(e.start_at) - dayStart) / 60000), Math.min(1440, (Date.parse(e.end_at) - dayStart) / 60000)]);
    }
  }
  return out;
}

/** First slot on `date` where everyone is free, searching from `from` in 30-min steps. */
export function findFreeSlot(userIds, date, durationMin, from = '09:00', until = '22:00') {
  const busy = busyIntervals(userIds, date);
  let start = toMin(from);
  const nowMin = date === dateKey(new Date()) ? toMin(timeKey(new Date())) + 30 : 0;
  start = Math.max(start, Math.ceil(nowMin / 30) * 30);
  for (let t = start; t + durationMin <= toMin(until); t += 30) {
    if (!busy.some(([a, b]) => t < b && t + durationMin > a)) return toHHMM(t);
  }
  return null;
}

/** Earliest sensible start for the free-slot search, from words in the request. */
export function searchFromHint(text = '') {
  const t = text.toLowerCase();
  if (/after work|evening|tonight|after 5|after five/.test(t)) return '17:30';
  if (/lunch/.test(t)) return '12:00';
  if (/afternoon/.test(t)) return '13:00';
  if (/morning|breakfast|early/.test(t)) return '07:00';
  return null;
}

export function normalizePlan(p, members, { defaultIds = null, requesterId = null, from: hintFrom = null } = {}) {
  const type = TYPES.includes(p.type) ? p.type : 'hangout';
  const today = dateKey(new Date());
  const date = isDate(p.date) && p.date >= today ? p.date : null;
  const endDate = isDate(p.end_date) && date && p.end_date > date ? p.end_date : null;

  const wanted = Array.isArray(p.participants) ? p.participants.map((x) => String(x).toLowerCase().replace(/^@/, '')) : [];
  let participants = members.filter((m) => wanted.includes(m.username.toLowerCase()) || wanted.includes(m.display_name.toLowerCase()));
  if (requesterId && !participants.some((m) => m.id === requesterId)) participants.unshift(members.find((m) => m.id === requesterId));
  participants = participants.filter(Boolean);
  if (!participants.length) participants = defaultIds ? members.filter((m) => defaultIds.includes(m.id)) : members;
  const pids = participants.map((m) => m.id);

  const [dStart, dEnd] = DEFAULT_TIMES[type];
  const duration = isTime(p.start_time) && isTime(p.end_time) && toMin(p.end_time) > toMin(p.start_time)
    ? toMin(p.end_time) - toMin(p.start_time) : toMin(dEnd) - toMin(dStart);
  let start = isTime(p.start_time) ? pad(p.start_time) : null;
  let autoPicked = false;
  if (!start && date && !endDate) {
    const from = hintFrom || (type === 'meeting' ? '09:00' : type === 'call' ? '17:00' : '10:00');
    start = findFreeSlot(pids, date, duration, from) || findFreeSlot(pids, date, Math.min(duration, 60), from);
    autoPicked = !!start;
  }
  start = start || dStart;
  let end = isTime(p.end_time) && toMin(p.end_time) > toMin(start) ? pad(p.end_time) : toHHMM(Math.min(toMin(start) + duration, 23 * 60 + 59));
  if (endDate && isTime(p.end_time)) end = pad(p.end_time);
  else if (endDate) end = dEnd;

  const rm = Number(p.reminder_minutes);
  const reminder = Number.isFinite(rm) && rm >= 5 && rm <= 10080 ? Math.round(rm) : DEFAULT_REMINDER[type];

  const plan = {
    title: String(p.title || 'Plan').slice(0, 120),
    type,
    date,
    end_date: endDate,
    start_time: start,
    end_time: end,
    location: String(p.location || '').slice(0, 200),
    notes: String(p.notes || '').slice(0, 1000),
    participant_ids: pids,
    reminder_minutes: reminder,
    auto_time: autoPicked,
    missing: date ? [] : ['date'],
  };
  if (date) {
    plan.start_at = zonedToDate(date, start).toISOString();
    plan.end_at = zonedToDate(endDate || date, end).toISOString();
    plan.conflicts = conflictsFor(pids, date, endDate || date, plan.start_at, plan.end_at);
  }
  return plan;
}

/** Who is busy during the plan window (blocks or other events). */
export function conflictsFor(userIds, from, to, startISO, endISO) {
  const out = [];
  const s = startISO ? Date.parse(startISO) : null;
  const e = endISO ? Date.parse(endISO) : null;
  for (const uid of userIds) {
    const details = [];
    for (const r of db.prepare(`SELECT * FROM availability WHERE user_id = ? AND date BETWEEN ? AND ? AND kind IN ('busy','work')`).all(uid, from, to)) {
      const win = r.start_time ? [r.start_time, r.end_time] : r.kind === 'work' ? [toHHMM(WORK[0]), toHHMM(WORK[1])] : null;
      if (s && win) {
        const bs = zonedToDate(r.date, win[0]).getTime();
        const be = zonedToDate(r.date, win[1]).getTime();
        if (!(s < be && e > bs)) continue;
      }
      details.push(`${r.kind === 'work' ? 'working' : 'busy'}${win ? ` ${win[0]}-${win[1]}` : ' all day'}`);
    }
    if (s) {
      for (const ev of db.prepare(
        `SELECT e.title, e.start_at, e.end_at FROM events e JOIN event_members m ON m.event_id = e.id
         WHERE m.user_id = ? AND m.rsvp != 'declined' AND e.start_at < ? AND e.end_at > ?`
      ).all(uid, new Date(e).toISOString(), new Date(s).toISOString())) details.push(`"${ev.title}" at ${timeKey(ev.start_at)}`);
    }
    if (details.length) out.push({ user_id: uid, name: getUser(uid)?.display_name, detail: details.join(', ') });
  }
  return out;
}
