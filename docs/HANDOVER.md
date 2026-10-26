# Handover: polling platform on Ari

Last updated 2026-10-25, third session. Branch `claude/stoic-tesla-2tUY0` on
`345cayworks/ari`. No pull request opened yet — the user has not asked.

**It is deployed and working.** Canonical URL
**https://polling.cayworks.net**; `https://ari.delicate-wood-499a.workers.dev`
still serves as a fallback and `workers_dev` is deliberately kept on.

## Goal

A polling company for the Cayman Islands, with AI voice interviewers on
**Retell** calling respondents. Built into Ari, the Cayworks Next.js app, as a
tenant-scoped "Polls" module in the admin dashboard, running on **Cloudflare
Workers**.

## Status

Everything below was verified against the live deployment, not just built:

| Working | Evidence |
|---|---|
| Neon schema | `prisma migrate deploy` applied `20261025043722_init`; `migrate status` says up to date |
| Seed | tenant `founder`, SuperAdmin `info@cayworks.com`, Telegram ID `7683767594` linked |
| Admin login | user logged in; a wrong key is rejected with no session cookie |
| Database from the Worker | `/api/telegram/webhook` returns `{"ok":true}` on a lookup |
| Retell agent | `retell-llm`, voice `retell-Cimo`, 4 tools and 13 analysis fields pointed at the Worker |
| Caller number | `+13452331702`, type `custom` (SIP trunk) — a `retell-twilio` number could only call the US |
| A complete interview | 153 s call, consent, all 6 questions asked, 6 `PollResponse` rows, outcome `COMPLETED` |
| GA4 | `G-FL490J7JVX` inlined; verified in the served HTML |
| Telegram webhook | registered at the custom domain, no delivery errors |

**Not yet exercised:** `lib/ari/brain.ts` has still never run against the live
Anthropic API — `Message` and `ApiUsage` are both empty. Any plain (non-slash)
Telegram message will do it; `/start` and `/whoami` return before the model is
called.

## The three faults a real deploy exposed

The previous session's `wrangler dev` tests passed and the first real deploy
still failed three times. All three were export-condition and file-tracing
problems, and all three are fixed — this is the most valuable thing in this
document.

1. **`@anthropic-ai/sdk` runtime shim.** Next traced it under the `node`
   condition and copied `_shims/auto/runtime-node.mjs`; OpenNext bundles with
   `workerd`, which wants `_shims/auto/runtime.mjs`. Build failed to resolve it.
   Fixed by naming the tree in `outputFileTracingIncludes`.
2. **Prisma had no usable query engine.** `prisma generate` emitted a native
   engine for the build machine (`query_engine-windows.dll.node`), which
   workerd cannot execute, and the WASM files were never traced in. `binaryTargets`
   cannot fix this. Fixed with `engineType = "client"` in the generator (the
   Rust-free client) plus tracing `.prisma/client/**`.
3. **The bundler always picks Prisma's Node entry point.** `bundle-server.js`
   runs esbuild with `platform: "node"` *and* `conditions: ["workerd"]`, and
   esbuild honours whichever the package lists first — Prisma lists `node`
   first. So `lib/db.ts` imports **`@prisma/client/wasm`**, whose subpath has no
   `node`/`workerd` branching. Do not "tidy" that import back.

`driverAdapters` and `queryCompiler` are **not** the fix: 6.19.3 warns both are
deprecated and on by default.

## How to work on this locally

`npm run preview` runs the real Worker in workerd and reads `.dev.vars`
(gitignored, written from `.env.local`). It is the only faithful local
environment — a build plus probe is about three minutes, against five for a
deploy, and it is how faults 2 and 3 were found. `next dev` may now break,
since it would load the WASM client under Node; use `preview`.

`.env.local` (gitignored) holds the real values. Note the names: the code reads
`DATABASE_URL` (the `-pooler` host) and `DIRECT_URL` (without `-pooler`), not
the `NEON_*` names the cloud environment used.

## Next steps

1. **Publish the agent in Retell.** It reports `is_published: false`, and
   webhooks have never been delivered on their own: three app-placed calls
   produced no `PollCall` row until events were replayed by hand. Also set the
   same URL as the **account-level** webhook in Retell's settings. Until then
   use the button in step 2.
2. **"Check for missed calls"** on a poll's Calls tab (`reconcilePollCalls`)
   pulls in calls Retell never delivered a webhook for. Idempotent. Five of the
   test poll's six calls were still uningested when it shipped.
3. **Smoke-test `brain.ts`** with a plain Telegram message. `ARI_MODEL` is
   `claude-sonnet-5-5`; watch for truncation, `max_tokens` is 4096.
4. **Delete the test poll** `TEST — Cayman Pulse (safe to delete)` when done.
5. **`{{agent_name}}`** now appears in the live greeting and Role line. The
   value comes from the poll's `agent_name` field, currently "Nina" — the
   Retell dashboard's own agent-name field is an internal label and is never
   read aloud.

## The prompt: the dashboard one is live, not the repo file

A direction change, decided with the user this session. The agent runs a prompt
written in the Retell dashboard, which reads `{{company_name}}`,
`{{survey_topic}}`, `{{survey_script}}`, `{{sponsor_disclosure}}` and
`{{number_source}}`. `retell/poll-agent-prompt.md` expects a completely
different set (`{{survey_questions}}`, `{{time_of_day}}`, …) — only
`sponsor_disclosure` overlaps.

The first test calls had no questions because nothing supplied
`{{survey_script}}`. `derivePromptVariables()` in `lib/polling/calls.ts` now
builds it from the three question variables, maps `survey_topic` from
`poll_topic`, and defaults `number_source` to "not provided" (wording the
prompt handles). An explicit value on the poll always wins. The three question
variables are **not** renamed, because `results.ts` parses them to recover each
question's wording.

The dashboard prompt was kept because it needs no company phone or website,
takes the company as a variable, and has no `{{time_of_day}}` bug.
**`retell:sync --prompt` would overwrite it with the repo file and the agent
would lose its questions — never run it.** Running `retell:sync` *without*
`--prompt` is safe and was verified not to touch `general_prompt` or
`begin_message`.

## Open risks

- **`{{time_of_day}}`** in the repo prompt is supplied by nothing. Moot while
  the dashboard prompt is live; it would be a live bug if the file is ever pushed.
- **`PHONE_HASH_SECRET` can never change** now that poll calls exist.
- Two credentials were exposed in a session transcript and should be rotated if
  that has not been done: the Neon `neondb_owner` password, and a Cloudflare API
  token (commented out in `.env.local`; it had no Workers access to this account
  anyway).
- Weighting presets still come from search summaries, not primary sources. Ask
  the user to verify before publishing any weighted result.

## Map of the code

- `lib/polling/config.ts`: Retell tool definitions (`record_answer`, `add_to_do_not_call`, `schedule_callback`, `end_call`, optional `transfer_call`) and post-call analysis fields. This is the single source of truth for `scripts/retell-sync.ts`.
- `lib/polling/retell.ts`: Retell API helper and signature check (`x-retell-signature`, `v=<ms>,d=<hex>`, HMAC-SHA256(apiKey, body+ms), 5-minute window). It matches `retell-sdk` 6.2.12's `verify`.
- `lib/polling/calls.ts`: links calls to polls (metadata `poll_id` / `batch_id`, or dynamic variable `poll_id`, or agent ID). Also function handlers, webhook ingestion, `derivePromptVariables`, `placePollCall`, `createPollBatch` (chunks of 1,000, parallel, timezone `America/Cayman`) and `reconcilePollCalls`.
- `lib/polling/phone.ts`: **`tryNormalizePhone`** is strict (7-digit Cayman, or NANP with area and exchange codes starting 2-9) and returns `null`; it gates the two places calls are placed. `normalizePhone` stays lenient for recording and hashing inbound numbers, so ingestion can't be broken by an odd number. Before this, an 11-digit typo became `+33453249000` and was dialled — France.
- `lib/polling/results.ts`: `POLL_VARIABLES` (the admin setup form is generated from this list), stats, tallies (option order comes from "(A / B / C)" in the question text), limits.
- `lib/polling/weighting.ts`: raking with trimming; `lib/polling/census.ts`: presets; `lib/polling/weighted.ts`: shared loader for results, weighting and CSV.
- `app/api/retell/{webhook,functions}/route.ts`, `app/admin/polls/**`, `app/(auth)/admin/login`.
- `lib/db.ts`: Prisma through a Proxy, importing **`@prisma/client/wasm`** (see fault 3). One client per request on Workers (keyed by `getCloudflareContext().ctx`, using Hyperdrive when bound), one shared client on Node.
- Prisma models: `Poll` (`variables`, `weighting` JSON), `PollCall`, `PollResponse`, `DoNotCall`, `PollCallback`, `PollBatch`.

## Decisions and why

- Answers are saved live through `record_answer`, because Retell's post-call analysis fields are configured per agent while questions change per poll. Analysis `answers_json` only fills gaps.
- Phone numbers are stored only as HMACs, except `PollCallback.phoneNumber`, which is cleared once the callback is handled.
- Next 15.5.28 is required because `@opennextjs/cloudflare` 1.20 needs Next ≥15.5.28.
- The database uses Prisma 6 (not 7) with `@prisma/adapter-pg` (not Neon HTTP), so it can use Hyperdrive and be tested locally in workerd.
- A poll cannot be activated without `survey_questions` **and** `company_name`: the company name is read aloud in the opening line, and a blank one would have every respondent hear "calling on behalf of" and a gap.
- Weighting presets cover only two district sets:
  - Electors by area, from the Elections Office register effective 1 Oct 2026. Bodden Town is derived as the total minus the other areas.
  - Residents by district, from the 2021 Census, Section 1.2 (base 68,811). Sister Islands is derived the same way.

  Both came from **search summaries**: `eso.ky` and the Elections portal are blocked from the sandbox. Tell the user to verify them. Age, sex and status targets are deliberately not preset.

## Gotchas

Deployment and tooling, all learned the hard way this session:

- **Adding a `routes` entry to `wrangler.jsonc` turns `workers_dev` off by
  default.** This 404'd the app and both webhooks mid-session. `workers_dev:
  true` is now explicit — keep it until nothing points at the `workers.dev` URL.
- **Wrangler reads `.env.local` and prefers a `CLOUDFLARE_API_TOKEN` found
  there over its own `wrangler login`.** A token with no Workers access to this
  account silently broke every deploy. It is commented out; leave it that way.
- **The Prisma CLI reads `.env`, never `.env.local`**, and `db:seed` has no
  `--env-file-if-exists` flag unlike the two retell scripts. Run them as
  `node --env-file=.env.local node_modules/prisma/build/index.js migrate deploy`
  and `node --env-file=.env.local --import tsx prisma/seed.ts`. Worth fixing in
  `package.json` one day.
- `NEXT_PUBLIC_*` variables are inlined at **build** time from `.env.local`, so
  changing GA4 or the Meta Pixel needs a rebuild, not a secret update.
- Secrets take effect on their own — `wrangler secret bulk` creates a new Worker
  version, so no redeploy is needed after setting them. Pipe the JSON over
  stdin to keep values out of argv and shell history.
- `wrangler tail` takes the Worker name as a **positional** argument, and with
  its output redirected on Windows it dies on a libuv assertion. Run it in a
  terminal with a TTY.
- The Worker is **2.2 MB gzipped** against the 3 MB free-plan limit — Prisma's
  WASM query compiler is 1.95 MB of that. Roughly 850 KB of headroom.
- A new Cloudflare custom domain was serving within seconds; an eight-minute
  "not serving" wait turned out to be the **local** resolver negative-caching
  the name from before it existed. Verify with `nslookup <host> 8.8.8.8`, or by
  connecting to the edge IP with the right SNI, before blaming Cloudflare.

Application behaviour:

- **Auth.js trusts the request Host only** when `AUTH_URL`, `AUTH_TRUST_HOST`,
  `VERCEL` or `CF_PAGES` is set, or outside production — and it reads
  `AUTH_URL`, never `NEXTAUTH_URL`. Hence `trustHost: true` in `lib/auth.ts`.
  Don't remove it; login 500s on Workers without it.
- **`signIn` in a server action throws instead of redirecting.** An uncaught
  `AuthError` renders Next's generic "server-side exception" page, so a mistyped
  key looked like a broken deployment for an hour. The login page now catches
  **only** `CredentialsSignin` and rethrows everything else — including
  `CallbackRouteError`, which is how an error thrown inside `authorize()`
  arrives. Keep that distinction: it is what made the Prisma fault visible.
- `authorize()` compares the master key with `!==` and **no trim**, so a
  trailing space from a copy-paste fails. The email comparison is lowercased and
  trimmed.
- `@anthropic-ai/sdk` is pinned at **0.40.1**, which predates
  `output_config.effort`, so thinking depth can't be tuned. A chat route like
  Ari's wants `effort: "low"`. Upgrading is a major-version bump and would also
  retire fault 1's workaround.

## Prompt to start the next session

> Continue the Ari polling work on branch `claude/stoic-tesla-2tUY0` of
> `345cayworks/ari`. Read `docs/HANDOVER.md` first — it is current as of the
> third session, when the app went live at https://polling.cayworks.net. The
> immediate jobs are: publish the Retell agent so webhooks are delivered without
> the reconcile button, and smoke-test `lib/ari/brain.ts` by sending the bot a
> plain Telegram message, which has still never run against the live Anthropic
> API. Use `npm run preview` rather than `next dev`, and never run
> `retell:sync --prompt`.
