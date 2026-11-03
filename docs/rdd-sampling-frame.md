# The random-digit-dial sampling frame

Polimeter can draw a probability sample of Cayman mobile numbers instead of
dialling a list somebody uploaded. This document is why that matters, how it is
wired, and — at length, because it is the part a later change is most likely to
break — exactly what Polimeter is allowed to tell the frame.

## Why

`lib/polling/weighting.ts` and `lib/polling/results.ts` already compute
cooperation rate, effective n, design effect and margin of error. Every one of
those is only strictly defined over a sample with **known selection
probabilities**. A list of numbers somebody uploaded has none: whatever
produced it selected people by some unknown process, so there is no sampling
distribution for a margin of error to be a width of.

The statistical layer was therefore sound and sitting on nothing. A draw from
the frame gives it a frame underneath: every number in a 470,000-number
universe has an equal and known chance of selection, so the figures published
mean what a reader takes them to mean.

## The frame

A separate Cloudflare Worker, outside this repository, deployed at
`cayman-rdd.delicate-wood-499a.workers.dev`. It holds ~100,965 numbers drawn
uniformly from 47 regulator-confirmed Cayman mobile NXX blocks, out of a
470,000-number universe, verified uniform across all four operators. Its API is
four routes, bearer-authenticated:

| Route | What it does |
| --- | --- |
| `POST /api/samples` | Draws an oversampled batch for a target number of live respondents |
| `GET /api/samples/:id/export.csv` | The dial list: `e164, operator, carrier_name, disposition, attempts, last_attempt_at` |
| `POST /api/samples/:id/disposition` | Records one number's outcome |
| `GET /api/stats` | Frame counts and the measured assignment rate |

Credentials are configured on **Settings → Random-digit-dial sampling frame**,
sealed with the same AES-GCM scheme as a campaign feed key
(`lib/polling/secret-box.ts`), or as the Worker secrets `RDD_BASE_URL` and
`RDD_API_TOKEN`, which is how the Retell credentials are held. A saved row wins
over the environment.

## Seven in ten of any draw is a dead number

This is the most surprising operational fact about the feature and it is not a
defect.

Paid phone-screening does not work for Cayman, and this was measured rather
than assumed. Twilio Lookup returned `mobile` for **187 of 187** randomly
generated Cayman numbers, including the 345-919 range, which holds no
subscribers at all. hlr-lookups.com answered out of a portability database
(`MNP_DB`) rather than querying the live network. Both services resolve per
*block*, not per *number*, and the blocks are all genuinely allocated to
operators — so neither can distinguish a live Cayman mobile from an unassigned
one inside an allocated block.

A number's liveness can therefore only be established by dialling it. **The
dial outcome is the screening step.** That is why roughly seven in ten numbers
in any draw ring out on the first attempt, and why a draw is oversampled
against the frame's own measured assignment rate instead of a guessed
multiplier.

Do not propose re-adding a paid screening API. It was tried, it was paid for,
and it answered the wrong question.

## How a draw flows

1. **Settings** holds the frame's URL and bearer key.
2. **Calls tab → Draw a random sample** takes a target number of *live
   respondents* — not interviews, not numbers — plus the usual calling window,
   days and an optional seed.
3. `drawSampleForPoll` (`lib/polling/rdd-frame.ts`) posts the draw, reads the
   dial list, and hands the numbers to the existing `createPollBatch`.
4. `createPollBatch` applies `tryNormalizePhone`, the do-not-call list and the
   already-called filter, then queues Retell batch calls exactly as an uploaded
   list would be.
5. The batch row records the draw's provenance: sample id, seed, target,
   oversample size, candidate pool, shortfall, the assignment rate used, and a
   batch-level count per operator.
6. When the calls have finished, **Report dead numbers to the frame** sends
   back frame hygiene. Only that.

### `tryNormalizePhone` stays in the path

The frame's output is valid E.164 by construction, so the format gate is
redundant — and it is applied anyway. Two reasons. It costs two regexes. And a
gate applied only to input somebody already doubts is a gate that will be
absent on the day the trusted source is wrong; "+1345" from a worker that was
redeployed an hour ago is exactly the kind of trusted source that is
occasionally wrong. This is the gate that caught an 11-digit typo being dialled
to **France**. Anything it rejects lands in the batch's `skippedInvalid` count
and is reported on the page as "rejected by the format gate", because a
non-zero count there means the frame changed shape rather than that an operator
mistyped something.

### The seed

Passed to the frame and stored on the batch. It is what lets a published draw
be reproduced afterwards and shown to have been random rather than chosen.
Worth setting on anything intended for publication.

## What Polimeter tells the frame, and why it is so little

The canonical statement of this is the comment block headed **THE WRITE-BACK
CONTRACT** at the top of `lib/polling/rdd.ts`, which is the file somebody
editing the payload will have open. This section is the same argument for
somebody reading the docs.

### The threat

Polimeter stores a respondent's number only as an HMAC (`PollCall.phoneHash`,
`hashPhone` in `lib/polling/phone.ts`). There is no plaintext telephone column
anywhere in the schema except `PollCallback.phoneNumber`, which exists to dial
back and is blanked the moment it is used. Every respondent is told, in the
agent's opening line, that their answers are anonymous.

The frame holds the plaintext numbers. So the two datasets are **one hash
apart**: anyone holding both, plus `PHONE_HASH_SECRET`, can hash the frame's
plaintext and join them.

The anonymity promise therefore does not rest on the hash. It rests on the
frame never learning anything about a respondent's *answers*, or about which
poll response came from which number. Keep that true and the join yields
nothing worth having. Break it once and the promise is retroactively false for
every interview already conducted — including the ones conducted before the
change.

### The payload

Exactly two values ever leave for the frame:

| What Polimeter knows | What the frame is told |
| --- | --- |
| The number failed to dial at all | `disconnected` |
| The number existed — rang out, engaged, refused, hung up, completed a full interview | one single live value, by default `live` |
| Anything still in progress, or no evidence either way | *nothing is sent* |

A refusal and an eight-minute completed interview send **byte-identical**
payloads. That identity is the mechanism, not a coincidence of today's mapping.

Not sent: completes, refusals, partials, screen-outs, answers, verbatims,
sentiment, summaries, consent, question progress, do-not-call status, call
duration, or a timestamp of our choosing. "This number completed a poll" is
withheld too — it is participation data about an identifiable person and the
frame has no use for it.

The division of labour, stated so that a later change has to argue with it:
**Polimeter owns outcomes, the frame owns hygiene.** The frame needs to know
which numbers are not worth drawing again, and roughly what share of the
universe is live. Both are answered by assigned/not-assigned. Every richer
disposition it might like is a disclosure this side cannot make.

### Why the live side is reported at all

Reporting only the dead numbers would leak strictly less. It was considered and
rejected: the frame's measured assignment rate is computed from the
dispositions it holds, so a one-sided write-back would drive that rate towards
zero and every future oversample would be computed from a false denominator.
The frame would grow steadily worse at the one job it has.

One generic live value is the smallest thing that keeps the rate honest. It
asserts that the number exists and nothing else.

A cleaner split was looked for, as the task asked: have the frame hold no
outcome at all and let Polimeter publish an aggregate assignment rate. It does
not work — the frame must suppress *specific* dead numbers to stay usable, and
a specific number cannot be named from an aggregate.

### Four mechanical guards, not just a comment

A contract stated in prose is one a later edit can widen without noticing. So:

1. **A narrow input type.** `frameSignal` takes `DialEvidence`
   (`{ outcome, disconnectionReason }`), not a `PollCall`. It cannot leak an
   answer or a summary because it is never handed one, and an edit that wanted
   to would have to widen that type first — a visible change in a reviewed
   diff.
2. **A narrow `select`.** `reportFrameOutcomes` reads call rows with a
   three-field `select`. Not for performance: so that nothing else is in scope.
3. **An allowlist, not a text field.** The live value is configurable, because
   the frame's accepted vocabulary could not be read when this was written and
   may need correcting. It is a `<select>` over `LIVE_DISPOSITIONS`, and a
   value outside that list is silently replaced by the default. A free-text box
   is how somebody types `completed` one afternoon and the frame starts
   learning who answered. `answered` is excluded on purpose despite being the
   likeliest spelling at the far end: a number that rang out unanswered is
   still live, so reporting it as answered would be both a disclosure shape and
   a lie.
4. **A test that counts the values.** `scripts/check-rdd.ts` pushes every
   `PollCallOutcome` against every dial reason through the mapping and asserts
   that the set of values it can emit has **size two**. Widen the payload and
   that check fails.

### No plaintext number is ever stored here

The obvious implementation of the write-back is a table mapping `phoneHash` to
the number it came from, so outcomes can be looked up later. That would put the
join key and the answers in the same database, which is the one thing this
schema does not do anywhere.

Instead, `reportFrameOutcomes` fetches the plaintext numbers from the frame,
hashes each with the same keyed hash the dialler used, matches them against the
call rows' `phoneHash`, and holds them only for the length of that one request.

Progress is tracked at the **frame**, in its own `disposition` column, read
back from the dial list: a row that already carries a disposition is skipped. A
run reports at most `MAX_DISPOSITIONS_PER_RUN` numbers, because a Worker has a
bounded subrequest budget, and the operator presses the button again. That is
why no progress state is kept on this side — keeping it would require storing
the numbers.

### The trunk-fault guard

`dial_failed` is what an unassigned number looks like. It is also what a broken
SIP trunk, an exhausted concurrency limit and a caller number Retell cannot
place +1 345 calls from look like, and those are indistinguishable from a dead
number *per call*.

Per call it hardly matters: suppressing one number costs almost nothing. Across
a whole batch it matters a great deal — a trunk that was down for an hour would
report every number it touched as `disconnected` and permanently burn several
hundred live numbers out of the universe, with no record of which.

So if more than `IMPLAUSIBLE_UNASSIGNED_SHARE` (95%) of a batch's decided calls
failed to dial, and there are at least `GUARD_MIN_CALLS` of them, the
write-back refuses to send anything and says why. The honest figure for this
frame is near 70%. A batch at 97% is a fault at this end, not a run of bad
luck.

## What this does not do

There is **no linkage to the electoral register**, and none may be added. A
poll here is an anonymous sample of a population; RDD numbers carry no elector
identity. That is the whole reason RDD belongs in Polimeter rather than in the
sibling constituency-casework platform, where a canvass is identified by design
— a named elector plus a political opinion, which is sensitive personal data
under the Cayman DPA.

Operator is kept only as a batch-level count. No per-number carrier is stored:
in a jurisdiction this small, a carrier attribute sitting beside a
respondent's answers is a quasi-identifier, and the frame was already verified
uniform across all four operators, so there is nothing a per-respondent carrier
buys a poll.

## Files

| File | What it holds |
| --- | --- |
| `lib/polling/rdd.ts` | Pure: HTTP client, CSV parser, the disposition mapping, **the write-back contract** |
| `lib/polling/rdd-frame.ts` | Database-facing: credentials, the draw, the write-back |
| `app/admin/polls/[id]/rdd-panel.tsx` | The draw form on the Calls tab |
| `app/admin/polls/actions.ts` | `drawRddSample`, `reportFrameDispositions` |
| `app/admin/settings/page.tsx` | Frame URL, sealed key, live-disposition value |
| `scripts/check-rdd.ts` | `npm run check:rdd` — 41 assertions, including the one that holds the payload shut |

## Operational notes

- Rotating `PHONE_HASH_SECRET` makes the stored frame key undecryptable, the
  same as a campaign feed key. Recoverable — paste it again — but not obvious.
  It also breaks every `phoneHash` already recorded, which is why the handover
  says it can never change now that poll calls exist.
- The live disposition value is **confirmed rejected by the worker**, probed
  2026-11-03 with an invalid value, which the worker refuses with 400 and an
  enumeration of what it takes:

      {"error":"Invalid disposition","allowed":["not_attempted","complete",
       "refused","partial","no_answer","busy","voicemail","callback",
       "disconnected","ineligible","language_barrier"]}

  `disconnected` is on that list, so the unassigned half is sound. None of
  `live`, `assigned`, `in_service`, `active` or `ring` is, and every accepted
  value besides `disconnected` and `not_attempted` names an outcome — four of
  them are strings `check:rdd` asserts can never reach the allowlist.

  **The one-line change belongs on the worker: add `live` to its accepted
  list.** Picking one of its existing values would mean lying (`complete` for
  a refusal, `no_answer` for a completed interview) or disclosing the outcome,
  and the contract forbids both. Nothing changes on this side.

  **Do not run a real wave until the worker takes it.** The live half is
  rejected per number, so the frame would resolve only disconnected numbers —
  worse than learning nothing. `GET /api/stats` reports an assignment rate it
  measures from resolved numbers once 100 or more exist ("Using the 0.28
  starting estimate; only 0 numbers have been resolved by dialling so far
  (needs 100+ to measure)"). A resolution set that is entirely disconnected
  drives that measured rate toward zero, and the oversample for the next draw
  is computed against it.
- The draw is capped at `MAX_TARGET_LIVE` (1,200) live respondents, because the
  oversample behind that is already around 4,000 numbers and
  `MAX_BATCH_NUMBERS` is 5,000.
