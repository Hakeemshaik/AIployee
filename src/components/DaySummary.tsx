import { fmtKcal, fmtNutrient, NUTRIENT_LABEL, nutrientUnit } from '../lib/nutrition'
import type { Goals, NutrientKey, Nutrients } from '../types'
import { Ring } from './Ring'

const COLOR: Record<NutrientKey, string> = {
  kcal: 'var(--kcal)',
  protein: 'var(--protein)',
  carbs: 'var(--carbs)',
  fat: 'var(--fat)',
  fibre: 'var(--fibre)',
  sugar: 'var(--sugar)',
  sodium: 'var(--sodium)',
}

interface Props {
  totals: Nutrients
  goals: Goals
  tracked: NutrientKey[]
  /** Shown faintly behind the totals, e.g. what is still planned but unlogged. */
  plannedRemaining?: Nutrients
}

export function DaySummary({ totals, goals, tracked, plannedRemaining }: Props) {
  const kcalGoal = goals.kcal || 1
  const remaining = goals.kcal - totals.kcal
  const over = remaining < 0

  return (
    <div className="card">
      <div className="summary">
        <Ring progress={totals.kcal / kcalGoal} size={116} thickness={11}>
          <span className="ring-value num">{fmtKcal(Math.abs(remaining))}</span>
          <span className="ring-caption">{over ? 'over' : 'left'}</span>
        </Ring>

        <div className="bars">
          <BarRow
            label="Calories"
            value={totals.kcal}
            goal={goals.kcal}
            unit="kcal"
            colour={COLOR.kcal}
            nutrient="kcal"
          />
          {tracked.map((key) => (
            <BarRow
              key={key}
              label={NUTRIENT_LABEL[key]}
              value={totals[key]}
              goal={goals[key]}
              unit={nutrientUnit(key)}
              colour={COLOR[key]}
              nutrient={key}
            />
          ))}
        </div>
      </div>

      {plannedRemaining && plannedRemaining.kcal > 0 && (
        <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>
          Still planned today: <strong>{fmtKcal(plannedRemaining.kcal)} kcal</strong> ·{' '}
          {fmtNutrient('protein', plannedRemaining.protein)} g protein
        </p>
      )}
    </div>
  )
}

function BarRow({
  label,
  value,
  goal,
  unit,
  colour,
  nutrient,
}: {
  label: string
  value: number
  goal: number
  unit: string
  colour: string
  nutrient: NutrientKey
}) {
  const pct = goal > 0 ? value / goal : 0
  const over = pct > 1.0001

  return (
    <div className="bar-row">
      <div className="bar-head">{label}</div>
      <div className={`bar-nums num${over ? ' over' : ''}`}>
        {fmtNutrient(nutrient, value)}
        <span className="faint" style={{ fontWeight: 500 }}>
          {' '}
          / {fmtNutrient(nutrient, goal)} {unit}
        </span>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            background: over ? 'var(--warn)' : colour,
          }}
        />
      </div>
    </div>
  )
}
