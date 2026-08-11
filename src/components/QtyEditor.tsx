import { useMemo, useState } from 'react'
import {
  fmtG,
  fmtKcal,
  fmtNutrient,
  NUTRIENT_SHORT,
  scaleNutrients,
} from '../lib/nutrition'
import { MEAL_SLOTS, type Food, type FoodSnapshot, type MealSlot } from '../types'
import { basisLabel } from './FoodRow'

interface Props {
  food: Food | FoodSnapshot
  qty: number
  onQtyChange: (qty: number) => void
  meal: MealSlot
  onMealChange: (meal: MealSlot) => void
  /** Hide the meal picker when the caller already fixed the slot. */
  showMeal?: boolean
}

/**
 * Quantity stepper + portion shortcuts + a live nutrient preview.
 * Grams for weighable foods, unit counts for countable ones.
 */
export function QtyEditor({
  food,
  qty,
  onQtyChange,
  meal,
  onMealChange,
  showMeal = true,
}: Props) {
  const isWeight = food.measure === 'weight'
  const step = isWeight ? 10 : 1
  const portions = 'portions' in food ? food.portions : undefined

  // Free text while typing, so "1." and "" don't get clobbered mid-entry.
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (Number.isInteger(qty) ? String(qty) : String(qty))

  const totals = useMemo(
    () => scaleNutrients(asSnapshot(food), qty),
    [food, qty],
  )

  const commit = (raw: string) => {
    setText(raw)
    const v = Number.parseFloat(raw.replace(',', '.'))
    if (Number.isFinite(v) && v >= 0) onQtyChange(v)
  }

  const bump = (delta: number) => {
    const next = Math.max(0, Math.round((qty + delta) * 100) / 100)
    setText(null)
    onQtyChange(next)
  }

  const unitLabel = isWeight ? 'grams' : (food.unitName ?? 'units')

  return (
    <div className="stack gap-12">
      <div className="qty-row">
        <button className="step-btn" onClick={() => bump(-step)} aria-label={`Minus ${step}`}>
          −
        </button>
        <input
          className="qty-input"
          type="number"
          inputMode="decimal"
          min="0"
          step={isWeight ? 5 : 0.5}
          value={shown}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setText(null)}
          aria-label={`Quantity in ${unitLabel}`}
        />
        <button className="step-btn" onClick={() => bump(step)} aria-label={`Plus ${step}`}>
          +
        </button>
      </div>

      <div className="center small muted">
        {unitLabel}
        {isWeight && qty >= 1000 && <> · {(qty / 1000).toFixed(2)} kg</>}
        {!isWeight && food.unitGrams ? <> · ≈ {fmtG(qty * food.unitGrams)} g</> : null}
      </div>

      {portions && portions.length > 0 && (
        <div className="chips">
          {portions.map((p) => (
            <button
              key={p.label}
              className="chip"
              aria-pressed={Math.abs(p.qty - qty) < 0.01}
              onClick={() => {
                setText(null)
                onQtyChange(p.qty)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {isWeight && (
        <div className="chips">
          {[50, 100, 150, 200, 250, 300, 500].map((g) => (
            <button
              key={g}
              className="chip"
              aria-pressed={qty === g}
              onClick={() => {
                setText(null)
                onQtyChange(g)
              }}
            >
              {g} g
            </button>
          ))}
        </div>
      )}

      <div className="preview-grid">
        <div className="preview-cell">
          <div className="preview-val num" style={{ color: 'var(--kcal)' }}>
            {fmtKcal(totals.kcal)}
          </div>
          <div className="preview-key">kcal</div>
        </div>
        {(['protein', 'carbs', 'fat'] as const).map((k) => (
          <div className="preview-cell" key={k}>
            <div className="preview-val num" style={{ color: `var(--${k})` }}>
              {fmtNutrient(k, totals[k])}
            </div>
            <div className="preview-key">{k === 'protein' ? 'protein g' : `${k} g`}</div>
          </div>
        ))}
      </div>

      <div className="row small muted" style={{ justifyContent: 'center', gap: 14 }}>
        <span>
          {NUTRIENT_SHORT.fibre} {fmtNutrient('fibre', totals.fibre)} g
        </span>
        <span>
          {NUTRIENT_SHORT.sugar} {fmtNutrient('sugar', totals.sugar)} g
        </span>
        <span>
          {NUTRIENT_SHORT.sodium} {fmtNutrient('sodium', totals.sodium)} mg
        </span>
      </div>

      <div className="note center">
        {fmtKcal(food.nutrients.kcal)} kcal · {fmtG(food.nutrients.protein)} g protein{' '}
        {basisLabel(asFood(food))}
      </div>

      {showMeal && (
        <div className="field">
          <span className="field-label">Meal</span>
          <div className="segmented">
            {MEAL_SLOTS.map((m) => (
              <button
                key={m.key}
                aria-pressed={meal === m.key}
                onClick={() => onMealChange(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function asSnapshot(food: Food | FoodSnapshot): FoodSnapshot {
  return {
    name: food.name,
    brand: food.brand,
    measure: food.measure,
    unitName: food.unitName,
    unitGrams: food.unitGrams,
    nutrients: food.nutrients,
  }
}

/** basisLabel only reads fields both shapes share. */
function asFood(food: Food | FoodSnapshot): Food {
  return food as Food
}
