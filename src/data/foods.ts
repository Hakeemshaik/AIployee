import type { Food } from '../types'
import { FAST_FOODS, FAST_FOOD_BRANDS } from './fastfood'
import { GROCERY_FOODS } from './grocery'

export { FAST_FOOD_BRANDS }

/** Every food that ships with the app. Ids are stable, so log history keeps working. */
export const BUILTIN_FOODS: Food[] = [...FAST_FOODS, ...GROCERY_FOODS]

export const BUILTIN_BY_ID: Record<string, Food> = Object.fromEntries(
  BUILTIN_FOODS.map((f) => [f.id, f]),
)
