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

**4. Point Jobix at the webhook**

Configure Jobix (webhook/automation, or a small relay script if your plan only exposes
exports) to send each finished call to:

```
POST https://<your-domain>/api/integrations/voice/call-completed
Authorization: Bearer <key from step 2>
```

Debtor matching works on `accountNumber` **or** `phone` — Jobix always knows the number it
dialled, so `phone` alone is enough. The endpoint is idempotent on `externalCallId`
(re-sending a call is safe) and rate limited at 120 req/min per key.

**5. Confirm the loop**

Send one test call (see the payload below or Settings → Voice platform integration) and
check: the call appears under Calls with an AI analysis → a promise appears under Promises
to Pay (if one was made) → the debtor's timeline and campaign metrics update → the
dashboard work queue picks up the follow-up. Record the payment when it lands and the
promise resolves to Fulfilled.

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

The demo seed prints a working API key (`aip_demo_k3y_meridian_voice_2026`). Keys are
stored as SHA-256 hashes; the organization is always derived from the key, never from the
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

## Multi-tenancy & security

- Every entity carries an `organizationId`; every service query is organization-scoped.
  Cross-tenant references (agent on a campaign, debtor on a payment, …) are re-verified
  against the caller's organization before writes.
- `src/lib/auth.ts` is the single auth entry point — currently a demo-session stub built
  to swap to NextAuth/JWT without touching the rest of the app.
- Server-side zod validation on every mutating endpoint; secrets live in environment
  variables only; the Anthropic key and voice API keys never reach the client bundle.
- Always-on audit log (actor, action, entity — no transcripts/PII in details).
- Voice agent prompts are referenced (`promptRef`), never stored or displayed.

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
