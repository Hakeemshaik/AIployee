import type { AppData, Settings } from '../types'

const KEY = 'macros.v1'
export const DATA_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  goals: {
    kcal: 2200,
    protein: 160,
    carbs: 220,
    fat: 70,
    fibre: 30,
    sugar: 60,
    sodium: 2300,
  },
  trackedNutrients: ['protein', 'carbs', 'fat'],
  theme: 'system',
  weekStartsMonday: true,
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    foods: {},
    hiddenFoodIds: [],
    favouriteFoodIds: [],
    log: [],
    planDays: {},
    recurring: [],
    savedMeals: [],
    weights: [],
  }
}

/**
 * Fills in anything missing from a stored blob, so an older or hand-edited
 * import can never crash the app on load.
 */
export function normalise(raw: unknown): AppData {
  const base = emptyData()
  if (!raw || typeof raw !== 'object') return base
  const d = raw as Partial<AppData>

  return {
    version: DATA_VERSION,
    settings: {
      ...base.settings,
      ...(d.settings ?? {}),
      goals: { ...base.settings.goals, ...(d.settings?.goals ?? {}) },
      trackedNutrients: d.settings?.trackedNutrients ?? base.settings.trackedNutrients,
    },
    foods: d.foods ?? {},
    hiddenFoodIds: d.hiddenFoodIds ?? [],
    favouriteFoodIds: d.favouriteFoodIds ?? [],
    log: (d.log ?? []).filter((e) => e && e.snapshot && typeof e.qty === 'number'),
    planDays: d.planDays ?? {},
    recurring: (d.recurring ?? []).map((r) => ({ ...r, skipDates: r.skipDates ?? [] })),
    savedMeals: d.savedMeals ?? [],
    weights: (d.weights ?? []).filter((w) => w && typeof w.kg === 'number'),
  }
}

export function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyData()
    return normalise(JSON.parse(raw))
  } catch (err) {
    console.error('[storage] could not read saved data, starting fresh', err)
    return emptyData()
  }
}

let pending: number | undefined

/** Debounced write — logging a food fires several state updates in a row. */
export function save(data: AppData): void {
  if (pending !== undefined) clearTimeout(pending)
  pending = window.setTimeout(() => {
    pending = undefined
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch (err) {
      console.error('[storage] save failed', err)
    }
  }, 150)
}

export function saveNow(data: AppData): void {
  if (pending !== undefined) {
    clearTimeout(pending)
    pending = undefined
  }
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function exportJSON(data: AppData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)
}

export function importJSON(text: string): AppData {
  return normalise(JSON.parse(text))
}

export function clearAll(): void {
  localStorage.removeItem(KEY)
}
