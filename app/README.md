# Collections Console

Upload a collections spreadsheet in whatever shape the client sent it, check the
data before anything dials, send it to the voice agent in batches, resync who
actually picked up, and build the redial round from live outcomes.

Runs locally. Nothing leaves your machine except the dispatch calls to your own
platform and the read-only calls to the voice-agent dashboard.

```bash
npm install
npm start          # http://localhost:4310
```

## The loop

1. **Drop a spreadsheet.** Any layout. A real header row is matched by name;
   otherwise the eight known age-analysis shapes are detected by column count.
   Every sheet in the workbook is scored and the one with the most usable rows
   wins, so a cover tab or a totals tab does not derail it.
2. **Check the review screen.** Callable tenants, book value, numbers that will
   never work, duplicates merged, tenants holding several units. Nothing dials
   until you press the button.
3. **Create batches.** Default 150 per batch, highest balance first. Each batch
   gets its own code — `08SEP-B1`, `08SEP-B2` — written to the agent's `call`
   field so a campaign stays filterable afterwards.
4. **Run batch 1.** Records are submitted one per call, with live progress and a
   stop button. Batch 2 stays locked until batch 1's run finishes.
5. **Resync.** Reads call attempts and transcripts from the dashboard, decides
   who was actually reached, and flags the tenants that were sent to the
   platform but never dialled.
6. **Create the redial round.** Built as an exclusion list, so every skipped
   tenant is accounted for. Preview it before it exists.

## Settings

**Dispatch** — base URL, form id, API key, submit path. Press *Test dispatch
connection* first; it fetches the public form definition and lists the field
keys it found. If a run fails with 404, the submit path is what to correct.

**Resync** — dashboard base URL plus an `access_token` copied from a logged-in
tab (DevTools → Application → Cookies). Set the expected workspace email too:
a resync refuses to run when the token belongs to a different workspace, because
querying the wrong one returns numbers that look completely plausible.

Secrets live in `data/settings.json` and are never sent to the browser — the API
returns only whether each one is set.

## What the numbers mean

- **Reached** — the tenant spoke on at least one attempt. Derived from the
  transcript, never from the platform's outcome or voicemail fields, both of
  which have been wrong in every campaign measured. An answering-machine
  greeting does not count as the tenant speaking.
- **Contact rate** — reached as a share of tenants dispatched, not of calls
  placed.
- **Dead numbers** — every attempt connected for zero seconds. These tenants
  are not ignoring the calls; the number does not work. They are excluded from
  redials and reported separately with their balance, because they are a
  data-cleaning job for the client.
- **Cumulative unique** in attempt decay counts each tenant once, at the attempt
  where they were first reached. Summing the per-round reached column
  double-counts anyone reached twice.
- **Never dialled** — sent to the platform, no attempt came back. A batch of 79
  once vanished this way with no error anywhere.

## Layout

```
server/
  index.js            HTTP API and the background job runner
  lib/formats.js      format detection, name/phone/balance cleaning
  lib/parse.js        workbook -> tenants + quality report
  lib/reach.js        who was reached, attempt decay, redial rules
  lib/jobix.js        read-only dashboard client
  lib/speedtolead.js  batch dispatch
  lib/xlsxout.js      72-column import and review workbooks
  lib/store.js        JSON persistence
public/               single-page front end, no build step
data/                 campaigns and settings (git-ignored)
```

## Notes

- `data/` is git-ignored. Campaigns are plain JSON, one file per campaign, so
  they can be inspected, diffed and backed up directly.
- Batch membership is frozen when the batch is created, so a completed batch's
  history does not change when one of its tenants moves into a redial round.
- The 72-column `.xlsx` export is always available per batch, for the manual
  upload path or for handing a round to someone else.
