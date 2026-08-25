// Formatting helpers — ZAR currency, dates and durations.
// Locale is fixed to en-ZA so server and client render identically.

const zar = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const zarCents = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** R184 500 — whole-rand display for dashboards and tables. */
export function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return zar.format(Math.round(amount)).replace(/ /g, " ");
}

/** R1 250.50 — cents shown, for payment records. */
export function moneyExact(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return zarCents.format(amount).replace(/ /g, " ");
}

/** Compact money for chart axes: R1.2m / R840k / R950. */
export function moneyCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `R${(amount / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `R${Math.round(amount / 1_000)}k`;
  return `R${Math.round(amount)}`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return `${formatDate(d)}, ${d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
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
