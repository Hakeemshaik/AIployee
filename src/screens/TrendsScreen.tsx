import { useMemo, useState } from 'react'
import { addDays, lastNDays, shortDate, todayISO } from '../lib/date'
import { fmtG, fmtKcal, totalFor } from '../lib/nutrition'
import { useStore } from '../state/store'
import type { Nutrients } from '../types'

interface Props {
  toast: (msg: string) => void
}

const RANGES = [7, 30, 90] as const

export function TrendsScreen({ toast }: Props) {
  const { data, dispatch } = useStore()
  const [days, setDays] = useState<number>(7)
  const goals = data.settings.goals

  const dates = useMemo(() => lastNDays(days), [days])

  const perDay = useMemo(() => {
    const inRange = new Set(dates)
    const grouped = new Map<string, typeof data.log>()
    for (const e of data.log) {
      if (!inRange.has(e.date)) continue
      const list = grouped.get(e.date) ?? []
      list.push(e)
      grouped.set(e.date, list)
    }
    return dates.map((d) => ({ date: d, totals: totalFor(grouped.get(d) ?? []) }))
  }, [dates, data.log])

  const loggedDays = perDay.filter((d) => d.totals.kcal > 0)
  const avg = (pick: (n: Nutrients) => number) =>
    loggedDays.length === 0
      ? 0
      : loggedDays.reduce((sum, d) => sum + pick(d.totals), 0) / loggedDays.length

  const avgKcal = avg((n) => n.kcal)
  const avgProtein = avg((n) => n.protein)
  const onTarget = loggedDays.filter((d) => d.totals.protein >= goals.protein * 0.95).length
  const streak = useMemo(() => currentStreak(data.log.map((e) => e.date)), [data.log])

  const weights = useMemo(
    () => data.weights.filter((w) => w.date >= dates[0]),
    [data.weights, dates],
  )
  const latestWeight = data.weights.at(-1)
  const proteinPerKg = latestWeight && avgProtein > 0 ? avgProtein / latestWeight.kg : 0

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <h1>Trends</h1>
        </div>
      </div>

      <div className="screen stack gap-16" style={{ paddingTop: 12 }}>
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r} aria-pressed={days === r} onClick={() => setDays(r)}>
              {r} days
            </button>
          ))}
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-val num">{loggedDays.length ? fmtKcal(avgKcal) : '—'}</div>
            <div className="stat-key">Avg kcal / day</div>
          </div>
          <div className="stat">
            <div className="stat-val num" style={{ color: 'var(--protein)' }}>
              {loggedDays.length ? `${fmtG(avgProtein)} g` : '—'}
            </div>
            <div className="stat-key">Avg protein / day</div>
          </div>
          <div className="stat">
            <div className="stat-val num">
              {onTarget}
              <span className="faint" style={{ fontSize: 15 }}>
                /{loggedDays.length || 0}
              </span>
            </div>
            <div className="stat-key">Days on protein target</div>
          </div>
          <div className="stat">
            <div className="stat-val num">{streak}</div>
            <div className="stat-key">Day streak</div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Calories</div>
          <div className="card">
            <BarChart
              points={perDay.map((d) => ({ date: d.date, value: d.totals.kcal }))}
              goal={goals.kcal}
              colour="var(--kcal)"
              formatValue={fmtKcal}
              unit="kcal"
            />
          </div>
        </div>

        <div className="section">
          <div className="section-title">Protein</div>
          <div className="card">
            <BarChart
              points={perDay.map((d) => ({ date: d.date, value: d.totals.protein }))}
              goal={goals.protein}
              colour="var(--protein)"
              formatValue={(v) => `${fmtG(v)} g`}
              unit="g"
            />
          </div>
        </div>

        <div className="section">
          <div className="section-title">Average day</div>
          <div className="card stack gap-12">
            <MacroSplitBar
              totals={{
                protein: avg((n) => n.protein),
                carbs: avg((n) => n.carbs),
                fat: avg((n) => n.fat),
              }}
            />
            <div className="chart-legend">
              <span>
                <i className="legend-dot" style={{ background: 'var(--protein)' }} />
                {fmtG(avg((n) => n.protein))} g protein
              </span>
              <span>
                <i className="legend-dot" style={{ background: 'var(--carbs)' }} />
                {fmtG(avg((n) => n.carbs))} g carbs
              </span>
              <span>
                <i className="legend-dot" style={{ background: 'var(--fat)' }} />
                {fmtG(avg((n) => n.fat))} g fat
              </span>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Weight</div>
          <div className="card stack gap-12">
            <WeightInput
              onSave={(kg) => {
                dispatch({ type: 'setWeight', date: todayISO(), kg })
                toast(kg === null ? 'Weight cleared' : `Logged ${kg} kg`)
              }}
              current={data.weights.find((w) => w.date === todayISO())?.kg}
            />

            {weights.length >= 2 ? (
              <LineChart
                points={weights.map((w) => ({ date: w.date, value: w.kg }))}
                goal={goals.weightKg}
                colour="var(--carbs)"
              />
            ) : (
              <p className="note" style={{ margin: 0 }}>
                Log your weight on at least two days in this range and a trend line shows up here.
              </p>
            )}

            {latestWeight && (
              <div className="row wrap gap-12 small muted">
                <span>
                  Latest: <strong className="num">{latestWeight.kg} kg</strong> (
                  {shortDate(latestWeight.date)})
                </span>
                {proteinPerKg > 0 && (
                  <span>
                    Protein: <strong className="num">{proteinPerKg.toFixed(1)} g/kg</strong>{' '}
                    bodyweight
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {loggedDays.length === 0 && (
          <div className="empty">
            <span className="empty-emoji">📈</span>
            Log a few days and the charts fill in.
          </div>
        )}
      </div>
    </>
  )
}

/** Consecutive days with at least one entry, counting back from today. */
function currentStreak(dates: string[]): number {
  const set = new Set(dates)
  let n = 0
  // Nothing logged yet today shouldn't break yesterday's streak.
  let cursor = set.has(todayISO()) ? todayISO() : addDays(todayISO(), -1)
  while (set.has(cursor)) {
    n++
    cursor = addDays(cursor, -1)
  }
  return n
}

function BarChart({
  points,
  goal,
  colour,
  formatValue,
  unit,
}: {
  points: { date: string; value: number }[]
  goal: number
  colour: string
  formatValue: (v: number) => string
  unit: string
}) {
  const W = 320
  const H = 128
  const pad = { top: 10, bottom: 18, left: 0, right: 0 }
  const max = Math.max(goal * 1.1, ...points.map((p) => p.value), 1)
  const plotH = H - pad.top - pad.bottom
  const slot = W / points.length
  const barW = Math.max(2, Math.min(22, slot * 0.62))
  const goalY = pad.top + plotH * (1 - goal / max)

  // Only label a handful of days, otherwise the axis turns to mush.
  const labelEvery = Math.ceil(points.length / 7)

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily ${unit}`}>
        {goal > 0 && (
          <>
            <line
              x1={0}
              x2={W}
              y1={goalY}
              y2={goalY}
              stroke="var(--line-strong)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={2} y={goalY - 4} fill="var(--text-faint)" fontSize={9} fontWeight={600}>
              goal {formatValue(goal)}
            </text>
          </>
        )}

        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max(2, plotH * Math.min(1.25, p.value / max)) : 0
          const x = i * slot + (slot - barW) / 2
          const y = pad.top + plotH - h
          const over = goal > 0 && p.value > goal
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 2)}
                fill={over ? 'var(--warn)' : colour}
                opacity={p.value > 0 ? 1 : 0.25}
              />
              {i % labelEvery === 0 && (
                <text
                  x={i * slot + slot / 2}
                  y={H - 5}
                  textAnchor="middle"
                  fill="var(--text-faint)"
                  fontSize={8.5}
                >
                  {shortDate(p.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </>
  )
}

function LineChart({
  points,
  goal,
  colour,
}: {
  points: { date: string; value: number }[]
  goal?: number
  colour: string
}) {
  const W = 320
  const H = 120
  const pad = { top: 12, bottom: 18, left: 2, right: 2 }
  const values = points.map((p) => p.value)
  const candidates = goal ? [...values, goal] : values
  const lo = Math.min(...candidates)
  const hi = Math.max(...candidates)
  const span = hi - lo || 1
  const min = lo - span * 0.15
  const max = hi + span * 0.15
  const plotH = H - pad.top - pad.bottom
  const plotW = W - pad.left - pad.right

  const xy = (i: number, v: number) => {
    const x = points.length === 1 ? plotW / 2 : pad.left + (plotW * i) / (points.length - 1)
    const y = pad.top + plotH * (1 - (v - min) / (max - min))
    return [x, y] as const
  }

  const path = points.map((p, i) => {
    const [x, y] = xy(i, p.value)
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  })

  const goalY = goal ? pad.top + plotH * (1 - (goal - min) / (max - min)) : 0

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weight trend">
      {goal && (
        <>
          <line
            x1={0}
            x2={W}
            y1={goalY}
            y2={goalY}
            stroke="var(--line-strong)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={2} y={goalY - 4} fill="var(--text-faint)" fontSize={9} fontWeight={600}>
            goal {goal} kg
          </text>
        </>
      )}

      <path d={path.join(' ')} fill="none" stroke={colour} strokeWidth={2.2} strokeLinecap="round" />

      {points.map((p, i) => {
        const [x, y] = xy(i, p.value)
        return <circle key={p.date} cx={x} cy={y} r={2.8} fill={colour} />
      })}

      <text x={2} y={H - 5} fill="var(--text-faint)" fontSize={8.5}>
        {shortDate(points[0].date)}
      </text>
      <text x={W - 2} y={H - 5} textAnchor="end" fill="var(--text-faint)" fontSize={8.5}>
        {shortDate(points[points.length - 1].date)}
      </text>
    </svg>
  )
}

function MacroSplitBar({
  totals,
}: {
  totals: { protein: number; carbs: number; fat: number }
}) {
  const p = totals.protein * 4
  const c = totals.carbs * 4
  const f = totals.fat * 9
  const sum = p + c + f

  if (sum <= 0) {
    return <div className="bar-track" style={{ height: 12 }} />
  }

  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${(p / sum) * 100}%`, background: 'var(--protein)' }} />
      <div style={{ width: `${(c / sum) * 100}%`, background: 'var(--carbs)' }} />
      <div style={{ width: `${(f / sum) * 100}%`, background: 'var(--fat)' }} />
    </div>
  )
}

function WeightInput({
  onSave,
  current,
}: {
  onSave: (kg: number | null) => void
  current?: number
}) {
  const [text, setText] = useState(current ? String(current) : '')

  return (
    <div className="row gap-8">
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor="w-kg">Today’s weight (kg)</label>
        <input
          id="w-kg"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 82.4"
        />
      </div>
      <button
        className="btn btn-primary"
        style={{ alignSelf: 'flex-end' }}
        disabled={!text.trim()}
        onClick={() => {
          const v = Number.parseFloat(text.replace(',', '.'))
          if (Number.isFinite(v) && v > 0) onSave(v)
        }}
      >
        Save
      </button>
      {current !== undefined && (
        <button
          className="btn btn-ghost"
          style={{ alignSelf: 'flex-end' }}
          onClick={() => {
            setText('')
            onSave(null)
          }}
        >
          Clear
        </button>
      )}
    </div>
  )
}
