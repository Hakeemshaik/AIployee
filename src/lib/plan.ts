import type { AppData, MealSlot, PlanItem, RecurringMeal } from '../types'
import { weekdayOf } from './date'

/** A plan item resolved onto a specific date, tagged with where it came from. */
export interface ResolvedPlanItem extends PlanItem {
  source: 'day' | 'recurring'
  /** Set when `source` is 'recurring'. */
  recurringId?: string
  recurringName?: string
}

export function recurringAppliesOn(r: RecurringMeal, date: string): boolean {
  if (!r.active) return false
  if (!r.weekdays.includes(weekdayOf(date))) return false
  if (r.startDate && date < r.startDate) return false
  if (r.endDate && date > r.endDate) return false
  if (r.skipDates.includes(date)) return false
  return true
}

/**
 * Everything planned for a date: the one-off items saved against that date,
 * plus every recurring meal whose weekday matches.
 */
export function resolvePlan(data: AppData, date: string): ResolvedPlanItem[] {
  const out: ResolvedPlanItem[] = []

  for (const r of data.recurring) {
    if (!recurringAppliesOn(r, date)) continue
    for (const item of r.items) {
      out.push({
        ...item,
        // Ids must be unique per date so React keys and skip actions stay stable.
        id: `${r.id}:${item.id}:${date}`,
        meal: r.meal,
        source: 'recurring',
        recurringId: r.id,
        recurringName: r.name,
      })
    }
  }

  const day = data.planDays[date]
  if (day) {
    for (const item of day.items) out.push({ ...item, source: 'day' })
  }

  return out
}

export function planByMeal(items: ResolvedPlanItem[]): Record<MealSlot, ResolvedPlanItem[]> {
  const out: Record<MealSlot, ResolvedPlanItem[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  }
  for (const item of items) out[item.meal].push(item)
  return out
}
