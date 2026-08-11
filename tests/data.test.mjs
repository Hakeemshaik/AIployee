import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The app source uses extensionless imports, which Node's ESM resolver rejects,
 * so bundle the modules under test with esbuild and import the result directly.
 */
async function loadModules() {
  const built = await esbuild.build({
    stdin: {
      contents: `
        export { BUILTIN_FOODS } from './src/data/foods'
        export { validateFoods } from './src/lib/validate'
        export * from './src/lib/nutrition'
        export * from './src/lib/date'
        export * from './src/lib/plan'
        export { normalise, emptyData } from './src/lib/storage'
      `,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  })

  const code = built.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const m = await loadModules()

// ------------------------------------------------------------- food data

test('the built-in food table is internally consistent', () => {
  const problems = m.validateFoods(m.BUILTIN_FOODS)
  if (problems.length > 0) {
    const report = problems.map((p) => `  • ${p.name} [${p.id}]: ${p.issue}`).join('\n')
    assert.fail(`${problems.length} problem(s) in the food data:\n${report}`)
  }
})

test('every food has a stable, unique id', () => {
  const ids = m.BUILTIN_FOODS.map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate food ids')
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `bad id: ${id}`)
})

test('the table is big enough to be useful', () => {
  assert.ok(m.BUILTIN_FOODS.length > 200, `only ${m.BUILTIN_FOODS.length} foods`)
})

// ------------------------------------------------------------ scaling maths

test('weight foods scale per 100 g', () => {
  const mince = m.BUILTIN_FOODS.find((f) => f.id === 'g-beef-mince-lean-10-fat-raw')
  assert.ok(mince, 'lean mince missing from the table')

  const half = m.scaleNutrients(m.snapshotOf(mince), 50)
  assert.equal(half.kcal, mince.nutrients.kcal / 2)

  // 1 kg of mince — the "how much kg am I adding" case.
  const kilo = m.scaleNutrients(m.snapshotOf(mince), 1000)
  assert.equal(kilo.protein, mince.nutrients.protein * 10)
})

test('unit foods scale per item', () => {
  const egg = m.BUILTIN_FOODS.find((f) => f.id === 'g-egg-large-whole')
  assert.ok(egg)
  const four = m.scaleNutrients(m.snapshotOf(egg), 4)
  assert.equal(Math.round(four.kcal), Math.round(egg.nutrients.kcal * 4))
  assert.equal(Math.round(four.protein * 10) / 10, Math.round(egg.nutrients.protein * 4 * 10) / 10)
})

test('day totals add every entry', () => {
  const egg = m.BUILTIN_FOODS.find((f) => f.id === 'g-egg-large-whole')
  const rice = m.BUILTIN_FOODS.find((f) => f.id === 'g-white-rice-cooked')
  const total = m.totalFor([
    { snapshot: m.snapshotOf(egg), qty: 3 },
    { snapshot: m.snapshotOf(rice), qty: 200 },
  ])
  assert.equal(
    Math.round(total.kcal),
    Math.round(egg.nutrients.kcal * 3 + rice.nutrients.kcal * 2),
  )
})

test('quantities format the way you would say them', () => {
  const weight = { measure: 'weight', name: 'x', nutrients: {} }
  const unit = { measure: 'unit', unitName: 'burger', name: 'x', nutrients: {} }
  assert.equal(m.fmtQty(weight, 250), '250 g')
  assert.equal(m.fmtQty(weight, 1500), '1,5 kg')
  assert.equal(m.fmtQty(unit, 1), '1 burger')
  assert.equal(m.fmtQty(unit, 2), '2 burgers')
})

// -------------------------------------------------------------------- dates

test('date arithmetic stays on local calendar days', () => {
  assert.equal(m.addDays('2026-08-11', 1), '2026-08-12')
  assert.equal(m.addDays('2026-08-31', 1), '2026-09-01')
  assert.equal(m.addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(m.addDays('2028-02-28', 1), '2028-02-29', 'leap year')
  assert.equal(m.diffDays('2026-08-18', '2026-08-11'), 7)
})

test('weeks start where you asked them to', () => {
  // 2026-08-11 is a Tuesday.
  assert.equal(m.weekdayOf('2026-08-11'), 2)
  const mon = m.weekDates('2026-08-11', true)
  assert.equal(mon[0], '2026-08-10', 'Monday-first week starts Monday')
  assert.equal(mon[6], '2026-08-16')
  const sun = m.weekDates('2026-08-11', false)
  assert.equal(sun[0], '2026-08-09', 'Sunday-first week starts Sunday')
})

test('lastNDays ends on the given day', () => {
  const week = m.lastNDays(7, '2026-08-11')
  assert.equal(week.length, 7)
  assert.equal(week[6], '2026-08-11')
  assert.equal(week[0], '2026-08-05')
})

// --------------------------------------------------------- recurring meals

function dataWithRecurring(overrides) {
  const base = m.emptyData()
  return {
    ...base,
    recurring: [
      {
        id: 'r1',
        name: 'Weekday breakfast',
        meal: 'breakfast',
        weekdays: [1, 3, 5],
        items: [{ id: 'i1', foodId: 'g-egg-large-whole', snapshot: { measure: 'unit', unitName: 'egg', name: 'Egg', nutrients: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8, fibre: 0, sugar: 0.2, sodium: 71 } }, qty: 3 }],
        active: true,
        skipDates: [],
        createdAt: 0,
        ...overrides,
      },
    ],
  }
}

test('a repeating meal lands only on its weekdays', () => {
  const data = dataWithRecurring()
  // 2026-08-10 Mon, 11 Tue, 12 Wed
  assert.equal(m.resolvePlan(data, '2026-08-10').length, 1, 'Monday')
  assert.equal(m.resolvePlan(data, '2026-08-11').length, 0, 'Tuesday')
  assert.equal(m.resolvePlan(data, '2026-08-12').length, 1, 'Wednesday')
})

test('skipping a date removes just that one occurrence', () => {
  const data = dataWithRecurring({ skipDates: ['2026-08-10'] })
  assert.equal(m.resolvePlan(data, '2026-08-10').length, 0)
  assert.equal(m.resolvePlan(data, '2026-08-12').length, 1)
})

test('pausing a repeating meal hides every occurrence', () => {
  const data = dataWithRecurring({ active: false })
  assert.equal(m.resolvePlan(data, '2026-08-10').length, 0)
})

test('start and end dates bound a repeating meal', () => {
  const data = dataWithRecurring({ startDate: '2026-08-12', endDate: '2026-08-14' })
  assert.equal(m.resolvePlan(data, '2026-08-10').length, 0, 'before start')
  assert.equal(m.resolvePlan(data, '2026-08-12').length, 1, 'inside range')
  assert.equal(m.resolvePlan(data, '2026-08-17').length, 0, 'after end')
})

test('resolved recurring items get ids unique to their date', () => {
  const data = dataWithRecurring()
  const a = m.resolvePlan(data, '2026-08-10')[0]
  const b = m.resolvePlan(data, '2026-08-12')[0]
  assert.notEqual(a.id, b.id)
})

test('one-off plan items and repeating meals combine', () => {
  const data = dataWithRecurring()
  data.planDays = {
    '2026-08-10': {
      date: '2026-08-10',
      items: [
        {
          id: 'p1',
          foodId: 'g-white-rice-cooked',
          snapshot: m.snapshotOf(m.BUILTIN_FOODS.find((f) => f.id === 'g-white-rice-cooked')),
          qty: 200,
          meal: 'lunch',
        },
      ],
    },
  }
  const resolved = m.resolvePlan(data, '2026-08-10')
  assert.equal(resolved.length, 2)
  assert.equal(resolved.filter((i) => i.source === 'recurring').length, 1)
  assert.equal(resolved.filter((i) => i.source === 'day').length, 1)
})

// ------------------------------------------------------------------ storage

test('normalise repairs partial or hand-edited saved data', () => {
  const repaired = m.normalise({ log: [{ id: 'x' }, null], settings: { goals: { protein: 200 } } })
  assert.equal(repaired.log.length, 0, 'entries without a snapshot are dropped')
  assert.equal(repaired.settings.goals.protein, 200, 'keeps the goal that was set')
  assert.ok(repaired.settings.goals.kcal > 0, 'fills in missing goals')
  assert.deepEqual(repaired.recurring, [])
  assert.ok(Array.isArray(repaired.weights))
})

test('normalise survives complete rubbish', () => {
  for (const junk of [null, undefined, 42, 'nope', []]) {
    const out = m.normalise(junk)
    assert.ok(out.settings.goals.kcal > 0)
    assert.deepEqual(out.log, [])
  }
})
