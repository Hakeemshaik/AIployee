# Linkup: project guide for Claude Code

Linkup is a private messenger for a small friend group that plans for you. It's an installable PWA (no app store).
Friends chat, see who's free, and video call. An AI called **Planner** turns chats into booked plans with reminders.
Planner runs on the owner's local Ollama model.

## Hard rules
- Never put any employer or company name anywhere: code, copy, comments, metadata, README, commits.
- No emojis in UI copy. Icons are inline SVG in `web/src/components/ui.jsx` (`<Icon name=… />`): 24x24, stroke 1.8, round caps.
- Don't copy another app's branding (logo, signature colour, wallpaper). The layout is a familiar messenger layout, but the look is our own violet.
- All numbers and times are computed in code. The AI only suggests and never invents data. The server validates every AI plan (`normalizePlan` in `server/src/ai.js`).
- Keep it simple. Every screen should be obvious on first open. Prefer removing a control over adding one.

## Stack and layout
- `server/` is Node 22, Express, Socket.io and better-sqlite3 (one file DB in `server/data/`), plus web-push (VAPID).
  - `api.js` has every REST route: auth, invite links, friends, availability, events, conversations and messages, plan confirm, invites and calls, notifications, `/ai/*`.
  - `index.js` handles sockets: presence, typing, read receipts and WebRTC call signalling (mesh, max 6).
  - `ai.js` builds the context (calendar, schedules, chat), calls an OpenAI-compatible endpoint (Ollama), then runs `normalizePlan` and `findFreeSlot`.
  - `notify.js` is the one call that stores a notification, emits it live, and sends Web Push with the full content (skipped when the app is on screen).
  - `scheduler.js` sends event reminders (checks every 30s).
- `web/` is React, Vite and react-router, with plain CSS in `web/src/styles.css` (tokens at the top, light and dark via `prefers-color-scheme`).
  - Tabs: Chats (`/`), Calendar, Calls. Settings opens from the avatar on Chats and holds status, friends, plans, notifications and sign out.
  - Planner is a pinned chat (`conversations.is_ai = 1`). `openPlanner(draft)` in `lib/store.jsx` opens it with text ready to send.
  - `public/sw.js` is the service worker: it shows the push content, handles action buttons, and caches the offline shell.
- Auth uses JWTs stored in localStorage. Invite links are `/join/<signed token>`. Signing up or in from one makes both people friends and opens a DM. It also bypasses `REGISTRATION_CODE`.

## Commands
- `npm run setup` installs everything and builds the web app.
- `npm start` serves the API and the built PWA on :8080.
- Dev: run `npm run dev:server` and `npm run dev:web` together (Vite on :5173 proxies `/api` and sockets).
- End-to-end check (needs a fresh DB):
  1. Start the server: `DATA_DIR=/tmp/linkup-test REGISTRATION_CODE=test npm start`
  2. Run the test: `REGISTRATION_CODE=test npm run test:e2e`
  3. What it covers: two people sign up (one through the other's invite link), chat live, see typing and read ticks, and sign out and back in.
- To test Planner without Ollama, point `LLM_BASE_URL` at any OpenAI-compatible mock that returns `{"reply": "...", "plan": {...}}` JSON.

## Conventions
- Components are small and live in `web/src/pages/*` and `web/src/components/*`. Reuse `Header`, `Sheet`, `Avatar`, `Orb`, `Icon`, `.group-list` and `.row-item`.
- Motion lives in the "Motion" block at the bottom of `styles.css`. Use `--spring` and `--ease-out`. Every animation must also work under `prefers-reduced-motion`.
- Realtime: the server calls `emitToUsers(ids, event, payload)`, and clients subscribe with `useSocket(event, fn)`.
- Any new user-facing event should go through `notify()` so it gets an in-app toast, an Alerts entry and a push.
- Before you say something works, run the e2e test and take screenshots at 390x844 in light and dark.
