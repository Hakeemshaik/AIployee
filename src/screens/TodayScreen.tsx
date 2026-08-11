import { useMemo, useState } from 'react'
import { ActionMenu } from '../components/ActionMenu'
import { AddFoodSheet } from '../components/AddFoodSheet'
import { DaySummary } from '../components/DaySummary'
import {
  IconChevronLeft,
  IconChevronRight,
  IconMore,
  IconPlus,
  IconRepeat,
  IconTrash,
} from '../components/Icons'
import { QtyEditor } from '../components/QtyEditor'
import { Sheet } from '../components/Sheet'
import { addDays, friendlyDate, todayISO } from '../lib/date'
import { fmtG, fmtKcal, fmtQty, scaleNutrients, totalFor } from '../lib/nutrition'
import { resolvePlan } from '../lib/plan'
import { newId } from '../lib/id'
import { useStore } from '../state/store'
import {
  MEAL_LABEL,
  MEAL_SLOTS,
  type LogEntry,
  type MealSlot,
  type SavedMeal,
} from '../types'

interface Props {
  toast: (msg: string) => void
}

export function TodayScreen({ toast }: Props) {
  const { data, dispatch, logFood, logItems } = useStore()
  const [date, setDate] = useState(todayISO())
  const [adding, setAdding] = useState<MealSlot | null>(null)
  const [editing, setEditing] = useState<LogEntry | null>(null)
  const [savingMeal, setSavingMeal] = useState<MealSlot | null>(null)
  const [mealMenu, setMealMenu] = useState<MealSlot | null>(null)
  const [dayMenu, setDayMenu] = useState(false)

  const entries = useMemo(() => data.log.filter((e) => e.date === date), [data.log, date])
  const totals = useMemo(() => totalFor(entries), [entries])

  const byMeal = useMemo(() => {
    const out: Record<MealSlot, LogEntry[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    }
    for (const e of entries) out[e.meal].push(e)
    return out
  }, [entries])

  const planned = useMemo(() => resolvePlan(data, date), [data, date])

  // A planned item is considered done once that food shows up in the same meal,
  // whether it got there via "Log all" or because you logged it by hand.
  const unloggedPlan = useMemo(() => {
    const logged = new Set(entries.map((e) => `${e.meal}|${e.foodId}`))
    return planned.filter((p) => !logged.has(`${p.meal}|${p.foodId}`))
  }, [planned, entries])

  const plannedTotals = useMemo(() => totalFor(unloggedPlan), [unloggedPlan])

  const addSavedMeal = (meal: SavedMeal, slot: MealSlot) => {
    logItems(
      meal.items.map((i) => ({
        foodId: i.foodId,
        snapshot: i.snapshot,
        qty: i.qty,
        meal: slot,
      })),
      date,
    )
    toast(`${meal.name} logged`)
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <button
            className="icon-btn icon-btn-plain"
            onClick={() => setDate(addDays(date, -1))}
            aria-label="Previous day"
          >
            <IconChevronLeft />
          </button>
          {/* A real date input sits invisibly over the title, so tapping it
              opens the native picker on every platform. */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <h1 style={{ textAlign: 'center' }}>{friendlyDate(date)}</h1>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                border: 'none',
                padding: 0,
                background: 'transparent',
              }}
              aria-label="Pick a date"
            />
          </div>
          <button
            className="icon-btn icon-btn-plain"
            onClick={() => setDate(addDays(date, 1))}
            aria-label="Next day"
          >
            <IconChevronRight />
          </button>
          <button
            className="icon-btn icon-btn-plain"
            onClick={() => setDayMenu(true)}
            aria-label="Day options"
          >
            <IconMore />
          </button>
        </div>
      </div>

      <div className="screen stack gap-16" style={{ paddingTop: 4 }}>
        <DaySummary
          totals={totals}
          goals={data.settings.goals}
          tracked={data.settings.trackedNutrients}
          plannedRemaining={plannedTotals}
        />

        {unloggedPlan.length > 0 && (
          <div className="banner">
            <div className="banner-text">
              <strong className="num">{fmtKcal(plannedTotals.kcal)} kcal</strong> planned, not
              logged yet
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                logItems(unloggedPlan, date, true)
                toast(
                  `Logged ${unloggedPlan.length} planned item${
                    unloggedPlan.length === 1 ? '' : 's'
                  }`,
                )
              }}
            >
              Log all
            </button>
          </div>
        )}

        {MEAL_SLOTS.map((slot) => {
          const list = byMeal[slot.key]
          const slotTotals = totalFor(list)
          const slotPlan = unloggedPlan.filter((p) => p.meal === slot.key)

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
                  aria-label={`Add food to ${slot.label}`}
                >
                  <IconPlus size={19} />
                </button>
                {list.length > 0 && (
                  <button
                    className="icon-btn"
                    onClick={() => setMealMenu(slot.key)}
                    aria-label={`More options for ${slot.label}`}
                  >
                    <IconMore size={19} />
                  </button>
                )}
              </div>

              {list.length === 0 && slotPlan.length === 0 ? (
                <button
                  className="card card-tight faint small"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => setAdding(slot.key)}
                >
                  Add {slot.label.toLowerCase()}
                </button>
              ) : (
                <div className="entry-list">
                  {list.map((e) => {
                    const n = scaleNutrients(e.snapshot, e.qty)
                    return (
                      <div
                        className="entry"
                        key={e.id}
                        role="button"
                        onClick={() => setEditing(e)}
                      >
                        <div className="entry-main">
                          <div className="entry-name truncate">{e.snapshot.name}</div>
                          <div className="entry-sub truncate">
                            {fmtQty(e.snapshot, e.qty)}
                            {e.snapshot.brand ? ` · ${e.snapshot.brand}` : ''}
                          </div>
                        </div>
                        <div className="entry-right">
                          <div className="entry-kcal num">{fmtKcal(n.kcal)}</div>
                          <div className="entry-p num">{fmtG(n.protein)} g protein</div>
                        </div>
                      </div>
                    )
                  })}

                  {slotPlan.map((p) => {
                    const n = scaleNutrients(p.snapshot, p.qty)
                    return (
                      <div className="entry" key={p.id}>
                        <div className="entry-main">
                          <div className="entry-name">
                            <span className="truncate faint">{p.snapshot.name}</span>
                            <span className="badge badge-pending">
                              {p.source === 'recurring' && <IconRepeat size={10} />} to eat
                            </span>
                          </div>
                          <div className="entry-sub">
                            {fmtQty(p.snapshot, p.qty)} · {fmtKcal(n.kcal)} kcal
                          </div>
                        </div>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            logItems([p], date, true)
                            toast(`${p.snapshot.name} logged`)
                          }}
                        >
                          Log
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

      </div>

      <AddFoodSheet
        open={adding !== null}
        onClose={() => setAdding(null)}
        defaultMeal={adding ?? 'breakfast'}
        mode="log"
        dateLabel={friendlyDate(date)}
        onAddFood={(food, qty, meal) => {
          logFood({ food, qty, meal, date })
          toast(`${food.name} logged`)
        }}
        onAddSavedMeal={addSavedMeal}
      />

      {editing && (
        <EditEntrySheet
          key={editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(id, patch) => dispatch({ type: 'updateLog', id, patch })}
          onDelete={(id) => {
            dispatch({ type: 'removeLog', id })
            toast('Removed')
          }}
        />
      )}

      {savingMeal && (
        <SaveMealSheet
          key={savingMeal}
          slot={savingMeal}
          entries={byMeal[savingMeal]}
          onClose={() => setSavingMeal(null)}
          onSave={(meal) => {
            dispatch({ type: 'saveMeal', meal })
            toast(`Saved “${meal.name}”`)
          }}
        />
      )}

      {mealMenu && (
        <ActionMenu
          title={MEAL_LABEL[mealMenu]}
          onClose={() => setMealMenu(null)}
          actions={[
            { label: 'Add food', onSelect: () => setAdding(mealMenu) },
            { label: 'Save as a reusable meal', onSelect: () => setSavingMeal(mealMenu) },
            {
              label: 'Clear this meal',
              danger: true,
              onSelect: () => {
                for (const e of byMeal[mealMenu]) dispatch({ type: 'removeLog', id: e.id })
                toast(`${MEAL_LABEL[mealMenu]} cleared`)
              },
            },
          ]}
        />
      )}

      {dayMenu && (
        <ActionMenu
          title={friendlyDate(date)}
          onClose={() => setDayMenu(false)}
          actions={[
            ...(date !== todayISO()
              ? [{ label: 'Jump to today', onSelect: () => setDate(todayISO()) }]
              : []),
            ...(entries.length > 0
              ? [
                  {
                    label: 'Clear this day',
                    danger: true,
                    onSelect: () => {
                      if (confirm(`Clear everything logged on ${friendlyDate(date)}?`)) {
                        dispatch({ type: 'clearDay', date })
                        toast('Day cleared')
                      }
                    },
                  },
                ]
              : []),
            { label: 'Close', onSelect: () => {} },
          ]}
        />
      )}
    </>
  )
}


/** Mounted with key={entry.id}, so its local state starts from that entry. */
function EditEntrySheet({
  entry,
  onClose,
  onSave,
  onDelete,
}: {
  entry: LogEntry
  onClose: () => void
  onSave: (id: string, patch: Partial<LogEntry>) => void
  onDelete: (id: string) => void
}) {
  const [qty, setQty] = useState(entry.qty)
  const [meal, setMeal] = useState<MealSlot>(entry.meal)

  return (
    <Sheet
      open
      title={entry.snapshot.name}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-danger"
            onClick={() => {
              onDelete(entry.id)
              onClose()
            }}
            aria-label="Delete entry"
          >
            <IconTrash />
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              onSave(entry.id, { qty, meal })
              onClose()
            }}
            disabled={qty <= 0}
          >
            Save changes
          </button>
        </>
      }
    >
      <QtyEditor
        food={entry.snapshot}
        qty={qty}
        onQtyChange={setQty}
        meal={meal}
        onMealChange={setMeal}
      />
    </Sheet>
  )
}

function SaveMealSheet({
  slot,
  entries,
  onClose,
  onSave,
}: {
  slot: MealSlot
  entries: LogEntry[]
  onClose: () => void
  onSave: (meal: SavedMeal) => void
}) {
  const [name, setName] = useState('')
  const totals = totalFor(entries)

  return (
    <Sheet
      open
      title="Save as a meal"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block"
          disabled={!name.trim() || entries.length === 0}
          onClick={() => {
            onSave({
              id: newId('m'),
              name: name.trim(),
              defaultMeal: slot,
              items: entries.map((e) => ({
                id: newId('i'),
                foodId: e.foodId,
                snapshot: e.snapshot,
                qty: e.qty,
              })),
              createdAt: Date.now(),
            })
            setName('')
            onClose()
          }}
        >
          Save meal
        </button>
      }
    >
      <div className="stack gap-12">
        <p className="small muted" style={{ margin: 0 }}>
          Saves these {entries.length} item{entries.length === 1 ? '' : 's'} as a combo you can
          log or plan in one tap.
        </p>
        <div className="field">
          <label htmlFor="meal-name">Name</label>
          <input
            id="meal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Post-gym eggs & oats"
            autoFocus
          />
        </div>
        <div className="entry-list">
          {entries.map((e) => (
            <div className="entry" key={e.id}>
              <div className="entry-main">
                <div className="entry-name truncate">{e.snapshot.name}</div>
                <div className="entry-sub">{fmtQty(e.snapshot, e.qty)}</div>
              </div>
              <div className="entry-right">
                <div className="entry-kcal num">
                  {fmtKcal(scaleNutrients(e.snapshot, e.qty).kcal)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="note">
          Total: {fmtKcal(totals.kcal)} kcal · {fmtG(totals.protein)} g protein
        </div>
      </div>
    </Sheet>
  )
}
