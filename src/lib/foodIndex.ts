import { BUILTIN_FOODS } from '../data/foods'
import type { AppData, Food } from '../types'

/**
 * The effective food list: built-ins, overridden by your edits, plus your own
 * custom foods, minus anything you deleted.
 */
export function allFoods(data: AppData): Food[] {
  const hidden = new Set(data.hiddenFoodIds)
  const out: Food[] = []

  for (const f of BUILTIN_FOODS) {
    if (hidden.has(f.id)) continue
    out.push(data.foods[f.id] ?? f)
  }
  for (const f of Object.values(data.foods)) {
    if (f.custom && !hidden.has(f.id)) out.push(f)
  }
  return out
}

export function foodMap(foods: Food[]): Map<string, Food> {
  return new Map(foods.map((f) => [f.id, f]))
}

function norm(s: string): string {
  // Strip accents so "vida e caffe" finds "vida e caffè".
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Ranked search over name + brand. Every query token must match somewhere;
 * matches at the start of a word rank above matches in the middle.
 */
export function searchFoods(foods: Food[], query: string, limit = 60): Food[] {
  const q = norm(query.trim())
  if (!q) return []
  const tokens = q.split(/\s+/).filter(Boolean)

  const scored: { food: Food; score: number }[] = []

  for (const food of foods) {
    const name = norm(food.name)
    const brand = norm(food.brand ?? '')
    const haystack = `${name} ${brand}`

    let score = 0
    let matchedAll = true

    for (const t of tokens) {
      const inName = name.indexOf(t)
      const inBrand = brand.indexOf(t)
      if (inName < 0 && inBrand < 0) {
        matchedAll = false
        break
      }
      if (inName === 0) score += 100
      else if (inName > 0 && /\s|\(|,|-/.test(name[inName - 1] ?? '')) score += 60
      else if (inName > 0) score += 30
      if (inBrand === 0) score += 25
      else if (inBrand > 0) score += 10
    }

    if (!matchedAll) continue

    // Whole-phrase hit, and shorter names, are usually what you meant.
    if (haystack.includes(q)) score += 40
    score -= Math.min(20, name.length / 6)

    scored.push({ food, score })
  }

  scored.sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
  return scored.slice(0, limit).map((s) => s.food)
}

/** Most-logged foods first, for the quick-add row. */
export function recentFoodIds(data: AppData, limit = 12): string[] {
  const seen = new Map<string, number>()
  for (let i = data.log.length - 1; i >= 0; i--) {
    const e = data.log[i]
    if (!seen.has(e.foodId)) seen.set(e.foodId, e.createdAt)
    if (seen.size >= limit * 3) break
  }
  return [...seen.keys()].slice(0, limit)
}

export function frequentFoodIds(data: AppData, limit = 12): string[] {
  const counts = new Map<string, number>()
  for (const e of data.log) counts.set(e.foodId, (counts.get(e.foodId) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/** Brands present in a set of foods, alphabetically. */
export function brandsOf(foods: Food[]): string[] {
  const set = new Set<string>()
  for (const f of foods) if (f.brand) set.add(f.brand)
  return [...set].sort((a, b) => a.localeCompare(b))
}
