export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const timeOf = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromKey = (key, time = '00:00') => { const [y, m, d] = key.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtLongDay = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtTime = (d) => timeOf(d);

export function fmtRange(s, e) {
  const a = new Date(s), b = new Date(e);
  if (dayKey(a) === dayKey(b)) return `${fmtDay(a)}, ${fmtTime(a)}–${fmtTime(b)}`;
  return `${fmtDay(a)} ${fmtTime(a)} → ${fmtDay(b)} ${fmtTime(b)}`;
}

export function relDay(d) {
  const k = dayKey(d);
  const today = dayKey(new Date());
  if (k === today) return 'Today';
  if (k === dayKey(addDays(new Date(), 1))) return 'Tomorrow';
  return fmtDay(d);
}

export function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return fmtDay(iso);
}
