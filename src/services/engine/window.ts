// ---------------------------------------------------------------------------
// When calling is allowed at all.
//
// Two different things, deliberately kept apart:
//
//  * THE LAW — the Debt Collectors Act Code of Conduct: no calls before 06:00
//    or after 21:00, none on Sundays, none on public holidays. Hard-coded.
//    Nothing on any screen can widen it, and it is enforced here on the
//    server, not in a disabled button.
//
//  * THE DEFAULT — 08:00–12:00, because that is where the answer rate is.
//    The campaign's own window can widen this, but only inside the law.
//
// Everything is evaluated in SAST (UTC+2, no daylight saving), whatever
// timezone the server thinks it is in.
// ---------------------------------------------------------------------------

const LEGAL_START_HOUR = 6;
const LEGAL_END_HOUR = 21;

/** SA public holidays: fixed dates as [month, day] (1-based month). */
const FIXED_HOLIDAYS: [number, number, string][] = [
  [1, 1, "New Year's Day"],
  [3, 21, "Human Rights Day"],
  [4, 27, "Freedom Day"],
  [5, 1, "Workers' Day"],
  [6, 16, "Youth Day"],
  [8, 9, "National Women's Day"],
  [9, 24, "Heritage Day"],
  [12, 16, "Day of Reconciliation"],
  [12, 25, "Christmas Day"],
  [12, 26, "Day of Goodwill"],
];

/** Easter Sunday (Gregorian computus) — Good Friday and Family Day hang off it. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Is this SAST calendar date a public holiday, and which?
 *
 * Includes the Public Holidays Act rule that a holiday falling on a Sunday is
 * observed on the following Monday — those Mondays are holidays too.
 */
export function publicHoliday(sastYear: number, sastMonth: number, sastDay: number): string | null {
  const isDate = (m: number, d: number) => sastMonth === m && sastDay === d;

  for (const [month, day, name] of FIXED_HOLIDAYS) {
    if (isDate(month, day)) return name;
    // Observed Monday: the holiday fell on yesterday's Sunday.
    const observed = new Date(Date.UTC(sastYear, month - 1, day));
    if (observed.getUTCDay() === 0) {
      const monday = new Date(Date.UTC(sastYear, month - 1, day + 1));
      if (isDate(monday.getUTCMonth() + 1, monday.getUTCDate())) return `${name} (observed)`;
    }
  }

  const easter = easterSunday(sastYear);
  const easterDate = new Date(Date.UTC(sastYear, easter.month - 1, easter.day));
  const goodFriday = new Date(easterDate.getTime() - 2 * 86_400_000);
  const familyDay = new Date(easterDate.getTime() + 1 * 86_400_000);
  if (isDate(goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate())) return "Good Friday";
  if (isDate(familyDay.getUTCMonth() + 1, familyDay.getUTCDate())) return "Family Day";
  return null;
}

export type EngineWindowCheck = { allowed: boolean; reason: string; sastTime: string };

function parseHour(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  return Number(match[1]) + Number(match[2]) / 60;
}

/**
 * The gate every batch start passes through.
 *
 * `windowStart`/`windowEnd` are the campaign's own hours ("08:00" style).
 * They are clamped to the legal bounds rather than trusted — a campaign
 * configured for 05:00 starts at 06:00 and no error is needed to say so,
 * but the 05:00 dial simply never happens.
 */
export function checkEngineWindow(
  windowStart: string,
  windowEnd: string,
  now: Date = new Date(),
): EngineWindowCheck {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const day = sast.getUTCDay();
  const hour = sast.getUTCHours() + sast.getUTCMinutes() / 60;
  const stamp = `${String(sast.getUTCHours()).padStart(2, "0")}:${String(sast.getUTCMinutes()).padStart(2, "0")} SAST`;

  if (day === 0) {
    return { allowed: false, reason: "No calls on Sundays — Debt Collectors Act Code of Conduct.", sastTime: stamp };
  }
  const holiday = publicHoliday(sast.getUTCFullYear(), sast.getUTCMonth() + 1, sast.getUTCDate());
  if (holiday) {
    return { allowed: false, reason: `No calls on public holidays — today is ${holiday}.`, sastTime: stamp };
  }

  const start = Math.max(LEGAL_START_HOUR, parseHour(windowStart, 8));
  const end = Math.min(LEGAL_END_HOUR, parseHour(windowEnd, 12));
  if (hour < start || hour >= end) {
    const fmt = (h: number) =>
      `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
    return {
      allowed: false,
      reason: `Outside the calling window (${fmt(start)}–${fmt(end)} SAST; the law allows 06:00–21:00 at most). It is ${stamp}.`,
      sastTime: stamp,
    };
  }
  return { allowed: true, reason: "Within the calling window.", sastTime: stamp };
}
