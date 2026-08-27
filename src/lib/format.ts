// Formatting helpers — ZAR currency, dates and durations.
//
// Currency is formatted here rather than by Intl, because Intl's en-ZA
// separators differ between ICU builds: Node groups with a no-break space and
// uses a comma for cents, Chromium groups with a comma and uses a full stop.
// Fixing the locale is not enough — server and client HTML disagreed, so React
// threw away the server-rendered tree and re-rendered on every load. These
// helpers produce the same string everywhere: "R 271 950" and "R 1 250,50",
// which is what the server has always rendered.

/** Insert a space every three digits, from the right. */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatZar(amount: number, decimals: 0 | 2): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const fixed = absolute.toFixed(decimals);
  const [whole, cents] = fixed.split(".");
  const body = cents ? `${groupDigits(whole)},${cents}` : groupDigits(whole);
  return `${negative ? "-" : ""}R ${body}`;
}

/** R 184 500 — whole-rand display for dashboards and tables. */
export function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  // Round first, so 999.6 groups as "1 000" rather than "999" + carry.
  return formatZar(Math.round(amount), 0);
}

/** R 1 250,50 — cents shown, for payment records. */
export function moneyExact(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return formatZar(amount, 2);
}

/** Compact money for chart axes: R1.2m / R840k / R950. */
export function moneyCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `R${(amount / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `R${Math.round(amount / 1_000)}k`;
  return `R${Math.round(amount)}`;
}

/**
 * 2 700 — a plain count, grouped the same way money is.
 *
 * toLocaleString("en-ZA") has the identical ICU split as currency: Node groups
 * with a no-break space, Chromium with a comma, so a server-rendered count and
 * its client re-render disagree and React discards the tree.
 */
export function count(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const negative = value < 0;
  return `${negative ? "-" : ""}${groupDigits(Math.abs(Math.round(value)).toString())}`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

// Dates are rendered in South African time, whatever the machine is set to.
//
// Timestamps are stored in UTC and the server runs in UTC, so relying on the
// local zone showed a 20:30 SAST call as 18:30 on a server-rendered page and
// 20:30 once the browser took over — wrong for a collections team, and a
// hydration mismatch besides. The zone is pinned instead, and the string is
// assembled from numeric parts so no locale pattern can vary between ICU
// builds.
const SAST_ZONE = "Africa/Johannesburg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sastParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAST_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type Wall = { day: number; month: number; year: number; hour: string; minute: string };

function wallClock(d: Date): Wall | null {
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Map(sastParts.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = parts.get("hour") ?? "00";
  return {
    day: Number(parts.get("day")),
    month: Number(parts.get("month")),
    year: Number(parts.get("year")),
    // Some ICU builds render midnight as "24" under hour12: false.
    hour: hour === "24" ? "00" : hour.padStart(2, "0"),
    minute: (parts.get("minute") ?? "00").padStart(2, "0"),
  };
}

function toDate(date: Date | string): Date {
  return typeof date === "string" ? new Date(date) : date;
}

/** 17 Aug 2026, in SAST. */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const w = wallClock(toDate(date));
  if (!w) return "—";
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
}

/** 17 Aug 2026, 09:26 — SAST. */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const w = wallClock(toDate(date));
  if (!w) return "—";
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}, ${w.hour}:${w.minute}`;
}

/** 09:26 — SAST. */
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const w = wallClock(toDate(date));
  if (!w) return "—";
  return `${w.hour}:${w.minute}`;
}

/** 4:05 for 245 seconds. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "3 days ago" / "in 2 days" / "today" */
export function relativeDays(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const days = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days < 0 ? `${-days} days ago` : `in ${days} days`;
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}
