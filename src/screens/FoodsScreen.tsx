import { useMemo, useState } from 'react'
import { FoodRow } from '../components/FoodRow'
import { IconChevronLeft, IconPlus, IconSearch, IconTrash } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { BUILTIN_BY_ID, FAST_FOOD_BRANDS } from '../data/foods'
import { slug } from '../data/build'
import { allFoods, searchFoods } from '../lib/foodIndex'
import { fmtG, fmtKcal, NUTRIENT_LABEL, nutrientUnit } from '../lib/nutrition'
import { useStore } from '../state/store'
import {
  CATEGORIES,
  CATEGORY_LABEL,
  NUTRIENT_KEYS,
  type Category,
  type Food,
  type Measure,
  type Nutrients,
} from '../types'

interface Props {
  toast: (msg: string) => void
}

type View =
  | { kind: 'home' }
  | { kind: 'brand'; brand: string }
  | { kind: 'category'; category: Category }
  | { kind: 'favourites' }
  | { kind: 'custom' }

export function FoodsScreen({ toast }: Props) {
  const { data, dispatch } = useStore()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'home' })
  const [editing, setEditing] = useState<Food | 'new' | null>(null)

  const foods = useMemo(() => allFoods(data), [data])
  const favourites = new Set(data.favouriteFoodIds)

  const countsByBrand = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of foods) if (f.brand) m.set(f.brand, (m.get(f.brand) ?? 0) + 1)
    return m
  }, [foods])

  const countsByCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of foods) m.set(f.category, (m.get(f.category) ?? 0) + 1)
    return m
  }, [foods])

  const listed = useMemo(() => {
    if (query.trim()) return searchFoods(foods, query, 120)
    if (view.kind === 'brand') return foods.filter((f) => f.brand === view.brand)
    if (view.kind === 'category')
      return foods
        .filter((f) => f.category === view.category)
        .sort((a, b) => a.name.localeCompare(b.name))
    if (view.kind === 'favourites') return foods.filter((f) => favourites.has(f.id))
    if (view.kind === 'custom') return foods.filter((f) => f.custom)
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foods, query, view, data.favouriteFoodIds])

  const title =
    view.kind === 'brand'
      ? view.brand
      : view.kind === 'category'
        ? CATEGORY_LABEL[view.category]
        : view.kind === 'favourites'
          ? 'Favourites'
          : view.kind === 'custom'
            ? 'My foods'
            : 'Foods'

  const atHome = view.kind === 'home' && !query.trim()

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          {!atHome && (
            <button
              className="icon-btn icon-btn-plain"
              aria-label="Back"
              onClick={() => {
                setQuery('')
                setView({ kind: 'home' })
              }}
            >
              <IconChevronLeft />
            </button>
          )}
          <h1 className="truncate">{query.trim() ? `“${query}”` : title}</h1>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setEditing('new')}
            aria-label="New food"
          >
            <IconPlus size={15} /> New
          </button>
        </div>
      </div>

      <div className="screen stack gap-12" style={{ paddingTop: 12 }}>
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
            placeholder="Search all foods…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search foods"
          />
        </div>

        {atHome ? (
          <>
            <div className="row wrap gap-8">
              <button className="chip" onClick={() => setView({ kind: 'favourites' })}>
                ★ Favourites <span className="pill-count">{data.favouriteFoodIds.length}</span>
              </button>
              <button className="chip" onClick={() => setView({ kind: 'custom' })}>
                📝 My foods{' '}
                <span className="pill-count">
                  {Object.values(data.foods).filter((f) => f.custom).length}
                </span>
              </button>
            </div>

            <div className="section">
              <div className="section-title">Fast food & restaurants</div>
              <div className="brand-grid">
                {FAST_FOOD_BRANDS.filter((b) => countsByBrand.has(b)).map((b) => (
                  <button
                    key={b}
                    className="brand-tile"
                    onClick={() => setView({ kind: 'brand', brand: b })}
                  >
                    <span className="brand-name">{b}</span>
                    <span className="brand-count">{countsByBrand.get(b)} items</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">Groceries & whole foods</div>
              <div className="brand-grid">
                {CATEGORIES.filter((c) => c.key !== 'fastfood' && countsByCategory.has(c.key)).map(
                  (c) => (
                    <button
                      key={c.key}
                      className="brand-tile"
                      onClick={() => setView({ kind: 'category', category: c.key })}
                    >
                      <span className="brand-name">
                        {c.emoji} {c.label}
                      </span>
                      <span className="brand-count">{countsByCategory.get(c.key)} items</span>
                    </button>
                  ),
                )}
              </div>
            </div>

            <p className="note">
              {foods.length} foods loaded. Values for chain menus are close estimates — SA menus
              differ from overseas ones and portions vary by store. Tap any food to edit it, or
              add your own straight off a pack label.
            </p>
          </>
        ) : listed.length > 0 ? (
          <div className="entry-list">
            {listed.map((f) => (
              <FoodRow
                key={f.id}
                food={f}
                favourite={favourites.has(f.id)}
                onToggleFavourite={() => dispatch({ type: 'toggleFavourite', id: f.id })}
                onClick={() => setEditing(f)}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="empty-emoji">🔍</span>
            Nothing here yet.
            {query.trim() && (
              <>
                <br />
                <button
                  className="btn btn-sm btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => setEditing('new')}
                >
                  Create “{query.trim()}”
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {editing && (
        <FoodEditorSheet
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          suggestedName={editing === 'new' ? query.trim() : ''}
          onClose={() => setEditing(null)}
          onSave={(food) => {
            dispatch({ type: 'saveFood', food })
            toast(`Saved ${food.name}`)
            setEditing(null)
          }}
          onDelete={(id) => {
            dispatch({ type: 'deleteFood', id })
            toast('Food removed')
            setEditing(null)
          }}
          onRevert={(id) => {
            dispatch({ type: 'revertFood', id })
            toast('Reverted to the built-in values')
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

const BLANK: Nutrients = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fibre: 0,
  sugar: 0,
  sodium: 0,
}

function FoodEditorSheet({
  initial,
  suggestedName,
  onClose,
  onSave,
  onDelete,
  onRevert,
}: {
  initial: Food | null
  suggestedName: string
  onClose: () => void
  onSave: (food: Food) => void
  onDelete: (id: string) => void
  onRevert: (id: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? suggestedName)
  const [brand, setBrand] = useState(initial?.brand ?? '')
  const [category, setCategory] = useState<Category>(initial?.category ?? 'other')
  const [measure, setMeasure] = useState<Measure>(initial?.measure ?? 'weight')
  const [unitName, setUnitName] = useState(initial?.unitName ?? '')
  const [unitGrams, setUnitGrams] = useState(initial?.unitGrams?.toString() ?? '')
  const [n, setN] = useState<Nutrients>(initial?.nutrients ?? { ...BLANK })

  const isBuiltin = Boolean(initial && BUILTIN_BY_ID[initial.id])

  const set = (key: keyof Nutrients, raw: string) => {
    const v = Number.parseFloat(raw.replace(',', '.'))
    setN((prev) => ({ ...prev, [key]: Number.isFinite(v) ? v : 0 }))
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({
      id: initial?.id ?? `custom-${slug(trimmed)}-${Date.now().toString(36).slice(-4)}`,
      name: trimmed,
      brand: brand.trim() || undefined,
      category,
      measure,
      unitName: measure === 'unit' ? unitName.trim() || 'unit' : undefined,
      unitGrams: measure === 'unit' && unitGrams ? Number(unitGrams) : undefined,
      nutrients: n,
      portions: initial?.portions,
      custom: initial ? initial.custom : true,
      edited: isBuiltin ? true : undefined,
    })
  }

  return (
    <Sheet
      open
      title={initial ? `Edit ${initial.name}` : 'New food'}
      onClose={onClose}
      footer={
        <>
          {initial && (
            <button
              className="btn btn-danger"
              aria-label={isBuiltin ? 'Hide this food' : 'Delete this food'}
              onClick={() => {
                const msg = isBuiltin
                  ? `Hide “${initial.name}” from your food list?`
                  : `Delete “${initial.name}”? Entries already logged keep their values.`
                if (confirm(msg)) onDelete(initial.id)
              }}
            >
              <IconTrash />
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={!name.trim()}
            onClick={save}
          >
            Save food
          </button>
        </>
      }
    >
      <div className="stack gap-16">
        <div className="field">
          <label htmlFor="f-name">Name</label>
          <input
            id="f-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Woolworths free-range chicken breast"
          />
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="f-brand">Brand / store</label>
            <input
              id="f-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select
              id="f-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <span className="field-label">How do you measure it?</span>
          <div className="segmented">
            <button aria-pressed={measure === 'weight'} onClick={() => setMeasure('weight')}>
              By weight (g)
            </button>
            <button aria-pressed={measure === 'unit'} onClick={() => setMeasure('unit')}>
              By the item
            </button>
          </div>
          <span className="note">
            {measure === 'weight'
              ? 'Enter the nutrition values per 100 g — the same basis as a pack label. You log it in grams.'
              : 'Enter the values for one item. You log it by count, e.g. 2 burgers.'}
          </span>
        </div>

        {measure === 'unit' && (
          <div className="field-grid">
            <div className="field">
              <label htmlFor="f-unit">One item is called</label>
              <input
                id="f-unit"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                placeholder="burger, slice, egg…"
              />
            </div>
            <div className="field">
              <label htmlFor="f-ugrams">Weight of one (g)</label>
              <input
                id="f-ugrams"
                type="number"
                inputMode="decimal"
                value={unitGrams}
                onChange={(e) => setUnitGrams(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">
            Nutrition {measure === 'weight' ? 'per 100 g' : `per ${unitName.trim() || 'item'}`}
          </span>
          <div className="field-grid">
            {NUTRIENT_KEYS.map((key) => (
              <div className="field" key={key}>
                <label htmlFor={`f-${key}`}>
                  {NUTRIENT_LABEL[key]} ({nutrientUnit(key)})
                </label>
                <input
                  id={`f-${key}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={n[key] === 0 ? '' : n[key]}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="note">
          Sanity check: the macros you entered work out to{' '}
          <strong className="num">
            {fmtKcal(n.protein * 4 + n.carbs * 4 + n.fat * 9)} kcal
          </strong>
          {n.kcal > 0 && (
            <>
              , and you entered <strong className="num">{fmtKcal(n.kcal)} kcal</strong>
              {Math.abs(n.protein * 4 + n.carbs * 4 + n.fat * 9 - n.kcal) > n.kcal * 0.25 &&
                ' — worth a second look.'}
            </>
          )}
          .
        </div>

        {isBuiltin && (
          <div className="stack gap-8">
            <div className="note">
              This is one of the built-in foods. Saving keeps your values from now on; anything
              already logged keeps the numbers it was logged with.
            </div>
            {initial?.edited && (
              <button
                className="btn btn-sm btn-ghost"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => onRevert(initial.id)}
              >
                Revert to built-in values
              </button>
            )}
          </div>
        )}

        {initial && (
          <div className="note num">
            Currently: {fmtKcal(initial.nutrients.kcal)} kcal · {fmtG(initial.nutrients.protein)} g
            protein {initial.measure === 'weight' ? 'per 100 g' : `per ${initial.unitName}`}
          </div>
        )}
      </div>
    </Sheet>
  )
}
