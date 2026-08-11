/** Core data model. Everything is stored locally; see lib/storage.ts. */

/**
 * Nutrients for one "basis" of a food (per 100 g, or per single unit).
 * Grams for the macros, milligrams for sodium.
 */
export interface Nutrients {
  kcal: number
  protein: number
  carbs: number
  fat: number
  fibre: number
  sugar: number
  sodium: number
}

export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fibre',
  'sugar',
  'sodium',
] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

export const ZERO_NUTRIENTS: Nutrients = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fibre: 0,
  sugar: 0,
  sodium: 0,
}

/**
 * How a food is quantified.
 * - `weight`: you weigh it. `nutrients` are per 100 g, `qty` is in grams.
 * - `unit`:   you count it. `nutrients` are per one unit, `qty` is a count.
 */
export type Measure = 'weight' | 'unit'

export type Category =
  | 'fastfood'
  | 'beef'
  | 'chicken'
  | 'pork'
  | 'lamb'
  | 'fish'
  | 'eggs'
  | 'dairy'
  | 'carbs'
  | 'legumes'
  | 'veg'
  | 'fruit'
  | 'nuts'
  | 'fats'
  | 'snacks'
  | 'drinks'
  | 'sauces'
  | 'supplements'
  | 'other'

export interface CategoryMeta {
  key: Category
  label: string
  emoji: string
}

export const CATEGORIES: CategoryMeta[] = [
  { key: 'fastfood', label: 'Fast food', emoji: '🍔' },
  { key: 'beef', label: 'Beef & mince', emoji: '🥩' },
  { key: 'chicken', label: 'Chicken', emoji: '🍗' },
  { key: 'pork', label: 'Pork', emoji: '🥓' },
  { key: 'lamb', label: 'Lamb', emoji: '🐑' },
  { key: 'fish', label: 'Fish & seafood', emoji: '🐟' },
  { key: 'eggs', label: 'Eggs', emoji: '🥚' },
  { key: 'dairy', label: 'Dairy & cheese', emoji: '🧀' },
  { key: 'carbs', label: 'Carbs & grains', emoji: '🍚' },
  { key: 'legumes', label: 'Beans & legumes', emoji: '🫘' },
  { key: 'veg', label: 'Vegetables', emoji: '🥦' },
  { key: 'fruit', label: 'Fruit', emoji: '🍌' },
  { key: 'nuts', label: 'Nuts & seeds', emoji: '🥜' },
  { key: 'fats', label: 'Fats & oils', emoji: '🫒' },
  { key: 'snacks', label: 'Snacks & sweets', emoji: '🍫' },
  { key: 'drinks', label: 'Drinks', emoji: '🥤' },
  { key: 'sauces', label: 'Sauces & condiments', emoji: '🥫' },
  { key: 'supplements', label: 'Supplements', emoji: '💪' },
  { key: 'other', label: 'Other', emoji: '🍽️' },
]

export const CATEGORY_LABEL: Record<Category, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
) as Record<Category, string>

export const CATEGORY_EMOJI: Record<Category, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.emoji]),
) as Record<Category, string>

/** A named portion shortcut, e.g. "1 cup cooked" = 158 g. */
export interface Portion {
  label: string
  /** Grams for `weight` foods, unit count for `unit` foods. */
  qty: number
}

export interface Food {
  id: string
  name: string
  /** Store or restaurant, e.g. "KFC", "Woolworths". */
  brand?: string
  category: Category
  measure: Measure
  /** Singular noun for one unit: "burger", "slice", "egg". `unit` foods only. */
  unitName?: string
  /** Weight of one unit in grams, when known. Enables gram-based overrides. */
  unitGrams?: number
  /** Per 100 g for `weight` foods; per single unit for `unit` foods. */
  nutrients: Nutrients
  portions?: Portion[]
  /** True for foods you created yourself (editable and deletable). */
  custom?: boolean
  /** Set when you have edited one of the built-in foods. */
  edited?: boolean
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const MEAL_SLOTS: { key: MealSlot; label: string; emoji: string }[] = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch', label: 'Lunch', emoji: '☀️' },
  { key: 'dinner', label: 'Dinner', emoji: '🌙' },
  { key: 'snack', label: 'Snacks', emoji: '🍿' },
]

export const MEAL_LABEL: Record<MealSlot, string> = Object.fromEntries(
  MEAL_SLOTS.map((m) => [m.key, m.label]),
) as Record<MealSlot, string>

/**
 * A copy of the food's facts taken at the moment it was logged, so history
 * stays correct even if the food is later edited or deleted.
 */
export interface FoodSnapshot {
  name: string
  brand?: string
  measure: Measure
  unitName?: string
  unitGrams?: number
  nutrients: Nutrients
}

export interface LogEntry {
  id: string
  foodId: string
  snapshot: FoodSnapshot
  /** Grams for `weight` foods, unit count for `unit` foods. */
  qty: number
  meal: MealSlot
  /** ISO date, YYYY-MM-DD, in local time. */
  date: string
  createdAt: number
  /** Set when this entry came from a plan, so we don't log the plan twice. */
  fromPlan?: boolean
}

/** One food + quantity inside a plan or a saved meal. */
export interface PlanItem {
  id: string
  foodId: string
  snapshot: FoodSnapshot
  qty: number
  meal: MealSlot
}

/** A one-off plan attached to a specific calendar date. */
export interface PlanDay {
  date: string
  items: PlanItem[]
}

/** A group of foods you eat together and can log in one tap. */
export interface SavedMeal {
  id: string
  name: string
  /** Slot suggested when logging, but you can override it. */
  defaultMeal: MealSlot
  items: Omit<PlanItem, 'meal'>[]
  createdAt: number
}

/**
 * A meal that repeats on chosen weekdays — the "same breakfast every Mon/Wed/Fri"
 * case. Resolved onto each matching date by lib/plan.ts.
 */
export interface RecurringMeal {
  id: string
  name: string
  meal: MealSlot
  /** Weekdays it lands on: 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  items: Omit<PlanItem, 'meal'>[]
  active: boolean
  /** Optional bounds, inclusive. ISO dates. */
  startDate?: string
  endDate?: string
  /** ISO dates where this recurrence was skipped. */
  skipDates: string[]
  createdAt: number
}

export interface WeightEntry {
  /** ISO date; one entry per day. */
  date: string
  kg: number
}

export type Goals = Nutrients & {
  /** Optional goal weight in kg, for the Trends chart. */
  weightKg?: number
  /** Bodyweight used by the protein-per-kg helper. */
  bodyWeightKg?: number
}

export type ThemePref = 'system' | 'dark' | 'light'

export interface Settings {
  goals: Goals
  /** Which nutrients get a row in the day summary. kcal is always shown. */
  trackedNutrients: NutrientKey[]
  theme: ThemePref
  /** Sunday-first weeks when false. */
  weekStartsMonday: boolean
}

export interface AppData {
  version: number
  settings: Settings
  /** Custom foods and edits to built-in foods, keyed by food id. */
  foods: Record<string, Food>
  /** Deleted built-in food ids, so they stay hidden. */
  hiddenFoodIds: string[]
  favouriteFoodIds: string[]
  log: LogEntry[]
  planDays: Record<string, PlanDay>
  recurring: RecurringMeal[]
  savedMeals: SavedMeal[]
  weights: WeightEntry[]
}
