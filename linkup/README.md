# Linkup

A private messenger for you and your friends that plans for you. It installs from a link (no app store) and follows your phone's light or dark mode.

**Tabs**
- **Chats**: DMs and groups with read ticks, typing and online / last seen. **Planner** is pinned at the top. Search and filter by All, Unread or Groups.
- **Calendar**: month view with your plans. Tap a day to see who's free, mark yourself busy or at work, or ask Planner to plan that day.
- **Calls**: quick-call your friends, see call history, missed calls in red, tap to call back.
- Your avatar (top left of Chats) opens **Settings**: your status (Available, Busy, At work, Away, Invisible, plus a short line), friends, all plans, notifications, sign out.

**Getting your friends in**
- Sign up (you need the `REGISTRATION_CODE` from `.env`). In Chats, tap **Share invite link**, or go to Settings, Friends, **Invite link**.
- Your friend opens the link, creates an account (no code needed) and lands straight in a chat with you. You're friends automatically.

**Planning inside chats**
- In any group, tap the orb in the message bar (or **+**, then **Plan it**). Planner reads the chat and posts a plan card. Anyone can tap **Book it**.
- In the **Planner** chat, just say "gym with Sipho friday after work". It picks a time you're both free and sets a reminder (15 min before calls, 30 before meetings, 1 hour before hangouts, 1 day before trips).
- Type **@ai** in any chat to ask Planner something there.
- **+** in a chat also has New plan, Video call and Chill invite.

Stack: Node 22 + Express + Socket.io + SQLite (one file) on the backend. React + Vite PWA with a service worker for Web Push. Web Push uses VAPID, so it needs no Firebase or Apple developer account.

---

## 1. Run it on your PC (Windows)

Install **Node.js 22 LTS** first, then:

```powershell
cd linkup
copy .env.example .env      # then open .env and set REGISTRATION_CODE + LLM_MODEL
npm run setup               # installs everything and builds the app
npm start                   # http://localhost:8080
```

Or use Docker: `docker compose up -d --build`.

### Ollama

```powershell
ollama pull qwen2.5:7b      # good at JSON and dates. On a 16GB PC, llama3.2:3b is the fast fallback
```

- **Running with `npm start`**: nothing else to set. The default `LLM_BASE_URL=http://localhost:11434/v1` works.
- **Running with Docker**: Ollama must listen on all interfaces. Set the Windows env var `OLLAMA_HOST=0.0.0.0`, then restart Ollama. Compose already points the app at `host.docker.internal:11434`.

Check it's working: the bottom of **Settings, Notifications** shows `Planner: <model>, online`.

On a CPU-only box, expect the planner to take 10–40s per reply. The chat shows a typing bubble while it thinks. `LLM_TIMEOUT_MS` defaults to 3 minutes.

## 2. Put it on HTTPS (required)

Phones only allow installing the app, push notifications and camera access over **HTTPS**. Pick one option:

**Option A: Tailscale Funnel.** Free, stable URL, no domain needed.
```powershell
tailscale funnel --bg 8080
# -> https://<your-pc>.<tailnet>.ts.net  (share this link with friends)
```

**Option B: Cloudflare Tunnel.** Needs a domain on Cloudflare.
```powershell
cloudflared tunnel login
cloudflared tunnel create linkup
cloudflared tunnel route dns linkup linkup.yourdomain.com
cloudflared tunnel run --url http://localhost:8080 linkup
```

Avoid quick tunnels (`trycloudflare.com`). Their URL changes on every restart, which breaks everyone's installed app and push subscriptions.

The PC has to stay on for the app to work. If you'd rather host it on a VPS, run it there and point `LLM_BASE_URL` at your PC over Tailscale (e.g. `http://your-pc:11434/v1`).

## 3. Install on phones

**iPhone (iOS 16.4+)**: open the link in **Safari**, tap Share, then **Add to Home Screen**. Open Linkup from the home screen, sign up, then go to **Settings, Notifications** and tap **Turn on**. On iPhone, push only works from the home-screen app, not from a Safari tab.

**Android**: open the link in **Chrome**, tap **Install app** (or ⋮, then Add to Home screen). Then go to **Settings, Notifications** and tap **Turn on**.

Tap **Send test** there to confirm, then lock the phone and check the notification shows up.

Easiest: share your invite link (Chats, Share invite link). Friends who open it sign up without a code and are connected to you straight away. People can also sign up with the `REGISTRATION_CODE` from `.env` and add each other by username in **Settings, Friends**.

## 4. Video calls on mobile data

Calls connect peer-to-peer. That works on most Wi-Fi, but some mobile networks block direct connections, and then the call gets stuck on "connecting". To fix that, add a TURN relay in `.env` (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`). You can use a hosted TURN service, or self-host `coturn` on a VPS with UDP 3478 open.

---

## Project layout

```
server/src/
  index.js      HTTP + Socket.io (presence, typing, WebRTC signaling), serves the built PWA
  api.js        REST API: auth, friends, availability, events, chat, invites, notifications
  ai.js         Planner: builds context (calendar, schedules, chat) -> local LLM -> plan JSON
  notify.js     one call = stored alert + live socket event + Web Push with full content
  push.js       VAPID / web-push, drops dead subscriptions
  scheduler.js  event reminders (checks every 30s)
  realtime.js   who's online, who has the app on screen
  db.js         SQLite schema
web/
  public/sw.js  service worker: shows push content, action buttons, offline shell
  src/pages/    Chats, ChatRoom, Calendar, Calls, Settings, Friends, Plans, Event, Alerts, Call, Invite
```

Data lives in `server/data/` (or the `linkup-data` Docker volume): `linkup.db`, `vapid.json` and `jwt_secret`. Back up that folder. If you lose `vapid.json`, everyone has to re-enable notifications.

Test that two people can sign up and chat: start a fresh server (`DATA_DIR=/tmp/linkup-test REGISTRATION_CODE=test npm start`), then run `REGISTRATION_CODE=test npm run test:e2e`.

Dev mode: run `npm run dev:server` and `npm run dev:web` in two terminals. Vite on :5173 proxies `/api` and sockets to :8080.
