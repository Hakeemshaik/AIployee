# AIployee — AI Debt Collection Command Centre

A multi-tenant B2B SaaS platform for debt collection operations powered by AI voice agents.
Debtor books, campaigns, calls, promises to pay, payments, escalations, AI-generated insights
and reports — connected as one end-to-end workflow:

> debtor imported → assigned to campaign → AI voice agent calls → transcript posted to the
> integration API → AI extracts the outcome → promise created → payment tracked → promise
> fulfilled/broken → campaign metrics update → AI analyses performance → report generated →
> management acts on the recommendation.

The platform **does not do telephony**. Your existing AI voice system stays the system of
record for calls and recordings and pushes results in through a clean integration API.

## Stack

- **Next.js 16** (App Router, React Server Components) + TypeScript
- **Tailwind CSS v4** — dark, glass-panel design system
- **Prisma 6 + PostgreSQL** (Neon / Vercel Postgres / any managed PG)
- **Recharts** for dashboards
- **Zod** for all server-side input validation
- **Anthropic SDK (Claude)** behind a provider abstraction, with a deterministic built-in
  fallback engine so everything works with no API key
- Deploys to **Vercel** out of the box (`vercel-build` runs migrations automatically)

## Getting started (local)

You need a PostgreSQL database. Quickest options: a free Neon database, or locally
`docker run -d -p 5432:5432 -e POSTGRES_USER=aiployee -e POSTGRES_PASSWORD=aiployee_dev -e POSTGRES_DB=aiployee postgres:16`.

```bash
npm install
cp .env.example .env   # set DATABASE_URL + DIRECT_DATABASE_URL
npm run db:migrate     # apply migrations
npm run db:seed        # load the realistic demo dataset (fictional SA data, ZAR)
npm run dev
```

Open http://localhost:3000. The seed creates the demo organization **Meridian Recoveries**
with 47 debtors, 5 campaigns, 3 voice agents, ~115 calls with transcripts and analyses,
promises, payments, escalations, reports and insights.

`npm run db:reset` rebuilds the database from scratch. `npm test` runs the unit tests
(transcript extraction rules, promise status derivation, CSV parsing, phone normalization).

Useful entry points once running:

- **⌘K / Ctrl-K** — command palette: search debtors, campaigns and agents, or jump to any page
- **Debtors → Import debtors** — CSV import with per-row validation and campaign assignment
- **Dashboard → Work queue** — promises due/overdue, waiting escalations and requested callbacks
- **Reports → Export PDF** — print-optimised report export

## Launching with Jobix (or any voice platform)

The platform is the system of record and command centre; Jobix stays the dialler. Go-live
checklist:

**1. Deploy to Vercel**

1. Create the database: in Vercel → Storage, add **Neon (Postgres)** (or bring any managed
   PG). Note the two connection strings — **pooled** and **direct/unpooled**.
2. Push this repo to GitHub and **Import Project** in Vercel.
3. Set the environment variables in Vercel → Settings → Environment Variables:
   - `DATABASE_URL` — the **pooled** connection string
   - `DIRECT_DATABASE_URL` — the **direct (non-pooled)** connection string
   - `AI_PROVIDER=claude` + `ANTHROPIC_API_KEY` for Claude analysis/reports (optional —
     omit to run the built-in engine)
4. Deploy. The `vercel-build` script runs `prisma generate && prisma migrate deploy &&
   next build`, so the schema is applied automatically on every deploy.
5. Seed or load data from your machine against the production database:
   ```bash
   DATABASE_URL=<direct-url> DIRECT_DATABASE_URL=<direct-url> npm run db:seed   # demo data
   ```
   …or skip the seed and import your real book through the UI (step 3).

Serverless note: the webhook rate limiter is in-memory per instance — fine at Jobix call
volumes; move it to Redis/Upstash if you ever fan out to very high concurrency.

**2. Open `/setup` on your live URL**

Visit `https://<your-app>.vercel.app/setup` in a browser. The one-time setup page creates your
organization and shows your Jobix webhook API key (once — copy it). Choose:

- **Load the demo dataset** — see the whole platform working immediately, or
- **Start clean** — empty platform ready for your real book.

The page locks itself permanently after first use. (CLI alternative:
`npm run key:create -- "Jobix production"` and `npm run db:seed` against the production
database.)

**3. Import your book and set up the campaign**

Debtors → **Import debtors** (CSV per the template — phone numbers are normalized to
`+27…` E.164, the same format your Jobix imports use). Create the matching campaign,
assign the debtors and the agent, and set it **Active**. To link agents to Jobix, set each
agent's `externalId` to the Jobix agent id (`npx prisma studio` → AIAgent) and pass it as
`externalAgentId` on the webhook.

**4. Build the dialling list for Jobix**

Open the campaign → **Build Jobix list**. It produces the 72-column import table Jobix
expects, already cleaned (E.164 phone numbers, whole-rand amounts) and filtered to
callable accounts only — opt-outs, do-not-contact flags, settled balances, open disputes
and live escalations are held back and reported. **Copy for Jobix**, then paste into the
Jobix dashboard → Database → paste box. (Or **Download CSV**, or call
`GET /api/jobix-export?campaignId=…` from a script.)

**5. Point Jobix at the webhook**

Configure Jobix (webhook/automation, or a small relay script if your plan only exposes
exports) to send each finished call to:

```
POST https://<your-domain>/api/integrations/voice/call-completed
Authorization: Bearer <key from step 2>
```

Debtor matching works on `accountNumber` **or** `phone` — Jobix always knows the number it
dialled, so `phone` alone is enough. The endpoint is idempotent on `externalCallId`
(re-sending a call is safe) and rate limited at 120 req/min per key.

**6. Confirm the loop**

Send one test call (see the payload below or Settings → Voice platform integration) and
check: the call appears under Calls with an AI analysis → a promise appears under Promises
to Pay (if one was made) → the debtor's timeline and campaign metrics update → the
dashboard work queue picks up the follow-up. Record the payment when it lands and the
promise resolves to Fulfilled.

## Call analytics (transcript-verified)

`/analytics` classifies every account by whether a **real human conversation** happened, and
is the screen an operator opens to see who was missed. Guest mode (`/login` → Continue as
guest) runs the same engine over a 120-account fixture with calling disabled.

### Rules that are easy to get wrong

These were established against live production data; the naive version produces confidently
wrong numbers, so each is pinned by tests in `src/services/analytics/classify.test.ts`.

- **Reached is decided from transcript content, never platform flags.** The provider's
  voicemail flag misfires badly (164 false positives in one campaign). An account is reached
  only if a transcript has a genuine tenant turn; a short machine-sounding utterance
  (under 15 words matching the machine phrase list) is not a person.
- **Five mutually exclusive buckets that sum to the account total** (asserted by test):
  conversation (reached, ≥8 tenant words) · answered, few words (reached, <8) · connected,
  no conversation (not reached but talk time > 0) · never connected/dead (not reached, every
  call zero duration) · never called.
- **Every metric is per account, never per call.** Formulas are shown in each tile's
  tooltip: penetration = attempted ÷ book · RPC rate = conversations ÷ book · dials per RPC
  = calls ÷ conversations · **PTP rate = promises ÷ conversations (RPC denominator)** ·
  data-quality fail = dead numbers ÷ dialled.
- **Cash committed is a range, never one number.** Commitments with no stated amount carry
  zero in the floor and their full balance in the ceiling. "Arrears under commitment" is
  shown separately — conflating it with cash committed overstates pipeline roughly 3×.
- **Cumulative reach counts unique accounts at first reach.** Summing per-round reached
  columns double-counts and has already produced a wrong published figure.
- **Hour-of-day is SAST (UTC+2).** Provider timestamps are UTC. Reach rate by hour varies
  enormously and is the most actionable thing on the page.
- **Dead numbers get a repair export, not a call button** — they need new phone numbers,
  not more attempts.

### Account drawer

Clicking an account name (in either table) opens its full history, so every number on the
page can be traced to the evidence behind it:

- **Each call carries its own reach verdict and the reasoning** — "Tenant spoke 22 words —
  a real conversation", "Tenant audio matched a machine greeting (“Please leave”) in only 7
  words", "No talk time and no transcript — the call never connected". A test asserts these
  verdicts never disagree with the engine that drives the metrics.
- **Attempts are numbered by time**, so "attempt 3" is the third call actually made, not the
  third row the provider returned.
- **The provider's voicemail flag is shown beside the verdict, never used to produce it.**
  Seeing the two disagree is the point; the fixture deliberately contains disagreements in
  both directions and a test requires them.
- **Transcripts render inline**, tenant turns visually distinct from the agent's, with the
  call that decided the outcome expanded by default.
- **Messaging steps (WhatsApp/SMS) come from flow node history.** Those rows carry only
  `customer_name` — no phone, no account id — so the match is by normalised name and the
  drawer says so. Where two accounts share a name the events are still shown but flagged
  `ambiguous`, never presented as belonging to one account.

### Ingestion

`POST /api/ingest` (progress on `GET`). Conversations page cheaply; transcripts are one
request each, so they are fetched at concurrency 12, checkpointed every 25, cached in
`JobixTranscript` by conversation uuid and **never re-fetched**. Customers are stale-filtered
on `_modify_time` and deduped by phone (skipping this produced 5,608 "records" for 660
phones). Pulled customers are then **persisted**: debtors are matched by phone — the only
key Jobix reliably puts on a customer — or created with a `JBX-` account number and their
balance; a confirmed PTP becomes a real PromiseToPay row (unstated amounts stay 0 so the
floor/ceiling range stays honest, and a date the provider never stated is marked
`dateStated:false` rather than passed off as debtor-chosen). The provider can escalate a
debtor's state but never quietly walk it back: do-not-contact is set, never unset, and
human-owned statuses (legal, hardship, opted-out) are not overwritten by a flag sync.
A fourth phase pulls flow **node history** (WhatsApp/SMS sends and filter branches)
when `JOBIX_FLOW_UUID` is set; without a flow there is no endpoint to ask, so the phase is
skipped and reports zero rather than inventing state. Jobix issues no event id for these, so
identity is the event's content and a repeat is ignored as the same event seen again.

Ingestion is **blocked by a workspace assertion**: if the expected agent names are absent the
run aborts with a clear error rather than importing another workspace's data.

The control lives at the top of `/analytics`: phase stepper, live counters (new vs cached vs
failed transcripts, customers, messaging events), and the last run's outcome. It polls `GET
/api/ingest` while a run is in flight. Runs are resumable — cached transcripts are never
re-fetched — so pressing Run after an interrupted run continues rather than restarts, and the
panel says so. Configuration failures are reported as configuration, not bugs: **501** when
Jobix credentials are absent from the server, **403** in demo mode, **409** on a workspace
mismatch. Only the *presence* of credentials is sent to the browser, never a value.

### Jobix API traps, encoded as guards

`src/services/jobix/client.ts` + `api.ts` enforce these rather than documenting them:

| Trap | Guard |
|---|---|
| `page_size=100` on `/api/conversations` → HTTP 500 | capped at 50 |
| pages are 1-indexed | pulls start at page 1 |
| sort order is not reliably newest-first | always sorted client-side by `created_at`; a page-boundary stop needs the *whole* page older than the floor |
| unknown filters accepted and silently ignored | allow-list (`phone`, `agents`) + post-hoc row assertion that throws if the API ignored it |
| `/transcription` needs `call_uuid` (same uuid) or 422 | always sent |
| turn text is in `content` *or* `text` | both handled |
| empty customer fields render as `"No data available"`; unset units as `{{ attributes.unit_number }}` | unwrapped to `null` (any unresolved placeholder too) |
| customer records hold the last outcome from *any* campaign | `_modify_time` staleness filter + dedupe by phone |
| `node_ids=` filter is broken | node history pulled unfiltered and filtered in code |
| node `status` 13 = success, 98 = failed; socket `_0` = matched | typed as `succeeded` / `failed` / `matchedFilter` |
| `customer/save` is asynchronous | dispatch waits, then verifies before triggering |
| endpoints time out under sustained paging | retry with backoff + checkpointing |

### Calling — guarded, and the one genuine gap

Calling is last in the build order and off by default (`JOBIX_CALLING_ENABLED=false`).
Both "call one" and "call all" take one path: filter → stamp a unique batch code via
`customer/save` → wait and verify → trigger the flow with `call Equals <batchCode>`.

Guardrails, all enforced server-side (a guest session is refused regardless of the UI):
confirmation of exact account count and value; a hard SAST calling-hours gate
(Mon–Fri 08:00–19:00, Sat 09:00–13:00, never Sunday — tested); exclusion of do-not-call,
disputed, escalated, settled, opted-out and live-PTP accounts with the excluded count
reported; an env deny-list for internal test numbers; and an audit entry for every dispatch
(who, when, which accounts, which batch code).

**The trigger endpoint is not implemented against a guessed path.** Capture it first:
open the flow builder → the `Now` node → **Run**, with DevTools → Network recording, and note
the method, URL and payload (also capture a node filter save). Set `JOBIX_TRIGGER_PATH` to
that path. Until then a dispatch stamps the batch, verifies it, and reports the exact next
action rather than pretending a run started.

## Live Jobix integration (campaign execution)

The platform is the control centre; the voice platform executes the calls. The integration
lives entirely in `src/services/voice/` behind one interface, so no page or service knows
which provider is in use:

```
src/services/voice/
  types.ts          VoiceCampaignProvider interface + typed ProviderError
  index.ts          factory: per-org IntegrationSettings -> JOBIX_* env -> manual
  manual.ts         paste workflow (honest: refuses start/pause/stop)
  jobix/client.ts   server-only HTTP client, redacting, timeouts
  jobix/index.ts    JobixProvider — capability-gated, config-driven endpoints
  jobix/mapping.ts  provider status/result -> canonical internal outcome
```

Credentials are server-side only:

```env
JOBIX_BASE_URL=https://dashboard.jobix.ai/api
JOBIX_API_KEY=
JOBIX_WEBHOOK_SECRET=
```

### The loop

```
AIployee  ──START──▶ provider.createCampaign + addContacts + startCampaign
                              │
                        voice AI calls
                              │
AIployee ◀── POST /api/webhooks/jobix ── call/campaign events
                              │
        call ▸ AI analysis ▸ promise ▸ escalation ▸ campaign metrics
                              │
                    live campaign dashboard (SSE)
```

- **Start / pause / stop** — `POST /api/campaigns/:id/control`. A campaign is never reported
  as running unless the provider accepted it; a rejection stores the real error and leaves
  the campaign `failed`. Starting twice cannot create two provider campaigns (idempotency
  key derived from the campaign and its contact set).
- **Webhook** — `POST /api/webhooks/jobix`, authenticated by HMAC signature
  (`JOBIX_WEBHOOK_SECRET`, constant-time) or a `voice:ingest` API key. Every event is stored
  in `ProviderEvent` first; the unique provider event id makes redelivery a no-op, so a
  repeated event never creates a second call, promise or escalation. Unknown event types are
  recorded and ignored rather than erroring.
- **Live dashboard** — `GET /api/campaigns/:id/live` streams state over SSE (or
  `?snapshot=1` for JSON). The page updates in place: KPIs, activity feed, outcome
  breakdown, redial counts. No polling loops, no full-page refresh.
- **Redial** — `POST /api/campaigns/:id/redial` with `filter` =
  `no_answer | busy | failed | callback_due` (add `preview: true` for a count first). One
  reusable `createRedialBatch()` powers every button. **Only the filtered contacts are
  sent** — 147 no-answers means 147 contacts, never the whole campaign; that guarantee is
  pinned by tests in `src/services/redial.test.ts`. Contacts at the attempt limit, settled
  accounts, disputes, escalations and opt-outs are excluded, and each exclusion is counted
  for the operator.
- **Outcome mapping** — provider results map onto the platform's own outcome vocabulary
  (`jobix/mapping.ts`, overridable per organization via `IntegrationSettings.outcomeMap`).
  An unrecognised result returns `null` and falls through to AI transcript analysis instead
  of being guessed.

### What Jobix must expose — and what is still unknown

Endpoint paths are **configuration, not code** (`IntegrationSettings.endpoints`), because
inventing a path produces a silent failure at the worst moment. A capability is offered only
when its path is configured; otherwise the operator gets a precise "not exposed" error.

| Capability | Config key | Status |
|---|---|---|
| List agents/flows | `listAgents` | Path `/agents` observed in production use (paged `page`, `page_size`) |
| List calls/conversations | `listCalls` | Path `/conversations` observed in production use (fields `uuid`, `phone_number`, `duration`, `created_at`, `agent`, `contact`) |
| Fetch one call | `getCall` | Unconfirmed |
| Create campaign | `createCampaign` | **Unconfirmed — needs Jobix API docs** |
| Upload contacts | `addContacts` | **Unconfirmed — needs Jobix API docs** |
| Start / pause / stop | `startCampaign`, `pauseCampaign`, `stopCampaign` | **Unconfirmed — needs Jobix API docs** |
| Webhook signing + event names | — | **Unconfirmed — needs Jobix webhook docs** |

Until the write endpoints are confirmed, the platform runs the **manual provider**: it builds
the dialling list (Build Jobix list), you paste it into the Jobix Database import and start
the run there, and results flow back automatically through the webhook. Nothing is faked —
`startCampaign` on the manual provider reports the operator step instead of claiming the
campaign started.

To switch to full API control, set the `JOBIX_*` environment variables and record the
confirmed paths in `IntegrationSettings.endpoints`, e.g.

```json
{ "listAgents": "/agents", "listCalls": "/conversations",
  "createCampaign": "/campaigns", "addContacts": "/campaigns/contacts",
  "startCampaign": "/campaigns/start", "pauseCampaign": "/campaigns/pause",
  "stopCampaign": "/campaigns/stop" }
```

## AI provider architecture

All AI work goes through `src/services/ai` — an `AIProvider` interface with three methods:

| Method | Used for |
|---|---|
| `analyzeCallTranscript(input)` | Structured extraction from call transcripts (outcome, promised amount/date, payment plan, reason for non-payment, sentiment, escalation flags, next action) |
| `generateCollectionInsights(snapshot)` | The AI Insights page and the dashboard's "AI Collection Intelligence" block |
| `generateReportNarrative(type, snapshot)` | Executive summaries, insights and recommendations inside reports |

Two implementations ship:

- **`mock`** (default) — deterministic and rule-based; computes its findings from the real
  aggregated data, so insights stay truthful without any external dependency.
- **`claude`** — calls the Anthropic API server-side. Enable with:

```bash
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5   # optional override
```

Only aggregated, anonymised data (`CollectionSnapshot`) is sent for insight generation —
no names, phone numbers or account numbers. Claude failures degrade gracefully to the
built-in engine. Providers are swappable without touching application code.

## Voice platform integration

Inbound webhook, authenticated with a per-organization API key (scope `voice:ingest`):

```
POST /api/integrations/voice/call-completed
Authorization: Bearer <api key>
```

```json
{
  "externalCallId": "call_123",
  "accountNumber": "EDG-4127",
  "externalAgentId": "agent_naledi_01",
  "campaignId": "optional — defaults to the debtor's campaign",
  "startedAt": "2026-08-24T10:15:00Z",
  "endedAt": "2026-08-24T10:19:05Z",
  "durationSeconds": 245,
  "status": "completed",
  "transcript": "...",
  "recordingUrl": "https://voice.example/rec/call_123.mp3",
  "outcome": "promise_to_pay"
}
```

The debtor may be referenced by `debtorId`, `accountNumber` or `phone`. One request drives
the full pipeline: validate → store call (idempotent on `externalCallId`) → AI transcript
analysis → promise/escalation creation → debtor state + risk update → events + audit log.
The response returns the extraction result (`outcome`, `promiseId`, `escalationId`,
`nextAction`).

The demo seed prints a freshly generated API key once — no key value is committed to this
repository, because a literal one would be a working credential on every deployment seeded
from it. Keys are stored as SHA-256 hashes; the organization is always derived from the key, never from the
payload. The endpoint is rate limited per key (120 requests/minute, in-memory — swap for
Redis when running multiple instances).

## Event architecture

Every domain action emits a persisted, replayable `PlatformEvent` and fans out to
in-process subscribers (`src/lib/events.ts`):

`call.completed` · `call.analysed` · `promise.created` · `promise.fulfilled` ·
`promise.broken` · `payment.received` · `debtor.escalated` · `campaign.started` ·
`campaign.completed`

Attach an outbound webhook dispatcher or queue consumer to this stream to integrate
payment providers, CRMs or data warehouses without touching core logic.

## Architecture

```
src/
  app/                  # routes (RSC pages + API route handlers only — no business logic)
    api/integrations/voice/call-completed
    api/{reports,insights,payments,campaigns,escalations,promises,settings}
  services/             # business logic, organization-scoped
    ai/                 # provider abstraction: types, mock, claude, factory
    integrations/voice  # inbound call pipeline
    debtors | campaigns | calls | promises | payments
    escalations | agents | reports | insights | dashboard | settings
  lib/                  # db client, auth context, events, audit, api-key auth,
                        # domain enums/labels, formatting (ZAR)
  components/           # shell, ui primitives, charts, client actions
prisma/schema.prisma    # multi-tenant relational model
prisma/seed.ts          # realistic fictional demo data (clearly mock)
```

### Currency and time are formatted deterministically

`src/lib/format.ts` does not delegate ZAR or date formatting to `Intl`. Fixing the locale is
not enough: Node's ICU groups `en-ZA` thousands with a no-break space and uses a comma for
cents, Chromium groups with a comma and uses a full stop, so server and client HTML disagreed
and React discarded the server-rendered tree on load. Times were worse — the server runs in
UTC, so a 20:30 SAST call rendered as 18:30 until the browser took over. Money is now grouped
here, and dates are pinned to `Africa/Johannesburg` and assembled from numeric parts. Both
are pinned by tests in `src/lib/format.test.ts`, including the SAST-midnight rollover.

## Multi-tenancy & security

- Every entity carries an `organizationId`; every service query is organization-scoped.
  Cross-tenant references (agent on a campaign, debtor on a payment, …) are re-verified
  against the caller's organization before writes.
- `src/lib/auth.ts` is the single auth entry point: every `organizationId` in the
  application originates there, so tenancy has one place it can be got wrong. Pages call
  `getContext()`, which redirects; API routes call `apiContext()`, which throws so a caller
  gets 401 or 403 instead of a 500 naming Next's internal redirect error.
- Server-side zod validation on every mutating endpoint; secrets live in environment
  variables only; the Anthropic key and voice API keys never reach the client bundle.
- Always-on audit log (actor, action, entity — no transcripts/PII in details).
- Voice agent prompts are referenced (`promptRef`), never stored or displayed.

### Sessions and sign-in

One signed httpOnly cookie carries either a demo session or a real user session. It is
`base64url(payload).hmac-sha256`, so the holder can read their own user id and expiry but
cannot alter either — a demo visitor cannot rewrite the payload to claim an account, and
nobody can extend their own expiry. Verification is constant-time and fails closed: if the
signing key cannot be read, nobody is signed in.

- **Signing key** — `AUTH_SECRET` when set. When it is not, a key is generated once and
  stored in `ServerSecret`, because the alternatives are a constant key (forgeable by anyone
  reading the source) or refusing to start (locking the owner out of their own deployment).
- **Passwords** — scrypt from `node:crypto` (N=16384, r=8, p=1, 16-byte salt), parameters
  stored in the hash so they can be raised later without invalidating existing passwords.
  Minimum 12 characters.
- **Sign-in failures are uniform.** A wrong password, an unknown email and a user with no
  password set all return the same message, and an unknown email is still compared against a
  real hash so the timing does not reveal which accounts exist. Attempts are rate limited per
  account and per caller.
- **The sign-in page discloses nothing.** It is reachable without a session, so it names no
  user, no organization, and carries no pre-filled value or placeholder text. An earlier
  version suggested the existing admin's address, which printed a real account email on a
  public page — pinned shut by tests now.
- **First-run claim.** A database seeded outside `/setup` has users but no passwords. Rather
  than leave it unreachable, `/login` offers to set the first password — and that window
  closes permanently the moment any password exists. `/setup` now requires a password up
  front, so a new deployment never opens the window at all. Use **your own** email: a seeded
  database contains only fictional demo staff, so an unrecognised address creates a real
  admin account rather than being refused.
- **Locked out?** There is no password-reset email, so recovery is a shell command:
  `npm run password:set -- --list` shows who exists and who can sign in;
  `npm run password:set -- you@company.co.za 'a new password'` sets one (creating an admin if
  that address is new). It calls the application's own hashing code, so the stored format
  cannot drift from what sign-in expects.
- **Demo sessions see fixtures only.** `getContext()` refuses a guest session outright, so
  every page and endpoint that resolves a real organization is closed to them, and guest
  navigation is limited to the one screen that runs on fixtures.

Sign out is server-side — the cookie is httpOnly, so it can only be cleared by the server.
The control sits in the top bar in both modes ("Sign out" / "Leave demo").

## Moving from the demo book to a real one

`/setup` can seed a complete fictional organization so the platform can be seen working. When
it is time for real data, **Settings → Clear demo data** (admin only) removes it:

- **Deleted** — debtors, debt accounts, campaigns, campaign contacts, redial batches, voice
  agents, calls, call analyses, promises, payments, escalations, reports, insights, platform
  events, provider events, the audit history of demo activity, every API key, and every user
  account other than your own.
- **Kept** — your sign-in, compliance settings, integration settings, and anything ingested
  from the voice provider (the seed never creates that, so it is real by definition). A
  checkbox removes the ingested data too, for a from-scratch re-ingest.
- **Guarded** — a preview lists exact row counts on both sides before anything runs, and the
  organization's name must be typed character for character. The confirmation is re-checked
  server-side. The acting admin is never deleted: wiping the users table would lock the
  operator out of the deployment they just cleaned.
- Deletion is explicit and child-first rather than relying on cascade order, so a schema
  change cannot silently start orphaning rows.

Afterwards the organization can be renamed in the same step, one placeholder voice agent is
left behind so campaigns have something to point at, and the reset becomes the first entry in
the audit log of the real book. Import the book at **Debtors → Import** and issue a fresh
webhook key in Settings — clearing revokes the old ones, so anything posting to the webhook
stops until you do.

The same thing from a shell, dry-run by default:

```bash
npm run data:clear-demo                     # prints what would go, deletes nothing
npm run data:clear-demo -- --confirm 'Meridian Recoveries' --rename 'Your Company'
```

Its invariants are covered by integration tests against a real database. They truncate what
they run against, so they are opt-in and refuse any `DATABASE_URL` that is not obviously
disposable:

```bash
DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
```

## Compliance guardrails

Debt collection is regulated and rules differ by jurisdiction, so the platform ships
**configurable guardrails instead of hard-coded legal assumptions** (Settings →
Compliance): calling hours/days, attempt caps, retry interval, recording consent and
disclosure wording, dispute/hardship/vulnerability escalation, contact freeze on dispute,
opt-out handling and the maximum arrangement value the AI may agree without a human.

## Mock data

All seeded content is fictional South African-style data in ZAR, generated by
`prisma/seed.ts` and clearly separated from production ingestion paths (the voice API and
the UI). Reset any time with `npm run db:reset`.
