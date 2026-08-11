import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { newId } from '../lib/id'
import { snapshotOf } from '../lib/nutrition'
import { resolvePlan } from '../lib/plan'
import * as storage from '../lib/storage'
import type {
  AppData,
  Food,
  Goals,
  LogEntry,
  MealSlot,
  PlanItem,
  RecurringMeal,
  SavedMeal,
  Settings,
} from '../types'

type Action =
  | { type: 'replace'; data: AppData }
  | { type: 'addLog'; entries: LogEntry[] }
  | { type: 'updateLog'; id: string; patch: Partial<LogEntry> }
  | { type: 'removeLog'; id: string }
  | { type: 'clearDay'; date: string }
  | { type: 'saveFood'; food: Food }
  | { type: 'deleteFood'; id: string }
  | { type: 'revertFood'; id: string }
  | { type: 'toggleFavourite'; id: string }
  | { type: 'setPlanItems'; date: string; items: PlanItem[] }
  | { type: 'addPlanItems'; date: string; items: PlanItem[] }
  | { type: 'removePlanItem'; date: string; id: string }
  | { type: 'updatePlanItem'; date: string; id: string; patch: Partial<PlanItem> }
  | { type: 'saveRecurring'; meal: RecurringMeal }
  | { type: 'deleteRecurring'; id: string }
  | { type: 'skipRecurring'; id: string; date: string; skip: boolean }
  | { type: 'saveMeal'; meal: SavedMeal }
  | { type: 'deleteSavedMeal'; id: string }
  | { type: 'setWeight'; date: string; kg: number | null }
  | { type: 'setGoals'; goals: Partial<Goals> }
  | { type: 'setSettings'; patch: Partial<Settings> }

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'replace':
      return action.data

    case 'addLog':
      return { ...state, log: [...state.log, ...action.entries] }

    case 'updateLog':
      return {
        ...state,
        log: state.log.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)),
      }

    case 'removeLog':
      return { ...state, log: state.log.filter((e) => e.id !== action.id) }

    case 'clearDay':
      return { ...state, log: state.log.filter((e) => e.date !== action.date) }

    case 'saveFood':
      return { ...state, foods: { ...state.foods, [action.food.id]: action.food } }

    case 'deleteFood': {
      const foods = { ...state.foods }
      delete foods[action.id]
      return {
        ...state,
        foods,
        // Built-ins are not in `foods`, so hide them explicitly.
        hiddenFoodIds: state.hiddenFoodIds.includes(action.id)
          ? state.hiddenFoodIds
          : [...state.hiddenFoodIds, action.id],
        favouriteFoodIds: state.favouriteFoodIds.filter((id) => id !== action.id),
      }
    }

    case 'revertFood': {
      // Drops your override of a built-in food, and un-hides it.
      const foods = { ...state.foods }
      delete foods[action.id]
      return {
        ...state,
        foods,
        hiddenFoodIds: state.hiddenFoodIds.filter((id) => id !== action.id),
      }
    }

    case 'toggleFavourite':
      return {
        ...state,
        favouriteFoodIds: state.favouriteFoodIds.includes(action.id)
          ? state.favouriteFoodIds.filter((id) => id !== action.id)
          : [...state.favouriteFoodIds, action.id],
      }

    case 'setPlanItems': {
      const planDays = { ...state.planDays }
      if (action.items.length === 0) delete planDays[action.date]
      else planDays[action.date] = { date: action.date, items: action.items }
      return { ...state, planDays }
    }

    case 'addPlanItems': {
      const existing = state.planDays[action.date]?.items ?? []
      return {
        ...state,
        planDays: {
          ...state.planDays,
          [action.date]: { date: action.date, items: [...existing, ...action.items] },
        },
      }
    }

    case 'removePlanItem': {
      const existing = state.planDays[action.date]?.items ?? []
      const items = existing.filter((i) => i.id !== action.id)
      const planDays = { ...state.planDays }
      if (items.length === 0) delete planDays[action.date]
      else planDays[action.date] = { date: action.date, items }
      return { ...state, planDays }
    }

    case 'updatePlanItem': {
      const existing = state.planDays[action.date]?.items ?? []
      return {
        ...state,
        planDays: {
          ...state.planDays,
          [action.date]: {
            date: action.date,
            items: existing.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)),
          },
        },
      }
    }

    case 'saveRecurring': {
      const exists = state.recurring.some((r) => r.id === action.meal.id)
      return {
        ...state,
        recurring: exists
          ? state.recurring.map((r) => (r.id === action.meal.id ? action.meal : r))
          : [...state.recurring, action.meal],
      }
    }

    case 'deleteRecurring':
      return { ...state, recurring: state.recurring.filter((r) => r.id !== action.id) }

    case 'skipRecurring':
      return {
        ...state,
        recurring: state.recurring.map((r) => {
          if (r.id !== action.id) return r
          const skipDates = action.skip
            ? [...new Set([...r.skipDates, action.date])]
            : r.skipDates.filter((d) => d !== action.date)
          return { ...r, skipDates }
        }),
      }

    case 'saveMeal': {
      const exists = state.savedMeals.some((m) => m.id === action.meal.id)
      return {
        ...state,
        savedMeals: exists
          ? state.savedMeals.map((m) => (m.id === action.meal.id ? action.meal : m))
          : [...state.savedMeals, action.meal],
      }
    }

    case 'deleteSavedMeal':
      return { ...state, savedMeals: state.savedMeals.filter((m) => m.id !== action.id) }

    case 'setWeight': {
      const others = state.weights.filter((w) => w.date !== action.date)
      if (action.kg === null) return { ...state, weights: others }
      return {
        ...state,
        weights: [...others, { date: action.date, kg: action.kg }].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      }
    }

    case 'setGoals':
      return {
        ...state,
        settings: { ...state.settings, goals: { ...state.settings.goals, ...action.goals } },
      }

    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } }
  }
}

interface StoreValue {
  data: AppData
  dispatch: React.Dispatch<Action>
  /** Convenience actions built on top of dispatch. */
  logFood: (input: {
    food: Food
    qty: number
    meal: MealSlot
    date: string
    fromPlan?: boolean
  }) => void
  logItems: (
    items: { foodId: string; snapshot: PlanItem['snapshot']; qty: number; meal: MealSlot }[],
    date: string,
    fromPlan?: boolean,
  ) => void
  logPlanForDate: (date: string, meal?: MealSlot) => number
  makePlanItem: (food: Food, qty: number, meal: MealSlot) => PlanItem
  resetAll: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, storage.load)

  useEffect(() => {
    storage.save(data)
  }, [data])

  // Flush any debounced write before the app is backgrounded or closed.
  useEffect(() => {
    const flush = () => storage.saveNow(data)
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [data])

  const logFood = useCallback<StoreValue['logFood']>(({ food, qty, meal, date, fromPlan }) => {
    dispatch({
      type: 'addLog',
      entries: [
        {
          id: newId('l'),
          foodId: food.id,
          snapshot: snapshotOf(food),
          qty,
          meal,
          date,
          createdAt: Date.now(),
          fromPlan,
        },
      ],
    })
  }, [])

  const logItems = useCallback<StoreValue['logItems']>((items, date, fromPlan) => {
    if (items.length === 0) return
    dispatch({
      type: 'addLog',
      entries: items.map((i, idx) => ({
        id: newId('l'),
        foodId: i.foodId,
        snapshot: i.snapshot,
        qty: i.qty,
        meal: i.meal,
        date,
        createdAt: Date.now() + idx,
        fromPlan,
      })),
    })
  }, [])

  const logPlanForDate = useCallback<StoreValue['logPlanForDate']>(
    (date, meal) => {
      const planned = resolvePlan(data, date).filter((i) => !meal || i.meal === meal)
      if (planned.length === 0) return 0
      logItems(
        planned.map((i) => ({
          foodId: i.foodId,
          snapshot: i.snapshot,
          qty: i.qty,
          meal: i.meal,
        })),
        date,
        true,
      )
      return planned.length
    },
    [data, logItems],
  )

  const makePlanItem = useCallback<StoreValue['makePlanItem']>((food, qty, meal) => {
    return { id: newId('p'), foodId: food.id, snapshot: snapshotOf(food), qty, meal }
  }, [])

  const resetAll = useCallback(() => {
    storage.clearAll()
    dispatch({ type: 'replace', data: storage.emptyData() })
  }, [])

  const value = useMemo<StoreValue>(
    () => ({ data, dispatch, logFood, logItems, logPlanForDate, makePlanItem, resetAll }),
    [data, logFood, logItems, logPlanForDate, makePlanItem, resetAll],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
