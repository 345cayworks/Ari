# Ari

Your personal AI chief of staff. A Cayworks platform.

Talk to Ari from your phone via Telegram. She drafts client communications, tracks commitments, and never sends anything without your tap.

## Stack

- **Next.js 15** (App Router) on **Cloudflare Workers** via OpenNext
- **Neon Postgres** + **Prisma** ORM
- **NextAuth v5** (Credentials → magic-link in Phase 1)
- **Anthropic Claude** (Sonnet 5.5 default, Haiku 5.5 for routing)
- **Groq Whisper** for voice-note transcription
- **grammY** for Telegram
- Multi-tenant from day 1, SaaS-ready

## Phase 0.5 — what works today

- Marketing splash at `/`
- SuperAdmin dashboard at `/admin`
  - Overview · Conversations · Approvals (empty) · Settings · Usage · SuperAdmin
- Telegram bot at `/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`
  - Text and voice notes both work
  - Claude tool-use loop with persistent memory in Postgres
  - One built-in tool: `remember` (saves long-term facts)
- ads.cayworks.com webhook integration (off by default, toggle in SuperAdmin)
- GA4 + Meta Pixel scaffolded (only fires if env IDs set)
- API cost tracking per tenant

## Local setup

```bash
npm install
cp .env.example .env.local
# fill the required values (see below)
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

### Required env vars to get started

```
DATABASE_URL              # Neon connection string (pooled)
DIRECT_URL                # Neon connection string (direct, for migrations)
NEXTAUTH_SECRET           # openssl rand -base64 32
NEXTAUTH_URL              # http://localhost:3000 in dev
SUPER_ADMIN_EMAIL         # info@cayworks.com
SUPERADMIN_MASTER_KEY     # openssl rand -hex 24  (use this to sign in first time)
ANTHROPIC_API_KEY
GROQ_API_KEY              # https://console.groq.com — free tier
TELEGRAM_BOT_TOKEN        # from @BotFather
TELEGRAM_WEBHOOK_SECRET   # openssl rand -hex 24
ALLOWED_TELEGRAM_USER_IDS # your Telegram numeric ID (from @userinfobot)
```

### First-time login

1. Visit `/admin/login`
2. Enter `SUPER_ADMIN_EMAIL` + `SUPERADMIN_MASTER_KEY`
3. You'll land on the dashboard with full SuperAdmin role

### Connecting Telegram in dev

Telegram needs a public HTTPS URL for webhooks. Easiest in dev:

```bash
# in another terminal
npx ngrok http 3000

# then register the webhook
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<ngrok-id>.ngrok.app/api/telegram/webhook/$TELEGRAM_WEBHOOK_SECRET&secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

In production, the Worker's URL is used directly.

## Deploy to Cloudflare Workers

The app runs on Workers through [OpenNext](https://opennext.js.org/cloudflare) (`@opennextjs/cloudflare`). Prisma connects to Neon over Postgres with `@prisma/adapter-pg`, one client per request (see `lib/db.ts`). Optionally it goes through Hyperdrive for connection pooling.

1. `npx wrangler login`
2. Run migrations once: `DATABASE_URL=<neon-direct-url> npx prisma migrate deploy`
3. Add every variable from `.env.example` as a Worker secret, e.g. `npx wrangler secret put DATABASE_URL` (or in the Cloudflare dashboard under Workers → ari → Settings → Variables and secrets). Use Neon's **direct** (non-pooled) connection string for `DATABASE_URL`.
4. `npm run deploy`. This builds with OpenNext and uploads the Worker. The first deploy prints the URL, e.g. `https://ari.<subdomain>.workers.dev`.
5. Set `NEXTAUTH_URL` and `PUBLIC_BASE_URL` to that URL (or your custom domain), then deploy again.
6. Point integrations at it: `npm run retell:sync` for Retell, and register the Telegram webhook at `https://<worker-url>/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`.
7. Optional, Hyperdrive: `npx wrangler hyperdrive create ari-db --connection-string="<neon-direct-url>"`, then uncomment the `hyperdrive` block in `wrangler.jsonc` with the returned id. `lib/db.ts` uses it automatically.

`npm run preview` builds and runs the Worker locally in workerd. It reads secrets from `.dev.vars`, which is gitignored and uses the same keys as `.env.example`. `npm run dev` is still plain Next.js on Node.

## Polling (Retell voice agents)

AI interviewers on Retell call respondents, read a poll's questions and record answers here.

- **In-call functions** at `/api/retell/functions`: `record_answer` (saves each answer as it's given, so a dropped call still keeps its partial answers), `add_to_do_not_call` and `schedule_callback`. Retell's built-in `end_call` is always added, and `transfer_call` too when `RETELL_TRANSFER_NUMBER` is set.
- **Post-call analysis** at `/api/retell/webhook`: on `call_analyzed`, saves the outcome, consent, quality flags (whether the agent deviated from the script, how well the two understood each other) and the summary. `answers_json` only fills questions that `record_answer` missed.
- Tools and analysis fields are defined in `lib/polling/config.ts`, and the agent prompt is in `retell/poll-agent-prompt.md`.
- Phone numbers are stored only as an HMAC (`PHONE_HASH_SECRET`). The exception is callbacks, which need the real number to dial back.

Setup:

1. Set the `RETELL_*`, `PUBLIC_BASE_URL` and `PHONE_HASH_SECRET` env vars (see `.env.example`), then run `npx prisma migrate dev --name polling`.
2. Run `npm run retell:sync` to push the tools, analysis fields and webhook URL to `RETELL_AGENT_ID`. Add `--prompt` to also replace the agent's prompt, or `--dry-run` to preview. Tools and fields you added yourself in Retell are kept.
3. In **Admin → Polls**, create a poll, write its questions on the Setup tab (each starting with an ID like `Q1.` and ending with its options in brackets), then activate it.
4. On the Calls tab, send a **batch** by pasting numbers or uploading a CSV (up to 5,000 per batch). Choose calling hours and days in Cayman time and an optional start time. Retell dials only within that window. Do-not-call numbers, duplicates and (by default) anyone already called for this poll are removed first, and each batch shows how many of its numbers have been dialled and completed. "Call now" dials up to 20 numbers immediately, for tests. The same tab lists callback requests and recent calls with their answers and quality flags.

   To reach +1 345 numbers, `RETELL_FROM_NUMBER` must be a number **imported** into Retell over a SIP trunk (e.g. Twilio or Telnyx). Numbers bought from Retell can only call US numbers.
5. The Results tab tallies answers per question and exports a CSV with one row per call and no phone numbers.
6. On the Weighting tab, add targets for demographic questions (e.g. district, age) and turn weighting on. Results and the CSV are then raked to those targets, with weights capped (0.3–3 by default). The tab shows sample vs weighted vs target for each category, answers that didn't match any category (add them as aliases), and the effective sample size, design effect and margin of error. Presets cover registered electors by area (Elections Office register, 1 Oct 2026) and residents by district (2021 Census). Age, sex and status targets are entered from ESO tables. Weighting code is in `lib/polling/weighting.ts`, presets in `lib/polling/census.ts`.

Calls can also be placed in code with `placePollCall(pollId, number)` from `lib/polling/calls.ts`. For test calls from the Retell dashboard, pass `poll_id` as a dynamic variable, or set the poll's Retell agent ID.

## Roadmap

| Phase | Deliverable |
|---|---|
| **0.5 — now** | Scaffold, dashboard, Telegram brain |
| 1 | Magic-link login, polished UI, approval-from-dashboard |
| 2 | Gmail OAuth + read/draft/approve/send |
| 3 | Google Calendar |
| 4 | Twilio SMS |
| 5 | WhatsApp Cloud API |
| 6 | ads.cayworks.com event firing on approvals |
| 7 | Public marketing site + waitlist |
| 8 | Stripe subscriptions (Founder / Pro / Concierge) |

## Project layout

```
ari/
├── app/
│   ├── page.tsx                                # marketing /
│   ├── (auth)/admin/login/page.tsx             # outside the gated layout
│   ├── admin/                                  # gated dashboard
│   │   ├── layout.tsx
│   │   ├── page.tsx                            # overview
│   │   ├── conversations/page.tsx
│   │   ├── polls/                              # poll list, results, calls, setup, CSV
│   │   ├── approvals/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── usage/page.tsx
│   │   └── superadmin/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       └── telegram/webhook/[secret]/route.ts
├── lib/
│   ├── auth.ts                                 # NextAuth config
│   ├── db.ts                                   # Prisma client singleton
│   ├── env.ts                                  # zod-validated env
│   ├── utils.ts                                # cn(), formatRelative
│   ├── ari/
│   │   ├── brain.ts                            # Claude tool-use loop
│   │   ├── stt.ts                              # Groq Whisper
│   │   └── tools/
│   │       ├── types.ts
│   │       ├── index.ts                        # tool registry
│   │       └── remember.ts
│   └── integrations/
│       └── ads-cayworks.ts                     # lead-touch webhook helper
├── components/
│   ├── tracking.tsx                            # GA4 + Meta Pixel
│   └── admin/nav.tsx
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── next.config.ts
├── open-next.config.ts                         # OpenNext (Cloudflare) build config
├── wrangler.jsonc                              # Worker config
├── tailwind.config.ts
└── tsconfig.json
```
