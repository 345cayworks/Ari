# Handover: polling platform on Ari

Last updated 2026-10-25. Branch `claude/stoic-tesla-2tUY0` on `345cayworks/ari`, all work pushed. No pull request opened yet.

## Goal

A polling company for the Cayman Islands, with AI voice interviewers on **Retell** calling respondents. It's built into Ari, the Cayworks Next.js app, as a tenant-scoped "Polls" module in the admin dashboard. It's being moved from Netlify to **Cloudflare Workers**.

## Status

| Done | Commit |
|---|---|
| Retell in-call functions and post-call analysis, webhook, sync script, agent prompt | `cebe0da` |
| Polls admin (results, calls, setup, CSV) and the `/admin/login` redirect-loop fix | `da535fd` |
| Retell batch calling (CSV upload, Cayman calling hours, do-not-call and already-called filtering, progress) | `24e9e17` |
| Weighting to population targets (raking, presets, diagnostics) | `0783ff1` |
| Port to Cloudflare Workers (Next 15.5.28, React 19, Prisma 6 + adapter-pg, OpenNext) | `bdd6880` |
| Init migration for the whole schema — 17 tables, 9 enums, verified zero drift | `ca8aee0` |
| Auth.js `trustHost` — login returned 500 `UntrustedHost` on Workers | `d305800` |
| Default models moved to the Claude 5 family; cost table corrected | `8490487` |
| `ARI_MODEL` set to Sonnet 5.5 (user's choice over Opus 5.5) | `014f97f` |
| `scripts/retell-create-agent.ts` — nothing in the repo could create an agent | `3897b47` |

Each step was tested end to end against a throwaway Postgres, a mock Retell API and Playwright. The Cloudflare port was also tested inside workerd (`wrangler dev`), including 30 concurrent requests. Typecheck and build pass. **Nothing has run against a real Retell account, real Neon database, or real Cloudflare deploy.** The 2026-10-25 session added the three commits above and verified login end to end against the production build (`NODE_ENV=production`, csrf 200, master key returns a SUPER_ADMIN session, wrong key rejected). The Claude 5 model switch is **not** verified against the live API — no `ANTHROPIC_API_KEY` in the sandbox.

## Next steps (in order)

Decisions already taken with the user: **`prisma migrate deploy`** using the
committed init migration (not `db push`); **no Hyperdrive** on the first deploy
(`lib/db.ts` picks it up later if the binding appears); `ARI_MODEL` =
**`claude-sonnet-5-5`**; the Retell in-call model = **`claude-5.5-sonnet`** and
language **`en-US`** (already the defaults in `retell-create-agent.ts`, so run
it without `--model` or `--language`).

Verified offline on this HEAD (2026-10-25): `npm run typecheck`, `npm run
build`, `npx opennextjs-cloudflare build`, and `wrangler deploy --dry-run` —
**2224 KiB gzipped** against the 3 MB free-plan limit, both bindings
resolving. The build is deploy-ready; only network access is missing.

1. **Deploy to Cloudflare.** Worker name `ari` confirmed free (39 Workers on the
   account; `ari-crm-api` is unrelated). The Cloudflare connector cannot deploy
   or set secrets, and `wrangler login` needs a browser the sandbox lacks, so
   deploy with an API token in the environment.
   - Read the credentials from the environment variables listed below.
   - Read-only first: `prisma migrate diff --from-url "$NEON_DIRECT_URL"
     --to-schema-datamodel prisma/schema.prisma --script` to show the user the
     exact DDL and whether that database is empty. **Confirm before applying.**
   - `DATABASE_URL="$NEON_DIRECT_URL" npx prisma migrate deploy`
   - **Then seed.** `authorize()` in `lib/auth.ts` requires the user row to
     already exist, so without `npm run db:seed` the master key logs in to
     nothing. The seed also reads `ALLOWED_TELEGRAM_USER_IDS` to link the bot.
   - `npx wrangler secret put <NAME>` for each secret, then `npm run deploy`,
     then set `NEXTAUTH_URL` and `PUBLIC_BASE_URL` to the Worker URL and deploy
     again.
   - `NEXT_PUBLIC_GA4_MEASUREMENT_ID` and `NEXT_PUBLIC_META_PIXEL_ID` are
     inlined at **build** time, not Worker secrets — they must be set before
     the build or they do nothing.
2. **Connect Retell.** `npm run retell:sync` pushes tools, analysis fields and
   the webhook URL to `RETELL_AGENT_ID`; `--prompt` also pushes
   `retell/poll-agent-prompt.md`. It overwrites agent settings — show the user
   the diff first.
3. **Caller number (blocker for real calls).** Retell-purchased numbers can
   **only call US numbers**, and +1 345 isn't US. The user needs a +1 345 number
   from Twilio or Telnyx, **imported** into Retell over a SIP trunk, set as
   `RETELL_FROM_NUMBER`.
4. **Re-register the Telegram webhook** at the new URL (Ari's original feature).
5. **Smoke-test the Claude 5 switch** by sending a Telegram message, which
   exercises `lib/ari/brain.ts`. Watch for truncation: thinking is always on for
   Opus 5.5 and counts against `max_tokens`, now 4096.
6. **Open a PR** when the user asks. They haven't yet.

## Blocked on (2026-10-25, second session)

1. **Network allowlist.** The sandbox's policy denied `api.retellai.com`,
   `api.cloudflare.com`, `api.telegram.org`, `workers.cloudflare.com` and the
   Neon host — DNS does not even resolve. The user added them under Allowed
   domains, but **a policy change only takes effect in a new session**, like the
   secrets. Re-test first thing:
   `curl -o /dev/null -w '%{http_code}\n' https://api.retellai.com/`
   and `getaddrinfo` on the Neon host. `$HTTPS_PROXY/__agentproxy/status`
   lists recent denials under `recentRelayFailures`.
2. **Postgres may still not work even with the Neon host allowed.** Prisma
   connects over raw TCP 5432, which an HTTP CONNECT proxy does not carry. If
   DNS resolves but 5432 does not open, the fallbacks are the user running
   `prisma migrate deploy` locally, or applying
   `prisma/migrations/20261025043722_init/migration.sql` over Neon's HTTP SQL
   endpoint and inserting the matching `_prisma_migrations` row by hand.
3. **`NEON_DATABASE_URL` is the direct URL, not the pooled one.** Both Neon
   variables held the identical non-pooled string. `lib/db.ts` makes one client
   per request on Workers, so without the `-pooler` host Neon's connection
   ceiling becomes the app's concurrency ceiling. Asked the user to fix it;
   re-check before setting the Worker secret.
4. **`retell/poll-agent-prompt.md` still says `[COMPANY NAME]`, twice** —
   including in the line the agent speaks when asked who is calling. A live
   interviewer would read the placeholder aloud. Waiting on the company name;
   fix the prompt before any real call, then `retell:sync -- --prompt`.
5. **Voice not chosen.** Run `npm run retell:create-agent -- --list-voices` and
   pick with the user; it is the most audible choice in the system.
6. **Still-missing environment variables:** `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
   `ARI_TELEGRAM_USER_ID`, and the four generated secrets below. Present as of
   the second session: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `NEON_DIRECT_URL`, `NEON_DATABASE_URL`, `RETELL_API_KEY`,
   `TELEGRAM_BOT_TOKEN`.

## Environment variables the next session needs

Set in the cloud environment's settings, not pasted into chat; **a new session
is needed to pick them up**. The Neon strings are deliberately *not* named
`DATABASE_URL` / `DIRECT_URL`, so no stray test or `db push` can reach
production.

| Variable | Notes |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers Scripts: Edit + Account Settings: Read |
| `CLOUDFLARE_ACCOUNT_ID` | not secret |
| `NEON_DIRECT_URL` | direct, non-pooled — migrations |
| `NEON_DATABASE_URL` | the `-pooler` string — Worker runtime |
| `ANTHROPIC_API_KEY` | also unblocks a live model smoke test |
| `GROQ_API_KEY` | voice-note transcription |
| `TELEGRAM_BOT_TOKEN` | |
| `RETELL_API_KEY` | also verifies webhook signatures |
| `RETELL_AGENT_ID` | not secret (`agent_...`) |
| `ARI_TELEGRAM_USER_ID` | numeric, for `ALLOWED_TELEGRAM_USER_IDS` |
| `NEXTAUTH_SECRET`, `SUPERADMIN_MASTER_KEY`, `PHONE_HASH_SECRET`, `TELEGRAM_WEBHOOK_SECRET` | generated 2026-10-25 and given to the user; re-add them here rather than regenerating — **`PHONE_HASH_SECRET` can never change once any poll call exists** |

## Map of the code

- `lib/polling/config.ts`: Retell tool definitions (`record_answer`, `add_to_do_not_call`, `schedule_callback`, `end_call`, optional `transfer_call`) and post-call analysis fields. This is the single source of truth for `scripts/retell-sync.ts`.
- `lib/polling/retell.ts`: Retell API helper and signature check (`x-retell-signature`, `v=<ms>,d=<hex>`, HMAC-SHA256(apiKey, body+ms), 5-minute window). It matches `retell-sdk` 6.2.12's `verify`.
- `lib/polling/calls.ts`: links calls to polls (metadata `poll_id` / `batch_id`, or dynamic variable `poll_id`, or agent ID). Also function handlers, webhook ingestion, `placePollCall`, and `createPollBatch` (chunks of 1,000, sent in parallel, timezone `America/Cayman`).
- `lib/polling/phone.ts`: E.164 normalising (7 digits are treated as +1 345) and HMAC phone hashing (`PHONE_HASH_SECRET`, never change it).
- `lib/polling/results.ts`: stats, tallies (option order comes from "(A / B / C)" in the question text), limits.
- `lib/polling/weighting.ts`: raking with trimming; `lib/polling/census.ts`: presets; `lib/polling/weighted.ts`: shared loader for results, weighting and CSV.
- `app/api/retell/{webhook,functions}/route.ts`, `app/admin/polls/**`, `app/(auth)/admin/login`.
- `lib/db.ts`: Prisma through a Proxy. It creates **one client per request on Workers** (keyed by `getCloudflareContext().ctx`, using Hyperdrive when bound) and one shared client on Node.
- Prisma models: `Poll` (`variables`, `weighting` JSON), `PollCall`, `PollResponse`, `DoNotCall`, `PollCallback`, `PollBatch`.

## Decisions and why

- Answers are saved live through `record_answer`, because Retell's post-call analysis fields are configured per agent while questions change per poll. Analysis `answers_json` only fills gaps.
- Phone numbers are stored only as HMACs, except `PollCallback.phoneNumber`, which is cleared once the callback is handled.
- Next 15.5.28 is required because `@opennextjs/cloudflare` 1.20 needs Next ≥15.5.28.
- The database uses Prisma 6 (not 7) with `@prisma/adapter-pg` (not Neon HTTP), so it can use Hyperdrive and be tested locally in workerd.
- Weighting presets cover only two district sets:
  - Electors by area, from the Elections Office register effective 1 Oct 2026. Bodden Town is derived as the total minus the other areas.
  - Residents by district, from the 2021 Census, Section 1.2 (base 68,811). Sister Islands is derived the same way.

  Both came from **search summaries**: `eso.ky` and the Elections portal are blocked from the sandbox. Tell the user to verify them. Age, sex and status targets are deliberately not preset.

## Gotchas for the next session

- **`pkill -f <pattern>` kills your own shell** when the pattern appears in the command line (exit 144). Kill by PID from `ps` instead.
- Test Postgres: `/usr/lib/postgresql/16/bin/initdb` must run as the `postgres` user in a directory it can reach (e.g. `/var/lib/postgresql/ari_test`). The scratchpad's parent directories aren't readable by `postgres`.
- `docs.retellai.com`, `eso.ky` and Wikipedia are blocked. npm works, so read Retell's API from the `retell-sdk` tarball.
- Wrangler logs "Request was cancelled" at startup because it can't fetch `Request.cf` in the sandbox. This is harmless.
- `next dev` runs `initOpenNextCloudflareForDev()` (in `next.config.ts`). `npm run preview` runs the real Worker locally and reads secrets from `.dev.vars` (gitignored).
- The Worker is about 2.2 MB gzipped (free plan limit 3 MB, paid 10 MB).
- **Auth.js trusts the request Host only** when `AUTH_URL`, `AUTH_TRUST_HOST`,
  `VERCEL` or `CF_PAGES` is set, or outside production — and it reads
  `AUTH_URL`, never `NEXTAUTH_URL`. Hence `trustHost: true` in `lib/auth.ts`.
  Don't remove it; login 500s on Workers without it.
- `@anthropic-ai/sdk` is pinned at **0.40.1**, which predates
  `output_config.effort`, so thinking depth can't be tuned. A chat route like
  Ari's wants `effort: "low"`. Upgrading the SDK is a major-version bump — it
  was deliberately left out of the pre-deploy commits.
- No `ANTHROPIC_API_KEY` in the sandbox, so `lib/ari/brain.ts` has never been
  run against the live API.

## Prompt to start the next session

> Continue the Ari polling work on branch `claude/stoic-tesla-2tUY0` of `345cayworks/ari`. Read `docs/HANDOVER.md` first, then re-test the hosts under "Blocked on" — the domains and secrets were added but needed a new session. If Retell is reachable, create the polling agent (`npm run retell:create-agent -- --list-voices` first, then pick a voice with me) and give me the agent ID. Confirm with me before the migration, the deploy, and anything that overwrites Retell agent settings.
