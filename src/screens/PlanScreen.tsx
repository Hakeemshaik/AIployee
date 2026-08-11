import { useMemo, useState } from 'react'
import { AddFoodSheet } from '../components/AddFoodSheet'
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconPlus,
  IconRepeat,
  IconTrash,
} from '../components/Icons'
import { Sheet } from '../components/Sheet'
import {
  addDays,
  friendlyDate,
  longDate,
  todayISO,
  WEEKDAY_LETTER,
  WEEKDAY_SHORT,
  weekDates,
  weekdayOf,
  weekdayOrder,
} from '../lib/date'
import { newId } from '../lib/id'
import { fmtG, fmtKcal, fmtQty, scaleNutrients, totalFor } from '../lib/nutrition'
import { resolvePlan, type ResolvedPlanItem } from '../lib/plan'
import { useStore } from '../state/store'
import {
  MEAL_LABEL,
  MEAL_SLOTS,
  type MealSlot,
  type PlanItem,
  type RecurringMeal,
  type SavedMeal,
} from '../types'

interface Props {
  toast: (msg: string) => void
}

export function PlanScreen({ toast }: Props) {
  const { data, dispatch, makePlanItem, logPlanForDate } = useStore()
  const mondayFirst = data.settings.weekStartsMonday

  const [anchor, setAnchor] = useState(todayISO())
  const [selected, setSelected] = useState(todayISO())
  const [adding, setAdding] = useState<MealSlot | null>(null)
  const [copying, setCopying] = useState(false)
  const [editingRecurring, setEditingRecurring] = useState<RecurringMeal | 'new' | null>(null)

  const week = useMemo(() => weekDates(anchor, mondayFirst), [anchor, mondayFirst])
  const planned = useMemo(() => resolvePlan(data, selected), [data, selected])
  const totals = useMemo(() => totalFor(planned), [planned])

  const byMeal = useMemo(() => {
    const out: Record<MealSlot, ResolvedPlanItem[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    }
    for (const p of planned) out[p.meal].push(p)
    return out
  }, [planned])

  const addSavedMeal = (meal: SavedMeal, slot: MealSlot) => {
    dispatch({
      type: 'addPlanItems',
      date: selected,
      items: meal.items.map((i) => ({ ...i, id: newId('p'), meal: slot })),
    })
    toast(`${meal.name} added to plan`)
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <h1>Plan</h1>
          <button
            className="icon-btn icon-btn-plain"
            onClick={() => setAnchor(addDays(anchor, -7))}
            aria-label="Previous week"
          >
            <IconChevronLeft />
          </button>
          <button className="btn btn-quiet" onClick={() => setAnchor(todayISO())}>
            This week
          </button>
          <button
            className="icon-btn icon-btn-plain"
            onClick={() => setAnchor(addDays(anchor, 7))}
            aria-label="Next week"
          >
            <IconChevronRight />
          </button>
        </div>
      </div>

      <div className="screen stack gap-12" style={{ paddingTop: 12 }}>
        <div className="week-strip">
          {week.map((d) => {
            const dayTotals = totalFor(resolvePlan(data, d))
            const isToday = d === todayISO()
            return (
              <button
                key={d}
                className={`day-cell${isToday ? ' today' : ''}`}
                aria-pressed={d === selected}
                onClick={() => setSelected(d)}
              >
                <span className="day-dow">{WEEKDAY_SHORT[weekdayOf(d)]}</span>
                <span className="day-num num">{Number(d.slice(8, 10))}</span>
                {dayTotals.kcal > 0 ? (
                  <span className="day-kcal">{fmtKcal(dayTotals.kcal)}</span>
                ) : (
                  <span className="day-kcal faint">—</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="row" style={{ padding: '4px 4px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{longDate(selected)}</div>
            <div className="small faint num">
              {planned.length === 0
                ? 'Nothing planned'
                : `${fmtKcal(totals.kcal)} kcal · ${fmtG(totals.protein)} g protein`}
            </div>
          </div>
          {planned.length > 0 && (
            <>
              <button
                className="icon-btn"
                onClick={() => setCopying(true)}
                aria-label="Copy this day to other days"
              >
                <IconCopy size={19} />
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  const n = logPlanForDate(selected)
                  toast(`Logged ${n} item${n === 1 ? '' : 's'} to ${friendlyDate(selected)}`)
                }}
              >
                Log this day
              </button>
            </>
          )}
        </div>

        {MEAL_SLOTS.map((slot) => {
          const list = byMeal[slot.key]
          const slotTotals = totalFor(list)
          return (
            <div className="meal-block" key={slot.key}>
              <div className="meal-head">
                <span className="meal-name">{slot.label}</span>
                {list.length > 0 && (
                  <span className="meal-totals num">{fmtKcal(slotTotals.kcal)} kcal</span>
                )}
                <span className="spacer" />
                <button
                  className="icon-btn"
                  onClick={() => setAdding(slot.key)}
                  aria-label={`Add to ${slot.label}`}
                >
                  <IconPlus size={19} />
                </button>
              </div>

              {list.length === 0 ? (
                <button
                  className="card card-tight faint small"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => setAdding(slot.key)}
                >
                  Plan {slot.label.toLowerCase()}
                </button>
              ) : (
                <div className="entry-list">
                  {list.map((p) => {
                    const n = scaleNutrients(p.snapshot, p.qty)
                    return (
                      <div className="entry" key={p.id}>
                        <div className="entry-main">
                          <div className="entry-name">
                            <span className="truncate">{p.snapshot.name}</span>
                            {p.source === 'recurring' && (
                              <span
                                className="badge badge-repeat"
                                title={`Repeats: ${p.recurringName}`}
                              >
                                <IconRepeat size={10} />
                              </span>
                            )}
                          </div>
                          <div className="entry-sub truncate">
                            {fmtQty(p.snapshot, p.qty)}
                            {p.source === 'recurring' ? ` · ${p.recurringName}` : ''}
                          </div>
                        </div>
                        <div className="entry-right">
                          <div className="entry-kcal num">{fmtKcal(n.kcal)}</div>
                          <div className="entry-p num">{fmtG(n.protein)} g protein</div>
                        </div>
                        <button
                          className="star"
                          aria-label="Remove from this day"
                          onClick={() => {
                            if (p.source === 'day') {
                              dispatch({ type: 'removePlanItem', date: selected, id: p.id })
                            } else if (p.recurringId) {
                              dispatch({
                                type: 'skipRecurring',
                                id: p.recurringId,
                                date: selected,
                                skip: true,
                              })
                              toast(`Skipped “${p.recurringName}” on this day only`)
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        <SkippedRecurring date={selected} />

        <div className="section">
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0, flex: 1 }}>
              Repeating meals
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditingRecurring('new')}>
              <IconPlus size={15} /> New
            </button>
          </div>

          {data.recurring.length === 0 ? (
            <div className="card">
              <p className="small faint" style={{ margin: 0 }}>
                Set a meal up once and have it land on the days you choose.
              </p>
            </div>
          ) : (
            <div className="stack gap-8">
              {data.recurring.map((r) => {
                const rTotals = totalFor(r.items)
                return (
                  <div className="card card-tight" key={r.id}>
                    <div className="row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row gap-6">
                          <span style={{ fontWeight: 600 }}>{r.name}</span>
                          {!r.active && <span className="badge">paused</span>}
                        </div>
                        <div className="small faint num">
                          {MEAL_LABEL[r.meal]} · {fmtKcal(rTotals.kcal)} kcal ·{' '}
                          {fmtG(rTotals.protein)} g protein
                        </div>
                        <div className="row gap-6" style={{ marginTop: 8 }}>
                          {weekdayOrder(mondayFirst).map((d) => (
                            <span
                              key={d}
                              className="tiny"
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                display: 'grid',
                                placeItems: 'center',
                                fontWeight: 700,
                                background: r.weekdays.includes(d)
                                  ? 'var(--accent)'
                                  : 'var(--surface-2)',
                                color: r.weekdays.includes(d)
                                  ? 'var(--accent-ink)'
                                  : 'var(--text-faint)',
                              }}
                            >
                              {WEEKDAY_LETTER[d]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setEditingRecurring(r)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      <AddFoodSheet
        open={adding !== null}
        onClose={() => setAdding(null)}
        defaultMeal={adding ?? 'breakfast'}
        mode="plan"
        dateLabel={friendlyDate(selected)}
        onAddFood={(food, qty, meal) => {
          dispatch({
            type: 'addPlanItems',
            date: selected,
            items: [makePlanItem(food, qty, meal)],
          })
          toast(`${food.name} added to plan`)
        }}
        onAddSavedMeal={addSavedMeal}
      />

      {copying && (
        <CopyDaySheet
          from={selected}
          onClose={() => setCopying(false)}
          onCopy={(dates, replace) => {
            const items = resolvePlan(data, selected)
            for (const d of dates) {
              const fresh: PlanItem[] = items.map((i) => ({
                id: newId('p'),
                foodId: i.foodId,
                snapshot: i.snapshot,
                qty: i.qty,
                meal: i.meal,
              }))
              if (replace) {
                dispatch({ type: 'setPlanItems', date: d, items: fresh })
              } else {
                dispatch({ type: 'addPlanItems', date: d, items: fresh })
              }
            }
            toast(`Copied to ${dates.length} day${dates.length === 1 ? '' : 's'}`)
            setCopying(false)
          }}
        />
      )}

      {editingRecurring && (
        <RecurringSheet
          key={editingRecurring === 'new' ? 'new' : editingRecurring.id}
          initial={editingRecurring === 'new' ? null : editingRecurring}
          onClose={() => setEditingRecurring(null)}
          onSave={(meal) => {
            dispatch({ type: 'saveRecurring', meal })
            toast(`Saved “${meal.name}”`)
            setEditingRecurring(null)
          }}
          onDelete={(id) => {
            dispatch({ type: 'deleteRecurring', id })
            toast('Repeating meal deleted')
            setEditingRecurring(null)
          }}
        />
      )}
    </>
  )
}

/** Lets you undo a "skip this day" without digging through settings. */
function SkippedRecurring({ date }: { date: string }) {
  const { data, dispatch } = useStore()
  const skipped = data.recurring.filter((r) => r.skipDates.includes(date))
  if (skipped.length === 0) return null

  return (
    <div className="card card-tight">
      <div className="small muted" style={{ marginBottom: 8 }}>
        Skipped on this day:
      </div>
      <div className="row wrap gap-8">
        {skipped.map((r) => (
          <button
            key={r.id}
            className="chip"
            onClick={() => dispatch({ type: 'skipRecurring', id: r.id, date, skip: false })}
          >
            <IconRepeat size={12} /> {r.name} · undo
          </button>
        ))}
      </div>
    </div>
  )
}

function CopyDaySheet({
  from,
  onClose,
  onCopy,
}: {
  from: string
  onClose: () => void
  onCopy: (dates: string[], replace: boolean) => void
}) {
  const { data } = useStore()
  const [picked, setPicked] = useState<string[]>([])
  const [replace, setReplace] = useState(false)

  // Two weeks forward from the source day is the useful window.
  const options = Array.from({ length: 14 }, (_, i) => addDays(from, i + 1))

  const toggle = (d: string) =>
    setPicked((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  return (
    <Sheet
      open
      title={`Copy ${friendlyDate(from)}’s plan`}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block"
          disabled={picked.length === 0}
          onClick={() => onCopy(picked, replace)}
        >
          Copy to {picked.length || 'no'} day{picked.length === 1 ? '' : 's'}
        </button>
      }
    >
      <div className="stack gap-12">
        <p className="small muted" style={{ margin: 0 }}>
          Copies as one-off planned items. Repeating meals already land on their own days.
        </p>

        <div className="entry-list">
          {options.map((d) => {
            const existing = resolvePlan(data, d).length
            return (
              <div className="entry" key={d} role="button" onClick={() => toggle(d)}>
                <div className="entry-main">
                  <div className="entry-name">{friendlyDate(d)}</div>
                  {existing > 0 && (
                    <div className="entry-sub">{existing} item(s) already planned</div>
                  )}
                </div>
                <div
                  className="switch"
                  role="checkbox"
                  aria-checked={picked.includes(d)}
                  style={{ pointerEvents: 'none' }}
                />
              </div>
            )
          })}
        </div>

        <div className="setting-row">
          <div className="grow">
            <div className="setting-label">Replace what’s there</div>
            <div className="setting-help">
              Off: adds alongside existing plans. On: clears the day’s one-off items first.
            </div>
          </div>
          <button
            className="switch"
            role="switch"
            aria-checked={replace}
            aria-label="Replace existing plan"
            onClick={() => setReplace(!replace)}
          />
        </div>
      </div>
    </Sheet>
  )
}

function RecurringSheet({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: RecurringMeal | null
  onClose: () => void
  onSave: (meal: RecurringMeal) => void
  onDelete: (id: string) => void
}) {
  const { data, makePlanItem, dispatch } = useStore()
  const mondayFirst = data.settings.weekStartsMonday

  const [name, setName] = useState(initial?.name ?? '')
  const [meal, setMeal] = useState<MealSlot>(initial?.meal ?? 'breakfast')
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? [1, 2, 3, 4, 5])
  const [items, setItems] = useState<Omit<PlanItem, 'meal'>[]>(initial?.items ?? [])
  const [active, setActive] = useState(initial?.active ?? true)
  const [adding, setAdding] = useState(false)

  const totals = totalFor(items)

  const save = () => {
    onSave({
      id: initial?.id ?? newId('r'),
      name: name.trim() || 'Repeating meal',
      meal,
      weekdays: [...weekdays].sort(),
      items,
      active,
      skipDates: initial?.skipDates ?? [],
      startDate: initial?.startDate,
      endDate: initial?.endDate,
      createdAt: initial?.createdAt ?? Date.now(),
    })
  }

  return (
    <>
      <Sheet
        open
        title={initial ? 'Edit repeating meal' : 'New repeating meal'}
        onClose={onClose}
        footer={
          <>
            {initial && (
              <button
                className="btn btn-danger"
                aria-label="Delete"
                onClick={() => {
                  if (confirm(`Delete “${initial.name}”?`)) onDelete(initial.id)
                }}
              >
                <IconTrash />
              </button>
            )}
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={items.length === 0 || weekdays.length === 0}
              onClick={save}
            >
              Save
            </button>
          </>
        }
      >
        <div className="stack gap-16">
          <div className="field">
            <label htmlFor="rec-name">Name</label>
            <input
              id="rec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekday breakfast"
            />
          </div>

          <div className="field">
            <span className="field-label">Meal</span>
            <div className="segmented">
              {MEAL_SLOTS.map((m) => (
                <button key={m.key} aria-pressed={meal === m.key} onClick={() => setMeal(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Repeats on</span>
            <div className="weekday-picker">
              {weekdayOrder(mondayFirst).map((d) => (
                <button
                  key={d}
                  aria-pressed={weekdays.includes(d)}
                  aria-label={WEEKDAY_SHORT[d]}
                  onClick={() =>
                    setWeekdays((prev) =>
                      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                    )
                  }
                >
                  {WEEKDAY_LETTER[d]}
                </button>
              ))}
            </div>
            <span className="note">
              {weekdays.length === 0
                ? 'Pick at least one day.'
                : `Lands on ${weekdays
                    .slice()
                    .sort()
                    .map((d) => WEEKDAY_SHORT[d])
                    .join(', ')} every week.`}
            </span>
          </div>

          <div className="field">
            <div className="row">
              <span className="field-label" style={{ flex: 1 }}>
                Foods
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)}>
                <IconPlus size={15} /> Add
              </button>
            </div>

            {items.length === 0 ? (
              <div className="empty" style={{ padding: 18 }}>
                No foods yet — add what this meal is made of.
              </div>
            ) : (
              <div className="entry-list">
                {items.map((i) => (
                  <div className="entry" key={i.id}>
                    <div className="entry-main">
                      <div className="entry-name truncate">{i.snapshot.name}</div>
                      <div className="entry-sub">{fmtQty(i.snapshot, i.qty)}</div>
                    </div>
                    <div className="entry-right">
                      <div className="entry-kcal num">
                        {fmtKcal(scaleNutrients(i.snapshot, i.qty).kcal)}
                      </div>
                    </div>
                    <button
                      className="star"
                      aria-label="Remove"
                      onClick={() => setItems(items.filter((x) => x.id !== i.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <span className="note num">
                Per day: {fmtKcal(totals.kcal)} kcal · {fmtG(totals.protein)} g protein ·{' '}
                {fmtG(totals.carbs)} g carbs · {fmtG(totals.fat)} g fat
              </span>
            )}
          </div>

          <div className="setting-row">
            <div className="grow">
              <div className="setting-label">Active</div>
              <div className="setting-help">Pause it to stop it appearing, without deleting.</div>
            </div>
            <button
              className="switch"
              role="switch"
              aria-checked={active}
              aria-label="Active"
              onClick={() => setActive(!active)}
            />
          </div>

          {initial && initial.skipDates.length > 0 && (
            <div className="field">
              <span className="field-label">Skipped days</span>
              <div className="row wrap gap-8">
                {initial.skipDates.map((d) => (
                  <button
                    key={d}
                    className="chip"
                    onClick={() =>
                      dispatch({
                        type: 'skipRecurring',
                        id: initial.id,
                        date: d,
                        skip: false,
                      })
                    }
                  >
                    {friendlyDate(d)} · undo
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>

      <AddFoodSheet
        open={adding}
        onClose={() => setAdding(false)}
        defaultMeal={meal}
        mode="plan"
        dateLabel={name.trim() || 'this meal'}
        onAddFood={(food, qty) => {
          const item = makePlanItem(food, qty, meal)
          setItems((prev) => [...prev, { id: item.id, foodId: item.foodId, snapshot: item.snapshot, qty: item.qty }])
        }}
        onAddSavedMeal={(savedMeal) => {
          setItems((prev) => [
            ...prev,
            ...savedMeal.items.map((i) => ({ ...i, id: newId('i') })),
          ])
        }}
      />
    </>
  )
}
