# Ari

Your personal AI chief of staff. A Cayworks platform.

Talk to Ari from your phone via Telegram. She drafts client communications, tracks commitments, and never sends anything without your tap.

## Stack

- **Next.js 14** (App Router) on **Netlify**
- **Neon Postgres** + **Prisma** ORM
- **NextAuth v5** (Credentials → magic-link in Phase 1)
- **Anthropic Claude** (Sonnet 4.6 default, Haiku 4.5 for routing)
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

In production, Netlify gives you the URL directly.

## Deploy to Netlify

1. Push branch to GitHub
2. New Netlify site → connect repo
3. Add all env vars in Netlify → Site settings → Environment variables (Production + Deploy Previews)
4. First deploy will run `prisma generate && next build`
5. Run migrations once: locally do `DATABASE_URL=<prod-url> npx prisma migrate deploy`
6. Set `NEXTAUTH_URL=https://<your-site>.netlify.app`
7. Register Telegram webhook to `https://<your-site>.netlify.app/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`

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
│   ├── admin/                                  # gated dashboard
│   │   ├── layout.tsx
│   │   ├── page.tsx                            # overview
│   │   ├── login/page.tsx
│   │   ├── conversations/page.tsx
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
├── netlify.toml
├── next.config.js
├── tailwind.config.ts
└── tsconfig.json
```
