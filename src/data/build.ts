import type { Category, Food, Portion } from '../types'

/**
 * Compact row formats so the food tables stay readable.
 *
 * Weight rows are per 100 g:
 *   [name, kcal, protein, carbs, fat, fibre, sugar, sodium, portions?]
 *
 * Unit rows are per single unit:
 *   [name, unitName, unitGrams, kcal, protein, carbs, fat, fibre, sugar, sodium]
 *
 * Macros are grams, sodium is milligrams. Use 0 for unitGrams when the weight
 * of one unit is not meaningful (a milkshake, a combo meal).
 */
export type WeightRow = [
  name: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fibre: number,
  sugar: number,
  sodium: number,
  portions?: [string, number][],
]

export type UnitRow = [
  name: string,
  unitName: string,
  unitGrams: number,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fibre: number,
  sugar: number,
  sodium: number,
]

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toPortions(raw?: [string, number][]): Portion[] | undefined {
  return raw?.map(([label, qty]) => ({ label, qty }))
}

/** Builds `weight` foods (quantified in grams, nutrients per 100 g). */
export function weightFoods(
  brand: string | undefined,
  category: Category,
  rows: WeightRow[],
): Food[] {
  return rows.map(([name, kcal, protein, carbs, fat, fibre, sugar, sodium, portions]) => ({
    id: slug(`${brand ?? 'g'}-${name}`),
    name,
    brand,
    category,
    measure: 'weight' as const,
    nutrients: { kcal, protein, carbs, fat, fibre, sugar, sodium },
    portions: toPortions(portions),
  }))
}

/** Builds `unit` foods (quantified by count, nutrients per single unit). */
export function unitFoods(
  brand: string | undefined,
  category: Category,
  rows: UnitRow[],
): Food[] {
  return rows.map(
    ([name, unitName, unitGrams, kcal, protein, carbs, fat, fibre, sugar, sodium]) => ({
      id: slug(`${brand ?? 'g'}-${name}`),
      name,
      brand,
      category,
      measure: 'unit' as const,
      unitName,
      unitGrams: unitGrams > 0 ? unitGrams : undefined,
      nutrients: { kcal, protein, carbs, fat, fibre, sugar, sodium },
    }),
  )
}
