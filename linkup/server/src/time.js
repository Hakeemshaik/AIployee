export const TZ = process.env.APP_TIMEZONE || 'Africa/Johannesburg';

function tzOffsetMs(ts, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(ts / 1000) * 1000;
}

/** "2026-10-04" + "14:30" in tz -> Date */
export function zonedToDate(date, time = '00:00', tz = TZ) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  let off = tzOffsetMs(guess, tz);
  let ts = guess - off;
  const off2 = tzOffsetMs(ts, tz);
  if (off2 !== off) ts = guess - off2;
  return new Date(ts);
}

/** Date -> "YYYY-MM-DD" in tz */
export function dateKey(d, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

export function timeKey(d, tz = TZ) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
}

export function nextDays(n, tz = TZ) {
  const out = [];
  const start = zonedToDate(dateKey(new Date(), tz), '12:00', tz).getTime();
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * 86400000);
    out.push({
      date: dateKey(d, tz),
      label: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d),
    });
  }
  return out;
}

export function formatWhen(startISO, endISO, tz = TZ) {
  const s = new Date(startISO);
  const e = endISO ? new Date(endISO) : null;
  const day = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  const t = (d) => timeKey(d, tz);
  if (!e || dateKey(s, tz) === dateKey(e, tz)) return `${day(s)}, ${t(s)}${e ? `–${t(e)}` : ''}`;
  return `${day(s)} ${t(s)} → ${day(e)} ${t(e)}`;
}
