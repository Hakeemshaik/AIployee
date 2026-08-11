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
        <Ring progress={totals.kcal / kcalGoal} size={112} thickness={8}>
          <span className="ring-value num">{fmtKcal(Math.abs(remaining))}</span>
          <span className="ring-caption">{over ? 'kcal over' : 'kcal left'}</span>
        </Ring>

        {/* Calories are the ring — repeating them as a bar just adds noise. */}
        <div className="bars">
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

      <p className="note center" style={{ marginTop: 16, marginBottom: 0 }}>
        <span className="num">
          {fmtKcal(totals.kcal)} of {fmtKcal(goals.kcal)} kcal
        </span>
        {plannedRemaining && plannedRemaining.kcal > 0 && (
          <>
            {' · '}
            <span className="num">{fmtKcal(plannedRemaining.kcal)}</span> still planned
          </>
        )}
      </p>
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
        <span className="faint" style={{ fontWeight: 400 }}>
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
