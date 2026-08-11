import { useRef, useState } from 'react'
import { Sheet } from '../components/Sheet'
import { BUILTIN_FOODS } from '../data/foods'
import { NUTRIENT_LABEL, nutrientUnit } from '../lib/nutrition'
import * as storage from '../lib/storage'
import { useStore } from '../state/store'
import { NUTRIENT_KEYS, type NutrientKey, type ThemePref } from '../types'

interface Props {
  toast: (msg: string) => void
}

const OPTIONAL: NutrientKey[] = ['protein', 'carbs', 'fat', 'fibre', 'sugar', 'sodium']
const PRIMARY_GOALS: NutrientKey[] = ['kcal', 'protein', 'carbs', 'fat']

export function SettingsScreen({ toast }: Props) {
  const { data, dispatch, resetAll } = useStore()
  const { settings } = data
  const fileRef = useRef<HTMLInputElement>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [showAllGoals, setShowAllGoals] = useState(false)

  const customCount = Object.values(data.foods).filter((f) => f.custom).length

  const exportData = () => {
    const blob = new Blob([storage.exportJSON(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `macros-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Backup downloaded')
  }

  const importData = async (file: File) => {
    try {
      const next = storage.importJSON(await file.text())
      if (
        !confirm(
          `Replace everything currently in the app with this backup?\n\n` +
            `${next.log.length} logged entries · ${next.recurring.length} repeating meals · ` +
            `${Object.keys(next.foods).length} saved foods`,
        )
      )
        return
      dispatch({ type: 'replace', data: next })
      storage.saveNow(next)
      toast('Backup restored')
    } catch (err) {
      console.error(err)
      alert("That file could not be read — make sure it's a backup this app exported.")
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <h1>Settings</h1>
        </div>
      </div>

      <div className="screen stack gap-16" style={{ paddingTop: 12 }}>
        <div className="section">
          <div className="section-title">Daily goals</div>
          <div className="card">
            {/* The four you look at daily; the rest sit behind a disclosure. */}
            {(showAllGoals ? NUTRIENT_KEYS : PRIMARY_GOALS).map((key) => (
              <div className="setting-row" key={key}>
                <div className="grow">
                  <div className="setting-label">
                    {NUTRIENT_LABEL[key]}{' '}
                    <span className="faint small">{nutrientUnit(key)}</span>
                  </div>
                </div>
                <input
                  className="goal-input"
                  type="number"
                  inputMode="numeric"
                  value={settings.goals[key]}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value)
                    dispatch({ type: 'setGoals', goals: { [key]: Number.isFinite(v) ? v : 0 } })
                  }}
                  aria-label={`${NUTRIENT_LABEL[key]} goal`}
                />
              </div>
            ))}
            <div className="setting-row">
              <div className="grow">
                <div className="setting-label">
                  Goal weight <span className="faint small">kg</span>
                </div>
              </div>
              <input
                className="goal-input"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={settings.goals.weightKg ?? ''}
                placeholder="—"
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  dispatch({
                    type: 'setGoals',
                    goals: { weightKg: Number.isFinite(v) ? v : undefined },
                  })
                }}
                aria-label="Goal weight"
              />
            </div>
          </div>
          <div className="row wrap gap-8" style={{ marginTop: 12 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setCalcOpen(true)}>
              Work out my targets
            </button>
            <button className="btn btn-quiet" onClick={() => setShowAllGoals(!showAllGoals)}>
              {showAllGoals ? 'Fewer' : 'Fibre, sugar & sodium'}
            </button>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Show on the day summary</div>
          <div className="card">
            {OPTIONAL.map((key) => {
              const on = settings.trackedNutrients.includes(key)
              return (
                <div className="setting-row" key={key}>
                  <div className="grow">
                    <div className="setting-label">{NUTRIENT_LABEL[key]}</div>
                  </div>
                  <button
                    className="switch"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Show ${NUTRIENT_LABEL[key]}`}
                    onClick={() =>
                      dispatch({
                        type: 'setSettings',
                        patch: {
                          trackedNutrients: on
                            ? settings.trackedNutrients.filter((k) => k !== key)
                            : // Keep the canonical order rather than tap order.
                              NUTRIENT_KEYS.filter(
                                (k) => k !== 'kcal' && (k === key || settings.trackedNutrients.includes(k)),
                              ),
                        },
                      })
                    }
                  />
                </div>
              )
            })}
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            Everything is recorded either way — this only changes what the summary lists.
          </p>
        </div>

        <div className="section">
          <div className="section-title">Appearance</div>
          <div className="card stack gap-12">
            <div className="field">
              <span className="field-label">Theme</span>
              <div className="segmented">
                {(['system', 'dark', 'light'] as ThemePref[]).map((t) => (
                  <button
                    key={t}
                    aria-pressed={settings.theme === t}
                    onClick={() => dispatch({ type: 'setSettings', patch: { theme: t } })}
                  >
                    {t === 'system' ? 'System' : t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <div className="grow">
                <div className="setting-label">Weeks start on Monday</div>
                <div className="setting-help">Affects the Plan week strip and day pickers</div>
              </div>
              <button
                className="switch"
                role="switch"
                aria-checked={settings.weekStartsMonday}
                aria-label="Weeks start on Monday"
                onClick={() =>
                  dispatch({
                    type: 'setSettings',
                    patch: { weekStartsMonday: !settings.weekStartsMonday },
                  })
                }
              />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Your data</div>
          <div className="card stack gap-12">
            <p className="small muted" style={{ margin: 0 }}>
              Everything lives on this device only — no account, no server. Back up before
              clearing your browser data or moving to a new phone.
            </p>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-val num">{data.log.length}</div>
                <div className="stat-key">Logged entries</div>
              </div>
              <div className="stat">
                <div className="stat-val num">{Object.keys(data.planDays).length}</div>
                <div className="stat-key">Planned days</div>
              </div>
              <div className="stat">
                <div className="stat-val num">{data.recurring.length}</div>
                <div className="stat-key">Repeating meals</div>
              </div>
              <div className="stat">
                <div className="stat-val num">{BUILTIN_FOODS.length + customCount}</div>
                <div className="stat-key">Foods available</div>
              </div>
            </div>
            <div className="row wrap gap-8">
              <button className="btn btn-sm btn-ghost" onClick={exportData}>
                Export backup
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
                Restore backup
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importData(file)
                  e.target.value = ''
                }}
              />
            </div>
            <button
              className="btn btn-sm btn-danger"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                if (
                  confirm(
                    'Delete everything — all logs, plans, custom foods and goals?\n\nThis cannot be undone.',
                  ) &&
                  confirm('Really delete it all?')
                ) {
                  resetAll()
                  toast('Everything cleared')
                }
              }}
            >
              Delete all my data
            </button>
          </div>
        </div>

        <div className="section">
          <div className="section-title">About</div>
          <div className="card stack gap-8">
            <p className="small muted" style={{ margin: 0 }}>
              A personal food and macro tracker with a South African food list. Install it from
              your browser’s share menu (“Add to Home Screen”) and it runs full screen and offline
              like any other app.
            </p>
            <p className="note" style={{ margin: 0 }}>
              Nutrition figures for chain menus are close estimates gathered from published data —
              recipes and portions change, so check the store’s own numbers when it matters. Whole
              foods follow standard composition tables. Every value is editable.
            </p>
          </div>
        </div>
      </div>

      {calcOpen && <TargetCalculator onClose={() => setCalcOpen(false)} toast={toast} />}
    </>
  )
}

/**
 * Mifflin–St Jeor for maintenance calories, then a protein target in g per kg
 * and a macro split. Deliberately simple — you can still type any goal by hand.
 */
function TargetCalculator({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const { data, dispatch } = useStore()
  const [weight, setWeight] = useState(String(data.settings.goals.bodyWeightKg ?? ''))
  const [height, setHeight] = useState('178')
  const [age, setAge] = useState('30')
  const [sex, setSex] = useState<'male' | 'female'>('male')
  const [activity, setActivity] = useState(1.55)
  const [aim, setAim] = useState<'cut' | 'maintain' | 'gain'>('maintain')
  const [proteinPerKg, setProteinPerKg] = useState(2.0)

  const w = Number.parseFloat(weight) || 0
  const h = Number.parseFloat(height) || 0
  const a = Number.parseFloat(age) || 0

  const bmr = w > 0 && h > 0 && a > 0 ? 10 * w + 6.25 * h - 5 * a + (sex === 'male' ? 5 : -161) : 0
  const tdee = bmr * activity
  const kcal = Math.round((aim === 'cut' ? tdee * 0.8 : aim === 'gain' ? tdee * 1.1 : tdee) / 10) * 10
  const protein = Math.round(w * proteinPerKg)
  const fat = Math.round((kcal * 0.28) / 9)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))

  const valid = kcal > 0 && protein > 0

  return (
    <Sheet
      open
      title="Work out my targets"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block"
          disabled={!valid}
          onClick={() => {
            dispatch({
              type: 'setGoals',
              goals: { kcal, protein, carbs, fat, bodyWeightKg: w },
            })
            toast('Goals updated')
            onClose()
          }}
        >
          Use these goals
        </button>
      }
    >
      <div className="stack gap-16">
        <div className="field-grid-3">
          <div className="field">
            <label htmlFor="c-w">Weight (kg)</label>
            <input
              id="c-w"
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="82"
            />
          </div>
          <div className="field">
            <label htmlFor="c-h">Height (cm)</label>
            <input
              id="c-h"
              type="number"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-a">Age</label>
            <input
              id="c-a"
              type="number"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">Sex</span>
          <div className="segmented">
            <button aria-pressed={sex === 'male'} onClick={() => setSex('male')}>
              Male
            </button>
            <button aria-pressed={sex === 'female'} onClick={() => setSex('female')}>
              Female
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Activity</span>
          <div className="chips">
            {[
              [1.2, 'Desk job, no training'],
              [1.375, 'Light, 1–3×/week'],
              [1.55, 'Moderate, 3–5×/week'],
              [1.725, 'Hard, 6–7×/week'],
              [1.9, 'Very hard / physical job'],
            ].map(([v, label]) => (
              <button
                key={v as number}
                className="chip"
                aria-pressed={activity === v}
                onClick={() => setActivity(v as number)}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Goal</span>
          <div className="segmented">
            <button aria-pressed={aim === 'cut'} onClick={() => setAim('cut')}>
              Lose fat
            </button>
            <button aria-pressed={aim === 'maintain'} onClick={() => setAim('maintain')}>
              Maintain
            </button>
            <button aria-pressed={aim === 'gain'} onClick={() => setAim('gain')}>
              Build
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Protein: {proteinPerKg.toFixed(1)} g per kg</span>
          <input
            type="range"
            min="1.2"
            max="3"
            step="0.1"
            value={proteinPerKg}
            onChange={(e) => setProteinPerKg(Number(e.target.value))}
            style={{ padding: 0, border: 'none', background: 'transparent' }}
          />
          <span className="note">
            1.6–2.2 g/kg suits most people training regularly; higher while cutting.
          </span>
        </div>

        {valid ? (
          <div className="card">
            <div className="preview-grid">
              <div className="preview-cell">
                <div className="preview-val num" style={{ color: 'var(--kcal)' }}>
                  {kcal}
                </div>
                <div className="preview-key">kcal</div>
              </div>
              <div className="preview-cell">
                <div className="preview-val num" style={{ color: 'var(--protein)' }}>
                  {protein}
                </div>
                <div className="preview-key">protein g</div>
              </div>
              <div className="preview-cell">
                <div className="preview-val num" style={{ color: 'var(--carbs)' }}>
                  {carbs}
                </div>
                <div className="preview-key">carbs g</div>
              </div>
              <div className="preview-cell">
                <div className="preview-val num" style={{ color: 'var(--fat)' }}>
                  {fat}
                </div>
                <div className="preview-key">fat g</div>
              </div>
            </div>
            <p className="note" style={{ marginBottom: 0, marginTop: 10 }}>
              Maintenance is about {Math.round(tdee / 10) * 10} kcal (Mifflin–St Jeor × activity).
              These are starting estimates — adjust after a fortnight based on the scale.
            </p>
          </div>
        ) : (
          <p className="note">Fill in weight, height and age to see suggested targets.</p>
        )}
      </div>
    </Sheet>
  )
}
