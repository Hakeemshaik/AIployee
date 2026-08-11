/**
 * Date helpers. Dates are handled as local-time ISO strings (YYYY-MM-DD) so a
 * day never shifts because of a timezone conversion.
 */

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  return toISO(new Date())
}

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function diffDays(a: string, b: string): number {
  const ms = fromISO(a).getTime() - fromISO(b).getTime()
  return Math.round(ms / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: string): number {
  return fromISO(iso).getDay()
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** Weekday order for display, respecting the week-start preference. */
export function weekdayOrder(mondayFirst: boolean): number[] {
  return mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
}

/** The 7 ISO dates of the week containing `iso`. */
export function weekDates(iso: string, mondayFirst: boolean): string[] {
  const dow = weekdayOf(iso)
  const offset = mondayFirst ? (dow === 0 ? -6 : 1 - dow) : -dow
  const start = addDays(iso, offset)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** "Today", "Yesterday", "Tomorrow", else "Mon 12 Aug". */
export function friendlyDate(iso: string, today = todayISO()): string {
  const delta = diffDays(iso, today)
  if (delta === 0) return 'Today'
  if (delta === -1) return 'Yesterday'
  if (delta === 1) return 'Tomorrow'
  return fromISO(iso).toLocaleDateString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function longDate(iso: string): string {
  return fromISO(iso).toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function shortDate(iso: string): string {
  return fromISO(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 1000) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/** The last `n` days ending today, oldest first. */
export function lastNDays(n: number, today = todayISO()): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)))
}
