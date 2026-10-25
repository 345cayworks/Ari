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

Each step was tested end to end against a throwaway Postgres, a mock Retell API and Playwright. The Cloudflare port was also tested inside workerd (`wrangler dev`), including 30 concurrent requests. Typecheck and build pass. **Nothing has run against a real Retell account, real Neon database, or real Cloudflare deploy.**

## Next steps (in order)

1. **Deploy to Cloudflare.** The Worker name `ari` is free (the account has 39 Workers, including an unrelated `ari-crm-api`). The connected "Cloudflare Developer Platform" connector can list Workers and manage KV, R2, D1 and Hyperdrive, but **can't deploy or set secrets**, and it says it's deprecated in favour of `https://mcp.cloudflare.com/mcp`. So deploy with Wrangler:
   - `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID` in the environment
   - `DATABASE_URL=<neon-direct-url> npx prisma migrate deploy`. The repo has **no `prisma/migrations` folder**, so the first time run `npx prisma migrate dev --name init` against a dev database, or `prisma db push`, and decide which with the user.
   - `npx wrangler secret put <NAME>` for every key in `.env.example`. Use Neon's direct (non-pooled) URL.
   - `npm run deploy`, then set `NEXTAUTH_URL` and `PUBLIC_BASE_URL` to the Worker URL and deploy again
   - Optional: create Hyperdrive and uncomment the block in `wrangler.jsonc`
2. **Connect Retell.** `npm run retell:sync` pushes the tools, analysis fields and webhook URL to `RETELL_AGENT_ID`. Add `--prompt` to also push `retell/poll-agent-prompt.md`.
3. **Caller number (blocker for real calls).** Retell-purchased numbers can **only call US numbers**, and +1 345 isn't US. The user needs a +1 345 number from Twilio or Telnyx, **imported** into Retell over a SIP trunk, set as `RETELL_FROM_NUMBER`.
4. **Re-register the Telegram webhook** at the new URL (Ari's original feature).
5. **Open a PR** when the user asks. They haven't yet.

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

## Prompt to start the next session

> Continue the Ari polling work on branch `claude/stoic-tesla-2tUY0` of `345cayworks/ari`. Read `docs/HANDOVER.md` first. Next step: deploy to Cloudflare Workers as `ari` (see "Next steps"), then help me connect Retell.
