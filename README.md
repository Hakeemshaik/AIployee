# Macros — personal food & meal tracker

An offline-first food, calorie and macro tracker built around a South African food
list: the fast-food chains you actually eat at, and the groceries you actually weigh.

Log what you ate, plan days ahead, set meals to repeat on chosen weekdays, and watch
calories, protein and the rest add up.

It installs to your phone's home screen from the browser and runs full screen and
offline like any other app. All data stays on the device — no account, no server.

---

## What it does

**Today** — the logging screen

- Calorie ring showing what's left, plus bars for protein, carbs and fat against your goals
- Breakfast / Lunch / Dinner / Snacks, each with its own total and its own **+**
- Add a food, pick grams or a count, see the numbers before you commit
- Tap any entry to change the amount or move it to another meal
- Anything you planned but haven't eaten yet shows greyed out with a **Log** button
- Each meal's **⋯** saves it as a reusable combo or clears it; the day's **⋯** clears the day
- Step through days with the arrows, or tap the date for a picker

**Plan** — days ahead

- A week strip with each day's planned calories
- Build a day's meals, then **Log this day** when you eat it
- **Copy to…** pushes a day's plan onto any of the next 14 days
- **Repeating meals**: set a meal up once, choose its weekdays, and it lands on every
  matching day — the same weekday breakfast, chicken and rice every Mon/Wed/Fri.
  Skip a single occurrence without touching the schedule, or pause the whole thing.

**Foods** — 250+ foods, all editable

- Browse by chain (McDonald's, KFC, Nando's, Steers, Wimpy, Burger King, Chicken Licken,
  Debonairs, Roman's, Spur, Ocean Basket/Fishaways, cafés) or by category
- Groceries and whole foods: mince (extra lean / lean / regular / ostrich / lamb / chicken),
  every steak cut, chicken portions, eggs, fish, dairy and cheese, rice, pap, bread,
  oats, legumes, veg, fruit, nuts, oils, biltong, snacks, drinks, protein powder
- Search across everything; star the ones you eat often
- Edit any food's numbers off the actual pack label, or add your own from scratch

**Trends**

- 7 / 30 / 90-day calorie and protein charts against your goals
- Average intake, days you hit your protein goal, logging streak, macro split
- Daily weight with a trend line, plus protein per kg of bodyweight

**Settings**

- Goals for calories, protein, carbs, fat, fibre, sugar, sodium and goal weight
- A calculator that works targets out from your weight, height, age, activity and aim
- Choose which nutrients the day summary lists
- Dark / light / follow-system
- Export a JSON backup, restore one, or wipe everything

---

## Running it

```bash
npm install
npm run dev
```

To use it on your phone while developing, expose the dev server on your network and
open the printed address on the phone (same Wi-Fi):

```bash
npm run dev -- --host
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Check the food data and the logging/planning logic |
| `npm run icons` | Regenerate the app icons in `public/` |

## Installing it on your phone

1. Open the app's URL in Safari (iOS) or Chrome (Android).
2. **iOS**: Share → *Add to Home Screen*. **Android**: menu → *Install app*.
3. Launch it from the home-screen icon — full screen, no browser chrome, works offline.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages.

**One-time setup, and it has to be done by hand:** repository **Settings → Pages →
Build and deployment → Source: GitHub Actions**. Until that is set, the workflow fails
at `actions/configure-pages` with *"Create Pages site failed: Resource not accessible by
integration"* — a workflow cannot enable Pages itself, because creating a Pages site
needs repo admin rights that `GITHUB_TOKEN` is never granted. Re-run the workflow after
flipping it. If the deploy step then fails on permissions, check **Settings → Actions →
General → Workflow permissions** is *Read and write*.

After that, every push deploys and the app is served at `https://<user>.github.io/<repo>/`.

It deploys from `main` and from the `claude/food-tracking-meal-planner-rc976z` branch,
so the app can go live before the branch is merged. Drop the branch from the `on.push`
list once it is merged.

The build uses a relative base path, so the same output also works from any static
host or a subdirectory without reconfiguring.

Note that GitHub Pages sites are publicly reachable. That only exposes the app itself —
your log lives in your own browser's storage and is never uploaded.

---

## How data is stored

Everything sits in one versioned `localStorage` record, written on a short debounce and
flushed when the app is backgrounded. Deleting your browser data for the site, or
"clearing website data" on iOS, deletes your log — so export a backup before you do
anything drastic or change phones.

Log entries store a **snapshot** of the food's nutrition at the moment you logged it.
Editing or deleting a food later never rewrites your history.

## Weight vs unit foods

Each food is measured one of two ways, which is what makes "500 g of mince" and
"2 burgers" both work:

- **By weight** — nutrition is per 100 g (the same basis as a pack label) and you log
  grams. Mince, steak, rice, oats, cheese.
- **By the item** — nutrition is per one thing and you log a count. Burgers, eggs,
  slices of bread, cans, chicken pieces. Where the weight of one item is known, the
  editor shows it, so 2 fillets tells you it's about 330 g.

## About the numbers

Whole foods follow standard composition tables and are reliable.

**Chain menu figures are close estimates.** South African menus differ from the US and
UK ones, chains change recipes without announcing it, and portions vary by store. They
are internally consistent — every item's calories agree with its macros, which `npm test`
enforces across the whole table — but treat them as good approximations, not gospel. If a
number matters to you, check the chain's own figures and edit the food; your value is
then used from that point on.

## Project layout

```
src/
  data/          the food tables (fastfood.ts, grocery.ts) + compact row builders
  lib/           nutrition maths, date handling, plan resolution, storage, search
  state/         the single reducer store, persisted to localStorage
  components/    sheets, the food picker, quantity editor, rings and rows
  screens/       Today, Plan, Foods, Trends, Settings
tests/           food-data integrity plus logic tests, run with node --test
scripts/         dependency-free PNG icon generator
```

Adding foods is deliberately cheap — one row in `src/data/grocery.ts` or
`src/data/fastfood.ts`:

```ts
// per 100 g: [name, kcal, protein, carbs, fat, fibre, sugar, sodium, portions?]
['Beef mince, lean (10% fat), raw', 176, 20, 0, 10, 0, 0, 66, [['500 g pack', 500]]],

// per item: [name, unitName, grams, kcal, protein, carbs, fat, fibre, sugar, sodium]
['Big Mac', 'burger', 219, 493, 26, 41, 25, 3, 8, 907],
```

`npm test` will tell you if a row's calories don't line up with its macros.
