import {
  NUTRIENT_KEYS,
  ZERO_NUTRIENTS,
  type Food,
  type FoodSnapshot,
  type Nutrients,
} from '../types'

/**
 * Scales a food's nutrients to a quantity.
 *
 * `weight` foods store nutrients per 100 g and `qty` is grams.
 * `unit` foods store nutrients per unit and `qty` is a count.
 */
export function scaleNutrients(snapshot: FoodSnapshot, qty: number): Nutrients {
  const factor = snapshot.measure === 'weight' ? qty / 100 : qty
  const out = { ...ZERO_NUTRIENTS }
  for (const k of NUTRIENT_KEYS) out[k] = snapshot.nutrients[k] * factor
  return out
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = { ...ZERO_NUTRIENTS }
  for (const k of NUTRIENT_KEYS) out[k] = a[k] + b[k]
  return out
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, { ...ZERO_NUTRIENTS })
}

export function totalFor(items: { snapshot: FoodSnapshot; qty: number }[]): Nutrients {
  return sumNutrients(items.map((i) => scaleNutrients(i.snapshot, i.qty)))
}

export function snapshotOf(food: Food): FoodSnapshot {
  return {
    name: food.name,
    brand: food.brand,
    measure: food.measure,
    unitName: food.unitName,
    unitGrams: food.unitGrams,
    nutrients: { ...food.nutrients },
  }
}

/** Energy implied by the macros — used to sanity-check food data. */
export function energyFromMacros(n: Nutrients): number {
  return n.protein * 4 + n.carbs * 4 + n.fat * 9
}

/** Share of calories from each macro, as fractions summing to ~1. */
export function macroSplit(n: Nutrients): { protein: number; carbs: number; fat: number } {
  const p = n.protein * 4
  const c = n.carbs * 4
  const f = n.fat * 9
  const total = p + c + f
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 }
  return { protein: p / total, carbs: c / total, fat: f / total }
}

/** The default quantity to pre-fill when adding a food. */
export function defaultQty(food: Food | FoodSnapshot): number {
  if (food.measure === 'unit') return 1
  const portions = 'portions' in food ? food.portions : undefined
  return portions?.[0]?.qty ?? 100
}

// -------------------------------------------------------------- formatting

const nf0 = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1 })

export function fmtKcal(v: number): string {
  return nf0.format(Math.round(v))
}

/** Grams: one decimal below 10 g, whole numbers above. */
export function fmtG(v: number): string {
  if (v === 0) return '0'
  return Math.abs(v) < 10 ? nf1.format(v) : nf0.format(Math.round(v))
}

export function fmtMg(v: number): string {
  return nf0.format(Math.round(v))
}

export function fmtNutrient(key: keyof Nutrients, v: number): string {
  if (key === 'kcal') return fmtKcal(v)
  if (key === 'sodium') return fmtMg(v)
  return fmtG(v)
}

export function nutrientUnit(key: keyof Nutrients): string {
  if (key === 'kcal') return 'kcal'
  if (key === 'sodium') return 'mg'
  return 'g'
}

export const NUTRIENT_LABEL: Record<keyof Nutrients, string> = {
  kcal: 'Calories',
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  fibre: 'Fibre',
  sugar: 'Sugar',
  sodium: 'Sodium',
}

export const NUTRIENT_SHORT: Record<keyof Nutrients, string> = {
  kcal: 'kcal',
  protein: 'P',
  carbs: 'C',
  fat: 'F',
  fibre: 'Fib',
  sugar: 'Sug',
  sodium: 'Na',
}

/** Formats a logged quantity, e.g. "200 g" or "2 × burger". */
export function fmtQty(snapshot: FoodSnapshot, qty: number): string {
  if (snapshot.measure === 'weight') {
    if (qty >= 1000) return `${nf1.format(qty / 1000)} kg`
    return `${fmtG(qty)} g`
  }
  const name = snapshot.unitName ?? 'unit'
  const plural = qty === 1 ? name : pluralise(name)
  return `${nf1.format(qty)} ${plural}`
}

function pluralise(word: string): string {
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}
