import type { Food } from '../types'
import { energyFromMacros } from './nutrition'

export interface Problem {
  id: string
  name: string
  issue: string
}

/**
 * Data-integrity checks over a food table. A transposed column or a slipped
 * decimal almost always shows up as calories that disagree with the macros, so
 * that is the main signal here.
 *
 * Alcohol carries 7 kcal/g that no macro column accounts for, so those items
 * are exempt from the energy check.
 */
const ALCOHOL = /lager|light \(340|wine|spirits|beer|cider/i

export function validateFoods(foods: Food[]): Problem[] {
  const problems: Problem[] = []
  const seen = new Set<string>()

  for (const f of foods) {
    const add = (issue: string) => problems.push({ id: f.id, name: f.name, issue })

    if (seen.has(f.id)) add('duplicate id')
    seen.add(f.id)

    if (!f.name.trim()) add('empty name')
    if (f.measure === 'unit' && !f.unitName) add('unit food without a unit name')

    const n = f.nutrients
    for (const [key, value] of Object.entries(n)) {
      if (!Number.isFinite(value)) add(`${key} is not a number`)
      if (value < 0) add(`${key} is negative`)
    }

    if (f.measure === 'weight') {
      // Nothing edible beats pure fat (884 kcal) or pure protein per 100 g.
      if (n.kcal > 900) add(`${n.kcal} kcal per 100 g is impossible`)
      if (n.protein > 100 || n.carbs > 100 || n.fat > 100) add('a macro exceeds 100 g per 100 g')
      if (n.protein + n.carbs + n.fat > 105) add('macros total more than 100 g per 100 g')
    }

    if (n.sugar > n.carbs + 0.5) add('sugar exceeds total carbs')

    if (!ALCOHOL.test(f.name)) {
      const implied = energyFromMacros(n)
      // Allow 20% slack: rounding, fibre's partial energy, and published
      // figures that don't reconcile exactly.
      const tolerance = Math.max(12, implied * 0.2)
      if (Math.abs(implied - n.kcal) > tolerance) {
        add(
          `kcal ${Math.round(n.kcal)} disagrees with macros (${Math.round(implied)} kcal implied)`,
        )
      }
    }
  }

  return problems
}
