import { useEffect, useMemo, useState } from 'react'
import { allFoods, frequentFoodIds, recentFoodIds, searchFoods } from '../lib/foodIndex'
import { defaultQty, fmtKcal, fmtG, totalFor } from '../lib/nutrition'
import { useStore } from '../state/store'
import {
  CATEGORIES,
  MEAL_LABEL,
  type Food,
  type MealSlot,
  type SavedMeal,
} from '../types'
import { FoodRow } from './FoodRow'
import { IconSearch } from './Icons'
import { QtyEditor } from './QtyEditor'
import { Sheet } from './Sheet'

type Tab = 'all' | 'favourites' | 'frequent' | 'meals' | 'mine'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Search' },
  { key: 'frequent', label: 'Recent' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'meals', label: 'My meals' },
  { key: 'mine', label: 'My foods' },
]

interface Props {
  open: boolean
  onClose: () => void
  /** Meal slot pre-selected when the sheet opens. */
  defaultMeal: MealSlot
  /** "Log" for the diary, "Add to plan" when planning a future day. */
  mode: 'log' | 'plan'
  /** Human-readable target, shown in the header, e.g. "Today" or "Wed 13 Aug". */
  dateLabel: string
  onAddFood: (food: Food, qty: number, meal: MealSlot) => void
  onAddSavedMeal: (meal: SavedMeal, slot: MealSlot) => void
}

export function AddFoodSheet({
  open,
  onClose,
  defaultMeal,
  mode,
  dateLabel,
  onAddFood,
  onAddSavedMeal,
}: Props) {
  const { data, dispatch } = useStore()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [picked, setPicked] = useState<Food | null>(null)
  const [qty, setQty] = useState(100)
  const [meal, setMeal] = useState<MealSlot>(defaultMeal)

  // Reset to a clean state whenever the sheet is reopened.
  useEffect(() => {
    if (open) {
      setTab('all')
      setQuery('')
      setCategory(null)
      setPicked(null)
      setMeal(defaultMeal)
    }
  }, [open, defaultMeal])

  const foods = useMemo(() => allFoods(data), [data])
  const favourites = new Set(data.favouriteFoodIds)

  const results = useMemo(() => {
    if (query.trim()) return searchFoods(foods, query)

    if (tab === 'favourites') {
      return foods.filter((f) => favourites.has(f.id))
    }
    if (tab === 'frequent') {
      const ids = [...new Set([...recentFoodIds(data, 20), ...frequentFoodIds(data, 20)])]
      const byId = new Map(foods.map((f) => [f.id, f]))
      return ids.map((id) => byId.get(id)).filter((f): f is Food => Boolean(f))
    }
    if (tab === 'mine') {
      return foods.filter((f) => f.custom)
    }
    if (category) {
      return foods
        .filter((f) => f.category === category)
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foods, query, tab, category, data])

  const pick = (food: Food) => {
    setPicked(food)
    setQty(defaultQty(food))
  }

  const submit = () => {
    if (!picked || qty <= 0) return
    onAddFood(picked, qty, meal)
    onClose()
  }

  const verb = mode === 'log' ? 'Log' : 'Add to plan'

  if (picked) {
    return (
      <Sheet
        open={open}
        title={picked.name}
        onClose={onClose}
        action={
          <button className="btn btn-sm btn-ghost" onClick={() => setPicked(null)}>
            Back
          </button>
        }
        footer={
          <button className="btn btn-primary btn-block" onClick={submit} disabled={qty <= 0}>
            {verb} · {MEAL_LABEL[meal]}
          </button>
        }
      >
        {picked.brand && <p className="small muted" style={{ marginTop: 0 }}>{picked.brand}</p>}
        <QtyEditor
          food={picked}
          qty={qty}
          onQtyChange={setQty}
          meal={meal}
          onMealChange={setMeal}
        />
      </Sheet>
    )
  }

  return (
    <Sheet open={open} title={`${verb} — ${dateLabel}`} onClose={onClose}>
      <div className="stack gap-10">
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-faint)',
              display: 'flex',
            }}
          >
            <IconSearch />
          </span>
          <input
            style={{ paddingLeft: 38 }}
            placeholder="Search 250+ foods — mince, Big Mac, eggs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search foods"
          />
        </div>

        {!query.trim() && (
          <div className="chips">
            {TABS.map((t) => (
              <button
                key={t.key}
                className="chip"
                aria-pressed={tab === t.key && !category}
                onClick={() => {
                  setTab(t.key)
                  setCategory(null)
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'meals' && !query.trim() ? (
          <SavedMealList
            meals={data.savedMeals}
            onPick={(m) => {
              onAddSavedMeal(m, m.defaultMeal)
              onClose()
            }}
            onDelete={(id) => dispatch({ type: 'deleteSavedMeal', id })}
          />
        ) : (
          <>
            {!query.trim() && tab === 'all' && (
              <div className="stack gap-8">
                <div className="section-title" style={{ margin: 0 }}>
                  Browse by category
                </div>
                <div className="chips">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      className="chip"
                      aria-pressed={category === c.key}
                      onClick={() => setCategory(category === c.key ? null : c.key)}
                    >
                      {c.emoji} {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {results.length > 0 ? (
              <div className="entry-list">
                {results.map((f) => (
                  <FoodRow
                    key={f.id}
                    food={f}
                    favourite={favourites.has(f.id)}
                    onToggleFavourite={() => dispatch({ type: 'toggleFavourite', id: f.id })}
                    onClick={() => pick(f)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                {query.trim() ? (
                  <>
                    <span className="empty-emoji">🔍</span>
                    Nothing matched “{query}”.
                    <br />
                    You can add it yourself under Foods → New food.
                  </>
                ) : tab === 'favourites' ? (
                  <>
                    <span className="empty-emoji">☆</span>
                    Tap the star on any food to keep it here.
                  </>
                ) : tab === 'frequent' ? (
                  <>
                    <span className="empty-emoji">🕘</span>
                    Foods you log will show up here.
                  </>
                ) : tab === 'mine' ? (
                  <>
                    <span className="empty-emoji">📝</span>
                    No custom foods yet — add one under Foods.
                  </>
                ) : (
                  <>
                    <span className="empty-emoji">🍽️</span>
                    Search, or pick a category above.
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

function SavedMealList({
  meals,
  onPick,
  onDelete,
}: {
  meals: SavedMeal[]
  onPick: (m: SavedMeal) => void
  onDelete: (id: string) => void
}) {
  if (meals.length === 0) {
    return (
      <div className="empty">
        <span className="empty-emoji">🍱</span>
        No saved meals yet.
        <br />
        On Today, tap a meal’s ⋯ and choose “Save as a reusable meal”.
      </div>
    )
  }

  return (
    <div className="entry-list">
      {meals.map((m) => {
        const totals = totalFor(m.items)
        return (
          <div className="entry" key={m.id} onClick={() => onPick(m)} role="button">
            <div className="entry-main">
              <div className="entry-name">{m.name}</div>
              <div className="entry-sub">
                {m.items.length} item{m.items.length === 1 ? '' : 's'} ·{' '}
                {MEAL_LABEL[m.defaultMeal]}
              </div>
            </div>
            <div className="entry-right">
              <div className="entry-kcal num">{fmtKcal(totals.kcal)}</div>
              <div className="entry-p num">{fmtG(totals.protein)} g P</div>
            </div>
            <button
              className="star"
              aria-label={`Delete ${m.name}`}
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete saved meal “${m.name}”?`)) onDelete(m.id)
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
