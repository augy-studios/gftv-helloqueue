# HelloQueue

**GFTV HelloQueue** is a virtual queue management system built for furry conventions. Attendees join a queue via Telegram or the web, wander freely, and get notified when it's their turn. Operators manage everything from a single dashboard. Entry is confirmed by scanning a one-time animated QR code at the door.

**Live URL:** `https://queue.gftv.asia`
**Telegram Bot:** `@GFTVHelloQueueBot`

---

## Stack

| Layer | Tech |
|---|---|
| Hosting | Vercel (Pro) - serverless functions + static files |
| Database | Supabase (PostgreSQL) |
| Bot | Node.js - runs on Debian 13 VPS via tmux |
| Frontend | Vanilla HTML/CSS/JS - PWA, no framework |
| Notifications | Telegram Bot API |
| Font | Jua (Google Fonts) |
| Themes | Light, HelloTheme (`#fedc00`) |

---

## File Structure

```
helloqueue/
├── .env.example                        # Environment variable reference
├── package.json                        # Vercel project dependencies
├── vercel.json                         # Routing + CORS headers
├── schema.sql                          # Supabase DB schema (run this first)
│
├── api/                                # Vercel serverless functions
│   ├── _auth.js                        # requireAuth(), requireQueueAccess(), readBearerToken(), handleCors(), randomCode()
│   ├── _supabase.js                    # Shared Supabase client (service key)
│   ├── _telegram.js                    # sendTelegramMessage() HTTP helper
│   │
│   ├── auth/
│   │   ├── attendee-login.js           # POST - new attendee sign-in code / GET - poll it: hands out the session token once, later polls get 410
│   │   ├── login.js                    # POST - username + password login
│   │   ├── logout.js                   # POST - delete session token
│   │   ├── me.js                       # GET  - the caller's Telegram link status
│   │   └── register.js                 # POST - create account (pending approval)
│   │
│   ├── admin/
│   │   └── users.js                    # GET/PUT - list, approve, toggle roles (admin only)
│   │
│   ├── user/
│   │   └── telegram-link.js            # GET (generate OTP) / DELETE (unlink Telegram)
│   │
│   ├── events/
│   │   ├── index.js                    # GET list / POST create (admin only)
│   │   ├── [eventId].js                # GET / PUT / DELETE single event
│   │   └── [eventId]/
│   │       └── editors.js              # GET (superadmin or the event's editors) / POST / DELETE (admin only)
│   │
│   ├── queues/
│   │   ├── index.js                    # GET list (?event_id=), GET ?mine=1 (my queues) / POST create (event editor+)
│   │   ├── [queueId].js                # GET (grouped entries, completedCount and the last 5 finished) / PUT / DELETE
│   │   └── [queueId]/
│   │       ├── join.js                 # POST - attendee joins queue
│   │       ├── leave.js                # POST - attendee leaves queue
│   │       ├── operate.js              # POST - call_next, call_batch, mark_missed, mark_complete, mark_entered, rejoin
│   │       ├── scan.js                 # POST - validate one-time QR entry token
│   │       ├── status.js               # GET  - own queue status + QR data URL if serving
│   │       ├── notify-prefs.js         # PUT  - toggle notify_serving / notify_next
│   │       └── permissions.js          # GET / POST / DELETE queue-level operator perms
│   │
│   └── display/
│       └── [eventCode]/
│           └── [queueCode].js          # GET - public polling endpoint (no auth, 5s interval)
│
├── bot/                                # Telegram bot - runs on Debian 13 VPS
│   ├── index.js                        # Full bot: /start /link /unlink /joinqueue /status /leavequeue /notify
│   └── package.json
│
├── index.html                          # Landing page
├── login.html                          # Login (username + password)
├── register.html                       # Register (pending approval flow)
├── dashboard.html                      # Operator dashboard (SPA with sidebar nav)
├── attendee.html                       # Attendee queue page - join, status, animated QR
├── display.html                        # TV display screen - polls every 5s, no auth
├── manifest.json                       # PWA manifest
├── style.css                           # Full stylesheet - Light + HelloTheme, glassmorphism
└── script.js                           # Shared: Icons SVG, theme, toast, auth, api(), topbar
```

---

## Database Tables

All tables use the `gftvqueue_` prefix. The `gftvhello_users` and `gftvhello_sessions` tables from the HelloSuite auth system are assumed to already exist.

| Table | Purpose |
|---|---|
| `gftvqueue_events` | Events with 8-char access codes |
| `gftvqueue_event_editors` | Admin assigns editors to events |
| `gftvqueue_queues` | Queues under events, each with own 8-char code |
| `gftvqueue_queue_permissions` | Per-queue operator + admin permissions |
| `gftvqueue_entries` | Queue entries (waiting / serving / missed / completed) |
| `gftvqueue_entry_tokens` | One-time QR tokens for entry confirmation |
| `gftvqueue_telegram_links` | Maps Telegram chat_id ↔ HelloQueue user |
| `gftvqueue_telegram_otps` | 6-digit OTPs for Telegram account linking (10 min expiry) |

---

## Permission Model

| Role | How assigned | Can do |
|---|---|---|
| **Superadmin** | `is_admin = true` on user | Create events, assign event editors, approve users, everything |
| **Event Editor** | Admin assigns via `gftvqueue_event_editors` | Create queues under their assigned events |
| **Queue Creator** | Auto-granted when creating a queue | Manage that queue, assign/revoke queue operators |
| **Queue Operator** | Queue creator grants via `gftvqueue_queue_permissions` | Call next, scan QR, mark missed/complete |

No viewer role. You either have queue access or you don't.

Who sees what:

- **Queues and their entries:** a superadmin, the event's editors, and that queue's own staff.
- **Events, event pages and editor lists:** a superadmin and the event's editors. Editors' emails
  are never sent.
- **Staff** see only their own queues, and access codes only for their own queues.
- Every response carries only what its page shows, plus the ids its buttons send (rule F2). Write
  endpoints answer `{ ok: true }`. `tests/api/response-keys.test.mjs` pins the keys.

---

## URL Structure

| URL | Page |
|---|---|
| `queue.gftv.asia/` | Landing page |
| `queue.gftv.asia/login` | Login |
| `queue.gftv.asia/register` | Register |
| `queue.gftv.asia/dashboard` | Operator dashboard |
| `queue.gftv.asia/queue/{eventCode}/{queueCode}` | Attendee queue page |
| `queue.gftv.asia/display/{eventCode}/{queueCode}` | TV display screen (public) |

---

## Telegram Bot Commands

| Command | Description |
|---|---|
| `/start` | Show command menu with inline buttons |
| `/link <OTP>` | Link HelloQueue account using 6-digit code from Profile |
| `/unlink` | Unlink Telegram from HelloQueue |
| `/joinqueue` | Browse open queues and join one |
| `/leavequeue` | Leave your current queue |
| `/status` | Check your active queue positions |
| `/notify` | Toggle "it's my turn" and "I'm next" notifications per queue |
| `/help` | List all commands |

---

## Environment Variables

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...          # service_role key (not anon)
TELEGRAM_BOT_TOKEN=7123456789:AAE... # from @BotFather
WEBAPP_URL=https://queue.gftv.asia   # bot only
TELEGRAM_WEBHOOK_SECRET=...          # Vercel only: the same value as setWebhook's secret_token
```

Set the first three and `TELEGRAM_WEBHOOK_SECRET` in the Vercel dashboard. The first four (not the
secret) go in the VPS bot's environment. While `TELEGRAM_WEBHOOK_SECRET` is unset, the webhook
rejects every request.

---

## Running the tests

Needs Node 22.15 or later. Nothing reaches Supabase or Telegram, and no `.env` is read.

```bash
npm install
npm test            # each API handler against an in-memory fake Supabase (tests/support/fixtures.cjs)
npm run test:e2e    # Playwright: the pages served with vercel.json's rewrites, each /api call running the real handler
```

- On a new machine, run `npx playwright install chromium` once first.
- `npm run test:e2e` uses port 4391; set `HELLOQUEUE_TEST_PORT` to change it, for example when two
  Playwright runs happen at once.
- The bot's button handler is tested by loading `bot/index.js` with a fake TelegramBot
  (`tests/support/fake-telegram-bot.cjs`).
- A test named after a gap (H1, H2, M1 and so on) either records the gap or, once it's fixed,
  proves the fix. Tests labelled "open:" record known behaviour that no job has fixed yet.
- Page safety: `tests/e2e/xss.spec.js` proves data shows as text (H3), and
  `tests/e2e/analytics.spec.js` that staff and sign-in pages load no analytics (F1).
- `tests/`, `playwright.config.js`, `.eslintrc.json`, `schema.sql` and `sql/` are listed in `.vercelignore`, so Vercel
  doesn't publish them.

## Deployment

### 1. Database
Run `schema.sql` in the Supabase SQL editor.

### 2. Vercel
```bash
git init && git add . && git push origin main
# Connect repo in Vercel dashboard
# Add env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
# Set custom domain: queue.gftv.asia
```

To use the webhook, register it once with the Bot API (BotFather can't set the secret), passing
the same secret as `TELEGRAM_WEBHOOK_SECRET`:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d url=https://queue.gftv.asia/api/telegram/webhook \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Telegram sends updates either to a webhook or to one polling bot, never both. While a webhook is
set, the VPS bot in step 3 gets no updates (`polling_error` 409); to go back to the polling bot,
call `deleteWebhook`. The webhook handles fewer commands than the polling bot and no buttons.

### 3. Telegram Bot (VPS)
```bash
# New tmux session per the usual setup
tmux new-session -s helloqueue-bot

cd ~/helloqueue-bot
npm install   # includes dotenv, so a .env next to index.js is read

export TELEGRAM_BOT_TOKEN="..."
export SUPABASE_URL="..."
export SUPABASE_SERVICE_KEY="..."
export WEBAPP_URL="https://queue.gftv.asia"

node index.js
```

### 4. PWA Icons
Add `icon-192.png` and `icon-512.png` to the root directory (any square images - 192×192 and 512×512 px).

---

## Notification Flow

```
Operator clicks "Call Next"
  → Entry status: waiting → serving
  → Entry token created in gftvqueue_entry_tokens
  → Telegram message sent to attendee (if notify_serving = true)
    → "🎉 It's your turn! Queue: Dealers' Den · #42"
  → Person after them notified (if notify_next = true)
    → "⏰ You're next in line! · #43"

Attendee opens /queue/{eventCode}/{queueCode}
  → Sees animated QR border (conic-gradient CSS spin)
  → Shows QR code generated from their one-time token

Operator scans QR (or enters token manually)
  → POST /api/queues/{queueId}/scan
  → Token marked used_at = now()
  → Entry status: serving → completed
  → Telegram: "✅ Entry confirmed! Enjoy the Dealers' Den!"
```

---

## Theme System

Two themes, toggled via the palette icon in the topbar. Preference saved to `localStorage`.

| Key | Name | Background |
|---|---|---|
| `light` | Light | `#ffffff` |
| `hello` | HelloTheme | `#fedc00` |

---

*Built by GFTV · Augy Studios*
*Stack: Vercel + Supabase + Telegram + Vanilla JS*
