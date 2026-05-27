# Ari

A personal AI assistant accessible from your phone via Telegram. Drafts client communications, but never sends without your tap.

## Status

**Phase 0 — Core loop.** Voice/text in via Telegram, Claude brain, persistent memory.

Upcoming:
- Phase 1: Gmail (read, draft, approve, send)
- Phase 2: Google Calendar (propose, book, reschedule)
- Phase 3: Twilio SMS (inbound + outbound with approval)
- Phase 4: WhatsApp Cloud API (same shape as SMS)

## Local setup

```bash
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, ALLOWED_TELEGRAM_USER_IDS, GROQ_API_KEY
npm run dev
```

### Getting the env values

- **TELEGRAM_BOT_TOKEN** — message [@BotFather](https://t.me/BotFather) on Telegram, `/newbot`, copy token.
- **ALLOWED_TELEGRAM_USER_IDS** — message [@userinfobot](https://t.me/userinfobot), copy your numeric ID.
- **ANTHROPIC_API_KEY** — https://console.anthropic.com
- **GROQ_API_KEY** — https://console.groq.com (free tier covers low volume voice notes)

Once running, open the bot in Telegram and send a text or voice note.

## Architecture

```
[Phone: Telegram app]
    │
    ▼
[grammY bot] ─► [Brain: Claude tool-use loop]
                    ├─ SQLite memory (history + facts + pending approvals)
                    ├─ Groq Whisper (voice notes → text)
                    └─ Tools (extensible per phase)
```

- `src/bot.ts` — Telegram message handlers
- `src/brain.ts` — Claude agent loop
- `src/memory.ts` — conversation persistence
- `src/tools/` — capabilities (one file per tool)
- `src/db.ts` — SQLite schema

## Deploy

Configured for Fly.io. After Phase 0 is verified locally:

```bash
flyctl launch --no-deploy
flyctl secrets set TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... GROQ_API_KEY=... ALLOWED_TELEGRAM_USER_IDS=...
flyctl deploy
```

Set `TELEGRAM_MODE=webhook` and `PUBLIC_URL=https://your-app.fly.dev` once deployed.
