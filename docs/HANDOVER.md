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
| Results charts and the publication gate | rendered and inspected in a browser; the gate fires on the test poll |
| Question-set templates | four sets on the Setup tab, previewed on a throwaway poll |
| Option rotation | 400-rotation test: scales only reverse, unordered options average dead centre, terminal options never move |
| First real delivery | **Landed, on the wrong campaign.** Sequence 1, `202 ACCEPTED`, test poll, 3 respondents — into `PPM` (4,240 electors), not the 13-elector `STERLING` chosen for it. See below. Gate `quotable: false` with the test notice first and the sample-size reason second; `pct_with_a_view` came back as a real `null` on the no-view answer; `method` as an object; `missing` as an empty array; row and payload agree on id and sequence |
| Campaign delivery, payload side | `npm run check:delivery` — 47 checks; three run the built payload through Politracker's own `parseDelivery`, and fourteen pin all seven size limits against it from both directions |
| `PollDelivery` on Neon | `20261102223000_poll_delivery` applied; 13 columns, 4 indexes, 0 rows; existing data untouched (2 polls, 8 calls, 19 responses) |
| `FeedTarget` on Neon | `20261103T120000_feed_target` applied; 10 columns, 3 indexes, 0 rows; `loadFeedConfig`'s own query checked against the live schema; existing data untouched |
| Worker carrying the sender | deployed, version `2d50aa8a-86a3-45c1-aa31-c8d552099ebf`, 2.14 MB gzipped; Delivery tab, its six redirects, the Settings key form and the test marking all confirmed present in the bundle; `/` and `/admin/login` render, `/admin/polls` and `/admin/settings` redirect rather than erroring |

**Not yet exercised:** `lib/ari/brain.ts` has still never run against the live
Anthropic API — `Message` and `ApiUsage` are both empty. Any plain (non-slash)
Telegram message will do it; `/start` and `/whoami` return before the model is
called.

**Also not yet exercised:** campaign delivery has never made a request. The
code is deployed and the table exists, but `poll_feed` is absent and there is
no `POLITRACKER_FEED_TOKEN`, so the button is disabled and the feed is off.
`POST /v1/poll-results` does answer in production at the receiving end (an
unknown key gets a 401, not a 500, so its tables really are reachable there).

**Not verified, and one click settles it:** the delivery panel has never been
rendered by the deployed Worker, because it sits behind admin auth. Worth
being precise about what that leaves open, because the honest answer is
narrower than "untested" and the shape of the risk is the usual one for this
project — local reads go through the Node client, the Worker's go through the
WASM one, and the two diverge exactly at type mapping.

Already proven on workerd, so not at risk:

- **Enums.** `PollCall.outcome` is read on every Retell webhook in production.
- **An empty scalar array.** `PollBatch.days` is `[]` on the one existing row,
  and the Calls tab's `findMany` takes no `select`, so it comes back whole.
- **A non-empty `text[]`.** `retellBatchIds` holds one item on that same row.

What is left is one branch: a **non-empty `Int[]`**. `int4[]` is a different
Postgres type from `text[]`, so the array machinery is proven but that element
mapping is not. It only occurs when the far end reports `missing_sequences`,
which cannot happen on a first delivery and does not happen at all unless a
delivery is lost. Until then `missing` is `[]`, which is the proven case.

If it does break it breaks late, visibly, and without losing anything: the
delivery has already landed by then and only the panel's rendering of the gap
list would fail. Open a poll's **Delivery** tab to confirm the panel appears at
all — it should say what is missing, with a link to add a campaign key.

Both migrations are applied and the Worker is deployed. What is still missing
is only the key: no campaign key is stored and no `POLITRACKER_FEED_TOKEN`
exists, so the buttons are disabled and say so. The payload builder is
verified against the receiver's real parser; the wire has not been touched.

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

## Deploying: run it from cmd.exe, not Git Bash

`npm run deploy` fails from Git Bash with `[Error: spawn UNKNOWN]`, errno
-4094. OpenNext does not build in-process — `buildNextjsApp` spawns
`npm run build` as a child with `shell: true`, and that spawn is what dies.
The build itself is fine: `npm run build` on its own exits 0 and produces
correct output. Four attempts failed the same way, memory was ruled out (one
earlier failure was a `node::Realloc` crash, but freeing memory changed
nothing), and `COMSPEC` is set with `cmd.exe` present.

What works:

```
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "npm run deploy"
```

Both variables are needed. Without them Git Bash rewrites `/c` as a path, so
`cmd.exe` launches interactively, runs nothing, and **exits 0** — a deploy that
reports success and does not happen. That cost a false "deployed" here, caught
only by grepping the built bundle instead of trusting the exit code.

So verify a deploy by its artifact, not its status:

```
grep -ro "<a string your change added>" .open-next/ | wc -l
```

`--skipNextBuild` is not a way round it: it needs `.next/standalone`, which
plain `next build` does not produce because `output: "standalone"` is absent
from `next.config.ts` — OpenNext injects it when it runs the build itself.
Adding it would route around the broken spawn permanently, which is an option
nobody has taken yet.

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
4. **Check the first rotated call.** Its `PollCall.optionOrder` should hold the
   order that respondent actually heard. The six calls from 25–26 October have
   `null` there, correctly: they pre-date rotation. Don't compare a
   pre-rotation wave against a post-rotation one without saying so — the first
   option in each list will appear to lose a couple of points when nothing
   moved.
5. **Make the first delivery. Only the credential is still missing.**

   Done already: migration applied, Worker deployed at `5ad0790d` with the
   test marking confirmed present in the bundle, and `poll_feed` set to
   `{ enabled: true, endpointUrl: "https://politracker.cayworks.net/v1/poll-results" }`
   — that hostname checked against their wrangler routes rather than assumed,
   since their README names two custom domains and the other is the API's
   older one.

   The ordering mattered and is now spent: the feed was deliberately held at
   `enabled: false` while the deployed Worker predated the marking, because
   enabling it then would have made an unmarked permanent delivery the only
   available action. Both halves are current now, so what remains is one step:

   **Add it under Settings → Campaign result feeds.** Campaign name, feed key
   name (`default` unless delivering to more than one campaign), endpoint, and
   the key itself. Saving over an existing feed replaces its key and
   un-revokes it, which is how to rotate one.

   The CLI route still works and is still the safer of the two, because a
   credential outside the database cannot leak with a dump of it:

   ```
   npx wrangler secret put POLITRACKER_FEED_TOKEN
   ```

   A stored key wins over the environment variable when both exist.

   Run that yourself and paste the key at the prompt. It is deliberately not
   installed by Claude and was never asked for in chat: the key is a
   credential for another platform, and the fewer contexts it has been in the
   better. It travels from their operator to ours directly, through neither
   agent. No redeploy — a secret takes effect on its own.

   **The baseline, read from their database before anything was sent**, so the
   interpretation is written down rather than reasoned about afterwards:

   - `last_used_at` on that key is **null**. If it is set after the first
     delivery, that was us. If it was *already* set before we sent anything,
     somebody else has used the key and both sides should stop.
   - `STERLING` holds **zero deliveries** and **sequence 1 is free**, so the
     allocator will take 1 and will not collide.

   Then **use "Deliver as a test"** on the poll's Delivery tab for the first
   one. There is no staging campaign at the receiving end and **no delete
   path through the API** — but be precise about what that does and does not
   mean, because the stronger version was stated here before and it was
   wrong. Their append-only guarantee is a trigger that refuses `UPDATE`, so
   no figure can be rewritten in place and no correction can pass as a quiet
   edit. `DELETE` was always permitted, for the campaign cascade. So a row
   *can* be removed directly in their database, and one was: they sent a
   zero-data trial on 3 November and deleted it afterwards, precisely so it
   would not sit on sequence 1.

   A delivery of ours is therefore permanent **by their policy, not by
   mechanism**. They have said they would not remove one, and that if it ever
   needed removing it should be our call and recorded as such. Treat it as
   irreversible when deciding what to send — that is what the test marking is
   for, and a row should be honest whether or not it could be undone — but do
   not tell anyone it is impossible to undo. The test button marks the
   delivery unquotable and attaches a sentence saying in plain words that it
   is a trial and not a measurement of opinion, which is what makes a
   permanent row honest rather than merely harmless. The target campaign is
   `STERLING` — one seat, thirteen electors, chosen at their end precisely
   because it is not a live operation.

   Check the sequence, not just the 202. A `200 already_stored` on a first
   delivery means the id was already held, which would mean something is
   wrong. And look at the stored row: `markAsTest`'s wiring is the one part of
   this path no check covers.

6. **Delete the test poll** `TEST — Cayman Pulse (safe to delete)` when done.
   The `Cayman Life` poll beside it is the user's; leave it alone.
7. **`{{agent_name}}`** now appears in the live greeting and Role line. The
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

## Polling quality: the rules the platform now enforces

Three pieces added after the deploy, covering the three places a poll goes
wrong. None of them is cosmetic; each stops a specific failure that is
invisible in the output once it has happened.

**Rotation stops the instrument biasing the answer** (`lib/polling/rotation.ts`).
Reading the same option order on every call hands the first option a few points
it has not earned, and the result looks exactly like opinion afterwards. It
needed no prompt change — the prompt already says to read options in the order
given, so `callTask` rotates the script it sends, which also means single and
batch calls cannot drift apart. An ordered scale is **reversed** for a random
half, never shuffled. An unordered list is permuted with terminal options
(Don't know, Something else, Prefer not to say) pinned at the end. **Yes/No
pairs are left alone**: the stem usually names them in order, so reversing the
list puts the spoken question out of step. Only the survey block rotates;
screeners must read identically and demographics are ordinal or a reference
list. The order heard travels in call metadata to `PollCall.optionOrder`.

**The publication gate stops a correct number being published misleadingly**
(`publicationBlockers` in `components/poll-charts.tsx`). It refuses to call a
result quotable when the sample is under 100, weighting did not converge, the
design effect exceeds 2, or any respondent carries a weight above 5×. Every one
of those signals already existed and was only ever a warning to scroll past.
Per-question bases are flagged at 50 and 100 — a 600-person national sample
leaves about a dozen respondents in the Sister Islands.

**Templates stop a badly-worded question being asked at all**
(`lib/polling/templates.ts`). Four sets, each shipping the reasons for its
wording beside it, because a template that only fills boxes makes it easier to
run a bad poll quickly. Applying one refuses to overwrite existing survey
questions.

Both bases are always on screen — percentages of all who answered, and of those
with a view — so the two can never be silently swapped between, and the
disclosure block assembles everything a published figure should carry from the
poll's own data.

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

## Delivering results to a campaign

The contract is `docs/poll-results-api.md`; the receiving end is built and
applied in Politracker. This side:

| File | Does |
|---|---|
| `lib/polling/delivery.ts` | Builds the payload. **Pure** — no `lib/db.ts`, so it runs under Node |
| `lib/polling/feed.ts` | Config, sequence allocation, the request, the replay. Worker only |
| `lib/polling/publication.ts` | The gate, moved out of `poll-charts.tsx` now that it travels to another system |
| `scripts/check-delivery.ts` | `npm run check:delivery` |
| `scripts/show-delivery.ts` | `npm run show:delivery` — prints the stored row and every blocker in full |
| `app/admin/polls/[id]/delivery-panel.tsx` | The **Delivery** tab: the buttons, and the log of what has gone |

Worth knowing before changing any of it — and deliberately not counted,
because every count written above a list in this document has gone stale
against it:

1. **The sequence assumes this platform is the only writer to that campaign's
   feed.** `allocate` takes `max + 1` over rows *here*, so it is really
   tracking what this side has sent, not what the far end holds. If anything
   else ever delivers into the same campaign, the two desynchronise and the
   first symptom is a 409. There is no way to discover their current maximum:
   the POST response does not carry it, and their listing endpoint needs one
   of their sessions, not our key. So this is a structural assumption rather
   than a tolerance, and the 409 branch is what makes the violation
   diagnosable instead of silent.

   **Open right now: the two sides disagree about sequence 1 of `PPM`.** Their
   operator removed the test delivery from their store, so `PPM` holds zero
   deliveries there. This side still holds the row — sequence 1, `ACCEPTED`,
   `baf25c5c-e30d-4d29-a9d3-81b6a92eeb00` — because nothing told it to let go.

   The consequence is concrete and bad in a familiar way. `allocate` takes
   `max + 1` over rows *here*, so the next delivery to `PPM` claims **2**.
   Their gap list is a set difference over `1..max`, so sequence 1 would
   report as missing for ever: a permanent false report of a lost delivery,
   which is precisely what both sides built that mechanism to mean something
   real. The same false-gap failure as the 422 case, reached by a route
   neither side had considered — a deletion at one end that the other does
   not know about.

   Two ways out, and it is an operator's decision rather than a technical one.
   Delete the row here so sequence 1 is free on both sides, which costs the
   local record that the delivery happened — recoverable from this document
   and the git history, and arguably correct since an `ACCEPTED` row now
   asserts something false. Or keep it, deliver as 2, and accept a standing
   gap at 1 that does not mean what a gap means.

   There is no third option: nothing in the contract marks a sequence as
   withdrawn, and the allocator keys off `max(sequence)` regardless of status,
   so a status change would not free the number.

   It is now also an agreement, which is weaker than a mechanism and worth
   more than nothing: their end has undertaken not to write to a campaign's
   delivery feed again, calls the 3 November trial the one exception, and
   says it would ask first and expect a refusal. Treat it as a commitment
   that can be checked against, not as a guarantee — if a 409 ever arrives
   naming a delivery we have no record of, that undertaking is what has
   broken, and it is worth asking them before assuming a bug here.

   They also considered exposing `highest_sequence` on the response, which
   would turn this from detectable-after-collision into detectable-before,
   and decided against building it on the grounds that it is a second
   mechanism for a hazard that does not currently exist. The option is open:
   they already compute `max(sequence)` inside their gap check, so it is a
   one-line change on their side, to be asked for if a second writer ever
   appears rather than in advance.

   It nearly happened. Their session was authorised to inject a test delivery
   of its own to close its read-path gap, realised it would take sequence 1,
   and stopped — our empty table would have allocated 1 too. Our 409 handling
   would have reported it correctly, but the first real delivery would have
   opened with a failure and the permanent row would have carried their
   wording instead of our test marking.

2. **The row is written before the request goes out.** That is what makes a
   sequence durable: a delivery that fails keeps its number and its payload,
   so a replay re-sends the same bytes rather than rebuilding from data that
   has moved on. Rebuilding would deliver revised numbers under an old
   sequence, which is the quiet edit both ends are append-only to prevent.
3. **The field names and limits are a copy of the receiver's parser**, because
   there is no shared package between two repositories. A copy drifts. The
   `--parser` flag on the check script is what catches it:

   ```
   esbuild <politracker>/packages/store-postgres/src/feed.ts --bundle      --platform=node --format=cjs --outfile=feed.cjs --external:pg
   npm run check:delivery -- --parser ./feed.cjs
   ```

   Run that after any change to either end's field set. It already earned its
   keep: it caught the builder emitting a `with_a_view` base larger than the
   sample that answered at all.

   It also pins all seven size limits against their parser from both
   directions — a payload at each limit must be accepted by both, one past it
   must be refused by theirs. One direction alone proves nothing: if ours were
   stricter, deliveries would be refused here that they would have taken, and
   if ours were looser a delivery would pass locally and be refused on the
   wire. They had checked the seven by eye and reported agreement, which is a
   prose claim about code — the thing that has gone wrong repeatedly here — so
   it is a check now instead.

   **Without `--parser` the script says so and does not claim to have
   passed.** It used to print "All checks passed" after skipping the only part
   that compares anything against the other end, which made the script an
   instance of the failure it exists to catch. It now states that the contract
   was not checked, and when a parser is supplied it prints how old the bundle
   is, a bundle being evidence frozen at the moment it was built. It still
   exits 0 either way — the builder's own checks really did pass, and there is
   no CI here to mislead. If this is ever wired into CI, pass `--parser` or the
   contract goes unverified behind a green build.
4. **A test delivery is marked in the payload, not merely intended.**
   `TEST_DELIVERY_BLOCKER` is prepended to the gate's blockers, which forces
   the delivery unquotable and carries a fixed sentence saying it is a trial
   and not a measurement of opinion. The sample-size blocker alone was not
   enough: "the sample is 6" is true and still lets a reader conclude it was
   real fieldwork with few respondents. The wording is fixed rather than
   operator-supplied because a delivery cannot be withdrawn and it has to read
   correctly to someone who was not here.

   `redeliverRefused` recovers the intent from the stored payload's blockers
   rather than from a column, so a re-send of a test stays marked as one.

   **Not covered by `check:delivery`:** the checks verify what a payload
   carrying that blocker does — unquotable, notice first, accepted by their
   parser — but not that `markAsTest` is what produces it, because that path
   goes through `feed.ts` and needs a database. The flag's wiring is verified
   only by the first delivery actually being marked. Look at the row.

5. **A refusal consumes no sequence; a failure might have.** A sequence is
   spent if and only if the far end answered 2xx — a 401 or 403 returns before
   the payload is read and a 422 before it is stored. So a `REFUSED` row is
   rebuilt and re-sent under the number it already holds, leaving no gap, and
   that is what "Fix and send again as #n" does. A `FAILED` row may have
   landed, so the only repair offered is the stored bytes again; rebuilding
   there could come back `200 already_stored`, which would mean the far end
   kept its copy and these numbers were dropped. `send` treats that 200 as a
   failure rather than a success for exactly that reason.
6. **A 409 is ours to fix; a 500 is theirs.** A 409 means the far end already
   holds that sequence under a different delivery, which has one cause: a
   delivery recorded here as refused actually landed. `held_by` names it, and
   `send` corrects that row to ACCEPTED rather than leaving a landed delivery
   marked refused — which is how a gap gets reported that was never a gap. It
   is recorded as DUPLICATE, not FAILED, because a FAILED row offers "send it
   again unchanged" and that would re-send into a permanently spent number.

   **Both sides are now on current builds and most of their half is now
   measured rather than argued.** On 3 November they sent a zero-data trial
   through their own live endpoint and read it back: 202 from the Worker, all
   three tables written, `method` returning as a jsonb object rather than
   text, blockers and answers as arrays, `pct_with_a_view` as null rather than
   the string "null", the uuid-array parameter and the window function and the
   gap set-difference all exercised against real rows, and `last_used_at`
   written through `ctx.waitUntil`.

   **The 409 itself has never fired, at either end.** It is present by
   provenance, not by observation: the live deployment id matches what their
   deploy printed, the tree it was built from contains the handler, and a
   sibling change from the same bundle (`last_used_at`) is proven
   behaviourally — so the code is serving. But firing it needs a sequence
   already held, and there have been none. Their own correction, and worth
   keeping the distinction rather than collapsing it as both of us had.

   The same is true of the handling on this side. Nothing has exercised the
   `send` 409 branch: the payload checks cannot reach it, and it needs a live
   conflict. If a first delivery ever needs retrying under a different
   `delivery_id`, that will be the first time either half of that path runs.

   **`npm run show:delivery` has only ever run against an empty table.** Its
   "nothing stored" path is verified; its populated path is not, and the
   first delivery is the first run of both it and the thing it reports on. A
   `--demo` mode formatting a synthetic payload was considered and rejected:
   it would exercise the string formatting while implying coverage of the
   part that matters, which is whether a null inside the stored jsonb comes
   back as a null. Exercising that needs a real row, and writing one to
   production was refused as a shared-resource change — correctly, since
   nobody had authorised it. So read its first output as evidence about
   itself as well as about the delivery.

   Two other things are not measured, and silence on them is not success:
   `GET /v1/polls` needs a signed-in session, so the *read* through Hyperdrive
   on workerd is inferred from the write having used the same client on the
   same path — only a person opening that page closes it. And `markAsTest`'s
   wiring is proven only by looking at the stored row of a real delivery.

   What *is* now guarded rather than observed once: a null inside jsonb coming
   back as a null and not the string. They pinned it against real Postgres
   after this side asked, with the test verified to discriminate by mutating
   the mapping to return text. That was the one failure in the contract that
   would have survived every type check on both sides and then looked like a
   result.


7. **The feed key is stored encrypted, and the key to it is not in the
   database.** `docs/poll-results-api.md` settled that the token belongs in an
   environment variable rather than a record, and the reasoning was right: a
   credential in a row turns up in a dump, a log line or an export. It became
   a row anyway, because an environment variable holds one value and a
   platform delivering to several campaigns needs one key each — so the
   reasoning is answered rather than dropped. `FeedTarget.tokenSealed` is
   AES-GCM ciphertext; the key is derived by HKDF from `PHONE_HASH_SECRET`,
   which already exists everywhere and is documented "never change once in
   use".

   Two consequences worth knowing. **Rotating `PHONE_HASH_SECRET` makes every
   stored key unreadable** — recoverable by pasting them again, and the panel
   says exactly that rather than failing at delivery time. And unlike the
   receiving end, which stores `token_sha256` and never the token, this side
   has to *present* the key, so a hash is not an option. Encryption is the
   best available here, not the best imaginable.

   **Where a key comes from, as of 3 November.** Ours was issued by hand at
   the far end and handed over person to person. They have since built an
   invitation flow: a campaign manager invites a pollster by email, and the
   pollster collects a key from a single-use link. The key is minted when the
   link is *claimed*, not when the invitation is sent, so an unopened
   invitation leaves no credential in existence and withdrawing an invitation
   withdraws the key it produced. Our key is untouched by any of it. If a
   fresh one is ever wanted, that route works and the old one can be revoked.

      `npm run check:secret-box` has 16 assertions, each paired with the thing
   that would let it pass by accident: "it opens" beside "it does not open
   under a different secret", "the ciphertext differs each time" beside "both
   still open", and the fingerprint checked not to depend on the secret, since
   an operator compares it against what the far end reports.

8. **Breakdowns are not implemented, deliberately.** `tallyResponses` has no
   by-group split, so there is no crosstab source to deliver. The payload type
   carries the shape and the limits already cover it, so a crosstab engine has
   somewhere to plug in. They are optional in the contract, so nothing is
   broken by their absence — but the receiving end would prefer them, and a
   campaign that cannot see a district at all will ask for it by other means.

### Compare key fingerprints before a first delivery

The first delivery went into the wrong campaign, and the check that would
have caught it existed and nobody ran it.

A `STERLING` key was issued by hand and handed over, `STERLING` having been
chosen because it holds 13 electors and is plainly not a live operation. But
their operator then minted a *fresh* key from their own Settings page two
minutes before the delivery, with `PPM` open rather than `STERLING`, and
passed that one along. So the test row permanently holds sequence 1 of a real
campaign's series, in a campaign with 4,240 electors. The hand-issued
`STERLING` key is still unused.

It is not a disaster, and the reason is the test marking: the row is
unquotable, carries the notice in plain words, and renders as withheld at
their end — verified against the real row through their actual renderer, not
a fixture. That is the thing built for a case nobody intended, working in it.
Whether the row stays is their operator's call on their own campaign.

**`FeedTarget.tokenFingerprint` is the check and it was built for exactly
this.** Its own comment says it is "enough to compare against what the other
end reports for the key it issued, which is the only question an operator
actually has". Neither side compared it. Before any first delivery to a
campaign, ask the issuing end for the fingerprint of the key it issued and
confirm it matches the one shown on Settings.

It is now asked for in the UI rather than left to this document: the Delivery
tab shows the fingerprint and asks for it to be confirmed with the campaign,
but only while that target has no deliveries — the one moment it can still be
acted on, after which nagging is noise. Writing the step down was not enough
once; a prompt at the moment of action is the version that does not depend on
anyone having read this.

Both sides made the same error in opposite clothes, which is the part worth
keeping. This side had the mechanism and did not run it. Their side had told
their operator twice, in writing, to open the right campaign first — then
verified the arriving payload exhaustively, every field and null and eight
renderer assertions, and noticed the campaign only because a script happened
to print its name in a header. Not by checking. **Both were busy verifying the
thing they had decided to verify**, which is how a signal sitting in plain
view goes unread.

The label was the other signal and it was dismissed. The feed was saved as
"PPM - Campaign Office" while every document said `STERLING`, and that
mismatch was explained away here as cosmetic — true of the mechanism, since
the campaign is determined by the token and not the label, and wrong as a
reading, because the label was the only visible trace of which key was in
hand. A field that cannot affect behaviour can still be the only evidence.

**One non-discrepancy, so nobody chases it.** Our `sentAt` is about 1.6
seconds *after* their `receivedAt`, because `sentAt` is recorded once the
fetch resolves, which is necessarily after they have stored and answered.

### A commit message is immutable, so keep out-of-tree claims out of it

Audited every commit on this branch against the files it actually contains,
after noticing that a failed heredoc edit followed by `git add && git commit`
on the next line commits anyway. No message describes in-tree work missing
from its commit — but that held by luck of mechanism, not design: a failed
edit stages nothing, so the commit fails visibly. With anything else already
staged, which is routine, it would have shipped a message describing work that
is not there, and that is unfalsifiable from the log afterwards.

The rule, since the mechanism is not the protection: **chain the edit to the
commit, or put them in separate calls so a failure stops the turn.** A
traceback sitting above a successful commit line in long Bash output reads as
success, which is how it survives.

The audit did find a milder instance of the same family. Two commit messages
assert state that git cannot carry — `poll_feed`'s value — and one of them
(`156e754`, "poll_feed is now set") was reversed by `6d63fcd` within the hour.
A commit message cannot be corrected, only contradicted by a later one, so
that claim is permanently wrong in the history. Out-of-tree state belongs
here, where it can be updated, not in a message that freezes it.

### How the faults in this integration were actually found

Worth recording because the obvious economy, once this is working, is for each
side to stop reading the other's code — and that is where the next one gets
through. Corrections crossed in both directions throughout; no count is given
because whether a redundant guard that never fired or a design argument one
side won counts as an error is a definitional question, and a tally's only use
is to someone deciding where to spend effort. Nothing was caught by either
side reading the other's summary of its own work.

Four mechanisms did the work, and the first is the one most easily written out
of a story like this:

- **A strict validator, running unattended.** Their `parseDelivery` refuses a
  with-a-view base larger than the number who answered at all
  (`feed.ts:496`) — arithmetic nobody asked them to check, in a validator
  written for a different purpose. It caught this builder emitting exactly
  that: a percentage of a base bigger than the poll. The harness was ours and
  the check was theirs, and it is the one fault in the whole exchange found by
  code rather than by a person. Any version of this record that says "none
  caught by a test" argues against the thing that worked without supervision —
  which is what the first draft of this section did.
- **Reading their implementation instead of their report.** Found a
  `touchFeedKey` that was defined, exported and called from nowhere, under a
  documented promise that key use was logged.

  The inverse of this is a failure rather than a mechanism, and it cost the
  worst claim in this file. Their `docs/poll-feed.md` said "no delete path
  through the API; the only removal is dropping the campaign, which takes its
  register with it". The first clause is true of their API; the second was
  written as true of their system and is not. It was read here, copied into
  this document, and stated to the user as fact — three hops, each of which
  looked like verification because the previous one was written down. Nobody
  checked until they violated it themselves to free a sequence.
  An interface property written as a system property does not read as scoped,
  so it travels unscoped.
- **The other side refusing a conclusion stated as settled.** A 422 left a
  permanently gapped sequence here, and it was written off as acceptable.
  Declaring it fine is what stopped the checking; it took an outside reader
  with no stake in the claim to reopen it.
- **Rereading our own code with a different purpose in mind.** A fresh
  `delivery_id` on a corrected re-send broke the replay invariant added in the
  same commit. Neither typecheck nor any test could see it, because both
  halves were internally consistent.

And one that caught both sides late: **risk gets overstated in the direction
that feels responsible.** They reported a bug as live when it was committed
and already fixed in the same undeployed batch; this side believed it, built a
branch for a response that cannot arrive, and wrote "the only build I could
actually meet" into a commit message to justify it. Dead defensive code is not
free — it reads as evidence that the thing it guards against happens.

Two more worth carrying forward. **Redundant defences are not free** — the
fresh id and their crude minimum-sample check were both extra protection for
something already handled properly, and both introduced a fault the thing they
duplicated did not have. And **a right conclusion resting on a wrong reason is
the most durable error**: nothing downstream fails, so nothing sends anyone
back to look, and the next reader reasons from the stated reason rather than
the behaviour. The spec claimed only the sequence was constrained when
`delivery_id` is constrained too, which is what makes reusing an id safe rather
than merely allowed.

## Map of the code

- `lib/polling/config.ts`: Retell tool definitions (`record_answer`, `add_to_do_not_call`, `schedule_callback`, `end_call`, optional `transfer_call`) and post-call analysis fields. This is the single source of truth for `scripts/retell-sync.ts`.
- `lib/polling/retell.ts`: Retell API helper and signature check (`x-retell-signature`, `v=<ms>,d=<hex>`, HMAC-SHA256(apiKey, body+ms), 5-minute window). It matches `retell-sdk` 6.2.12's `verify`.
- `lib/polling/calls.ts`: links calls to polls (metadata `poll_id` / `batch_id`, or dynamic variable `poll_id`, or agent ID). Also function handlers, webhook ingestion, `derivePromptVariables`, `placePollCall`, `createPollBatch` (chunks of 1,000, parallel, timezone `America/Cayman`) and `reconcilePollCalls`.
- `lib/polling/phone.ts`: **`tryNormalizePhone`** is strict (7-digit Cayman, or NANP with area and exchange codes starting 2-9) and returns `null`; it gates the two places calls are placed. `normalizePhone` stays lenient for recording and hashing inbound numbers, so ingestion can't be broken by an odd number. Before this, an 11-digit typo became `+33453249000` and was dialled — France.
- `lib/polling/results.ts`: `POLL_VARIABLES` (the admin setup form is generated from this list), stats, tallies (display order comes from "(A / B / C)" in the question text — the canonical order, not whatever any respondent heard, which is what lets rotation work without disturbing the results).
- `lib/polling/rotation.ts`: per-respondent option rotation and the scale/terminal-option lexicons. `isNoViewOption` is the narrower "no view" set used for the "those expressing a view" base; `isTerminalOption` adds Something else / Other / None of these, which must stay last but *are* a view.
- `lib/polling/templates.ts`: the four question sets and the reasoning shown beside each.
- `components/poll-charts.tsx`: charts, the publication gate and the disclosure block. Plain HTML marks, no charting library — see the gotcha on bundle size.
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
- Charts use **no charting library**. The Worker had about 850 KB of headroom under the 3 MB limit and Recharts would have taken most of it; the whole chart layer cost 4 KB. Marks are plain HTML, so chart text can never be clipped or scaled oddly.
- The chart palette was **computed, not chosen**. The brand's own sea↔amber pair was tried first as the diverging ramp and failed: its two amber steps measure ΔE 10.4 to normal vision, under the floor of 15, so most people could not tell "Dissatisfied" from "Very dissatisfied". The shipped ramp (`#1c5cab → #6da7ec → #f09b7a → #c2362f`) measures 22.7 normal and 17.0 under colour-vision deficiency on the adjacent pairs. Three categorical slots and both inner diverging steps sit under 3:1 contrast on white, which is why every bar is directly labelled and the counts stay as a table — that relief is what makes the low-contrast fills legitimate. If you re-colour these, re-run the check rather than eyeballing it.
- Rotation records as well as rotates. Rotating without a record of what was read would make the data **less** auditable, not more, which is why `PollCall.optionOrder` shipped in the same change.
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
- **The WASM Prisma client does not work under Node.** Confirmed by running it:
  a query through `lib/db.ts` outside the Worker fails with "The loaded wasm
  module was unexpectedly `undefined` or `null` once loaded". So **nothing that
  runs under Node may import `lib/db.ts`** — not `next dev`, not a script. That
  means `lib/ari/brain.ts` and `lib/polling/calls.ts` cannot be exercised
  locally at all; test them on the Worker. A script needing the database builds
  its own client from `@prisma/client` (not `/wasm`) with a `PrismaPg` adapter,
  the way `prisma/seed.ts` does.
- A script run as `npx tsx foo.ts` gets **no `.env.local`** and no top-level
  await (tsx treats `.ts` as CJS here). Use
  `node --env-file=.env.local --import tsx foo.mts`. Without the env file,
  `PrismaPg` is handed an undefined connection string, `pg` falls back to
  localhost, and the failure reads `ECONNREFUSED` — which looks exactly like
  the database being down rather than a missing flag.
- **esbuild renames top-level identifiers**, so grepping the bundle for a
  function name to check a change shipped returns 0 and looks like a failed
  deploy. Grep for a string literal that exists only in the module instead.
- **`information_schema` queries fail through the driver adapter** —
  `column_name` is Postgres's `name` type and the adapter reports
  `UnsupportedNativeDataType`. Cast to `::text`.
- To look at an authenticated admin page without typing the master key into a
  form, log in programmatically against the local Worker, fetch the page with
  that cookie, inline its stylesheet and open the file. That is how the charts
  were checked; it caught two layout bugs the type checker could not see — a
  whisker striking through its own value label, and a near-full bar putting its
  label on the surface instead of the bar.

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
> third session, when the app went live at https://polling.cayworks.net and
> gained option rotation, results charts with a publication gate, and
> question-set templates. The immediate jobs are: publish the Retell agent so
> webhooks are delivered without the reconcile button, and smoke-test
> `lib/ari/brain.ts` by sending the bot a plain Telegram message, which has
> still never run against the live Anthropic API. Use `npm run preview` rather
> than `next dev`, never run `retell:sync --prompt`, and when you change a
> chart or a question template read the reasoning in "Polling quality" first —
> several of those choices look arbitrary and are not.
