# Poll results API — delivering a poll to a campaign

Contract between the polling platform (**provider**, polling.cayworks.net) and
Politracker (**receiver**, politracker.cayworks.net). Written from the provider
side because the provider publishes the contract; the receiving half is
Politracker's to design against it.

Status: **the receiving half is built and applied** (politracker migration
`0015`: `campaign_feed_key`, `poll_delivery`, `poll_figure`, `poll_breakdown`).
The sender is built (`lib/polling/delivery.ts`, `lib/polling/feed.ts`), and
`POST /v1/poll-results` answers in production. No key has been issued and no
delivery has been made, so nothing is live end to end.

Where this document and the receiver differ, the receiver is what a delivery
actually meets. Everything below marked *(receiver)* was read out of its
implementation rather than agreed in advance.

## The shape, and why it is this shape

A campaign asks for a poll in conversation. The poll is **created and
configured in the polling platform**, by the pollster. When results are ready
they are **delivered to that campaign**, and that is the only machine link
between the two systems.

One direction, one purpose, one credential.

Configuration deliberately does not cross. A campaign that could define its own
questions through an API would, sooner or later, define a leading one — and the
number that came back would carry the pollster's name. Keeping the questionnaire
with the pollster is not a technical constraint; it is the thing that makes the
result worth anything. The separation belongs in the architecture rather than in
anyone's restraint.

## What crosses, and what never does

**Crosses:** aggregate results. Toplines per question, optional breakdowns by
district or demographic, each with its base, its margin of error, and whether
the pollster considers it fit to quote.

**Never crosses, in either direction:**

- Respondent-level rows of any kind.
- Phone numbers, including the HMACs the polling platform stores instead of
  numbers. They are one-way by design and there is no reason for the campaign
  to hold them.
- Call recordings, transcripts, or per-call analysis.
- Politracker's register of electors, constituents, or canvass rows going the
  other way. The polling platform must not become a place where named electors
  are held.

That list is part of the contract, not an understanding. Every respondent is
told "your answers are anonymous and combined with hundreds of others" — a
sentence now quoted on the polling platform's own landing page. An integration
that carried respondent detail into a campaign's records would make that false
retrospectively, and political opinion is sensitive personal data under the
Cayman Data Protection Act.

If a campaign wants opinion attached to a named elector, that is canvassing:
collected with the person knowing who is asking and why. Different instrument,
different consent. See `docs/voice-canvassing-scope.md` in Politracker.

## Authentication

Politracker already has the right pattern. `office_api_token` stores
`token_sha256` and never the token itself, with `label`, `last_used_at` and
`revoked_at`; a dump of that table lets nobody in. Follow it exactly.

**Do not reuse `office_api_token` itself.** That table is the *device*
principal, and routes gate on it — a pollster token living there would inherit
whatever a canvasser's phone can do. A sibling table, or a `kind` column that
every route checks, keeps the capability sets from bleeding.

The token is:

- **one per campaign** — a token identifies which campaign results land in, so
  a token cannot deliver into a campaign it was not issued for;
- **write-only** — it reaches exactly one endpoint and cannot read anything;
- **revocable**, and revocation takes effect immediately;
- **logged** on use — with two caveats that were not true when this line was
  first written, and one that stayed untrue for a while after.

  The claim was false when agreed. The receiver had a `touchFeedKey` that was
  defined, exported and called from nowhere, so `last_used_at` could only ever
  have been null. Checked at the commit in question rather than taken on
  report. It is fixed at their end (`ab223d0`, recorded through
  `ctx.waitUntil` so a failed bookkeeping write cannot fail a delivery), and
  as of 3 November it is deployed **and observed**: a trial delivery set
  `last_used_at` one second before its key was revoked, which also shows the
  detached write landing rather than being dropped when the response went out.

  And it means less than it sounds like. Use is recorded on **any
  authenticated call**, including one whose payload is then refused with a
  422 — the touch sits before the parse. So `last_used_at` answers "did this
  key reach the endpoint", not "did a delivery land". That is the more useful
  field of the two for diagnosis, because a key reading "never used" after a
  week of rejected deliveries would send somebody looking in the wrong place
  entirely. For deliveries that actually landed, count `ACCEPTED` rows in
  `PollDelivery` on this side; the receiver's column will not tell you.

Sent as `Authorization: Bearer ptk_...` over TLS. The receiver checks the key
**before** it looks at the payload, so the detailed `422` messages below are
not a free validator for anyone without one *(receiver)*.

On this side the token lives in an environment variable, with the endpoint URL
in a platform setting — not in a poll record, which is where it would quietly
become a field somebody dumps.

Blast radius if it leaks: someone can post fabricated results into one
campaign's dashboard. That is bad enough to warrant rotation on any suspicion,
and it is the reason the token reads nothing — a leak should not also expose a
register of electors.

## Endpoint

```
POST /v1/poll-results
Authorization: Bearer ptk_...
Content-Type: application/json
```

| Status | Body | Meaning |
| --- | --- | --- |
| `202` | `{ delivery_id, status: "accepted" }` | Stored. |
| `200` | `{ delivery_id, status: "already_stored" }` | This `delivery_id` was already held. |
| `401` | `{ error: "unauthorized" }` | Unknown key. Deliberately undifferentiated, so the endpoint cannot be used to discover which keys exist. |
| `403` | `{ error: "campaign_suspended" }` | Key is valid, campaign is switched off. Told apart from `401` precisely so a pollster pushing into a dead campaign learns the numbers are not landing. |
| `422` | `{ error: "invalid_request", detail }` | `detail` names the offending field. |
| `409` | `{ error: "sequence_taken", sequence, held_by, detail }` | This sequence is already held by a **different** delivery. `held_by` is the provider's own `delivery_id` for the one holding it. |
| `500` | — | A fault at the receiver. Not something the provider can fix. |

**Record `detail` against the failed delivery.** An integration whose failures
all read `invalid_request` is one somebody debugs by guessing.

A `202` or `200` may also carry **`missing_sequences`** — an array of sequence
numbers this campaign has never received *(receiver; not required by this
contract)*. It is sent because the side that can still do something about a lost
delivery is the side that is holding it. Treat its presence as a cue to replay,
not as an error.

## Payload

```jsonc
{
  "delivery_id": "01J…",            // unique per delivery; the idempotency key
  "sequence": 3,                     // increments per delivery for this campaign

  "poll": {
    "id": "cmv…",                    // stable across waves of the same tracker
    "wave": 3,
    "name": "Cayman Pulse",
    "topic": "the cost of living",
    "fieldwork": { "from": "2026-11-02", "to": "2026-11-05" },
    "delivered_at": "2026-11-06T14:00:00Z"
  },

  // Everything a published figure must be accompanied by. The polling platform
  // already assembles this for its own disclosure block; it is the same data.
  "method": {
    "mode": "Automated telephone interview, disclosed as automated on every call",
    "population": "Adults aged 18 and over resident in the Cayman Islands",
    "dialled": 4120,
    "interviews": 612,
    "cooperation_rate": 0.41,        // completed ÷ (completed + partial + refused)
    "weighted_to": "Registered electors by area",
    "effective_n": 528,
    "design_effect": 1.16,
    "margin_of_error": 4.3,          // percentage points, 95%, from effective_n
    "answer_order": "rotated"        // or "as written"
  },

  // The publication gate, carried with the numbers rather than left behind.
  "publication": {
    "quotable": true,
    "blockers": []                   // non-empty means do not quote; each entry
                                     // is a sentence saying why
  },

  "questions": [
    {
      "id": "Q1",
      "text": "Generally speaking, do you think things in the Cayman Islands are heading in the right direction, or the wrong direction?",
      "base": { "all": 612, "with_a_view": 574 },
      "answers": [
        { "answer": "Right direction", "n": 201, "pct_all": 0.33, "pct_with_a_view": 0.35, "moe": 3.8 },
        { "answer": "Wrong direction", "n": 373, "pct_all": 0.61, "pct_with_a_view": 0.65, "moe": 4.0 },
        { "answer": "Don't know",      "n": 38,  "pct_all": 0.06, "pct_with_a_view": null, "moe": 1.9 }
      ]
    }
  ],

  // Optional. Subgroups are where an underpowered figure gets screenshotted,
  // so each row carries its own base and its own verdict.
  "breakdowns": [
    {
      "by": "district",
      "question_id": "Q1",
      "rows": [
        { "group": "George Town", "n": 240, "quotable": true,  "blockers": [], "answers": [/* … */] },
        { "group": "East End",    "n": 14,  "quotable": false,
          "blockers": ["Base of 14 is far below the 100 usually required to publish a subgroup."],
          "answers": [/* … */] }
      ]
    }
  ]
}
```

### Both bases, always

`pct_all` and `pct_with_a_view` are both present because percentages of everyone
who answered and percentages of those expressing a view are different numbers,
and silently switching between them is how a 40% becomes a 52%. `null` on a
no-view answer is deliberate: it has no share of the with-a-view base.

### The gate is not advisory

`publication.quotable: false` means the receiver **must not** chart the figure
as a result. Render the blockers instead. The same applies per breakdown row.

An integration that strips the gate defeats the entire results layer: the
polling platform refuses to call an underpowered figure publishable, and a
campaign dashboard that renders it as a clean percentage has undone that in one
hop. This is the single most important clause in the document.

Three things the receiver does with the gate that this document did not ask for
*(receiver)*:

- **Per-question `publication`.** A question may carry its own
  `{ quotable, blockers }`, which overrides the top-level block for that
  question only. Omit it and the top-level gate applies — so a payload shaped
  exactly like the example below is accepted unchanged.
- **`quotable: false` with an empty `blockers` array is refused** with a `422`.
  A figure withheld without a reason renders as "unavailable", and that is how
  somebody talks themselves into using the number anyway. If the sender marks
  something unquotable it must say why.
- **Breakdown rows store their verdict separately** rather than as JSON inside
  the question, on the grounds that a subgroup whose gate is buried in a blob
  is a subgroup whose gate gets forgotten by whoever writes the chart.

One thing to know about the far end, and worth stating precisely because this
document could be read as a stronger claim: **today the receiver stores the
gate faithfully and nothing reads it.** `GET /v1/polls` returns JSON; nothing
charts the numbers. So the gate is enforced by storage, by the parser refusing
an unquotable figure that gives no reason, and by documentation — not by a
renderer declining to draw a bar. Whoever writes that renderer inherits the
hard requirement above, and until they do, "the receiver honours the gate"
means it keeps it intact rather than acts on it.

## Unknown fields are refused

Every level of the payload is validated against an allowlist, **including
`method`** — methodology is aggregate by definition only while somebody is
checking, and that block is where a `respondents` array would be easiest to
hide. An unrecognised field earns a `422` naming it *(receiver)*.

A field matching a respondent-level name — `phone`, `phone_hash`, `respondent`,
`call_id`, `transcript`, `verbatim`, `elector` and their kin — gets a longer
refusal that explains the anonymity reason rather than a generic one, on the
theory that whoever sent it has misunderstood the integration rather than
mistyped.

The cost, which the sender must plan around: **this side cannot add a field
until the receiving side accepts it.** It is a one-line change there, but it is
a change there, and a sender that starts emitting a new key without saying so
will have every delivery refused.

A corollary worth stating: there is **no campaign field anywhere in the
payload**. The key is the campaign. `campaign_id` at the top level is refused
like any other unknown field, which is what stops a token delivering into a
campaign it was not issued for.

### Limits

Exceeding any of these is a `422`, not a truncation *(receiver)*:

| Limit | Value | Applies to |
| --- | --- | --- |
| Text | 2000 chars | Question text, each blocker sentence |
| Label | 400 chars | Answer labels, group names, poll name and topic, every `method` string |
| Questions | 100 | per delivery |
| Answers | 60 | per question |
| Breakdowns | 40 | per delivery |
| Rows | 80 | per breakdown |
| Blockers | 20 | per gate |

## Idempotency and revision

`delivery_id` is unique. A repeated POST with the same id stores nothing new and
returns the original acceptance.

Results get revised — more interviews land, weighting is adjusted, a question is
re-coded. **A delivery is never overwritten.** Each one is stored as its own
row; the campaign sees the latest and the history remains.

This is the rule Politracker already applies to `canvass`, which is append-only
so that "a support figure cannot be rewritten after the fact with nothing to
show it changed". A delivered poll number deserves the same treatment for the
same reason: a campaign must be able to tell a correction from a quiet edit.

## When a delivery does not arrive

It will happen. The polling platform's own Retell webhooks delivered nothing for
six completed calls, which sat at the provider with no row in the database until
they were replayed by hand. A results push between two Workers is the same kind
of promise and deserves the same scepticism.

The cheap mitigation, which needs no second credential: **`sequence`**. It
increments per campaign. If Politracker receives sequence 4 having never seen 3,
it knows a delivery was lost and can say so in the dashboard rather than
silently showing last month's numbers — which is worse than showing nothing,
because it looks correct.

The provider should also retry a failed delivery with the same `delivery_id`,
which idempotency makes safe.

### A refusal consumes no sequence

**A sequence is consumed if and only if this endpoint answered 2xx.** A `401`
and a `403` return before the payload is looked at; a `422` returns before the
delivery is stored. So a refused delivery leaves its number free, and the
corrected payload goes out **under the same number**. No gap.

This matters more than it looks, because the rule below depends on it. A gap is
supposed to mean a delivery was lost. If a refusal left one too, then every
integration bug during setup would read as permanent data loss — and the first
real delivery, the one most likely to be refused, would leave an unclosable gap
at sequence 1. The feed's first visible fact would be a false report of loss.

A failure part-way through storing rolls the whole delivery back at the
receiver, so a half-written delivery cannot sit on a number and lock the
provider out of the retry that would have completed it.

The distinction the provider has to keep is between *refused* and *failed*:

| Outcome | Did it store anything? | Repair |
| --- | --- | --- |
| `401`, `403`, `422` | No, provably | Rebuild and re-send under the **same** sequence |
| `409` | Yes — under this sequence, by another delivery | Nothing to this row. Deliver again as a revision under a **new** sequence |
| Transport error, `5xx` | Unknown | Re-send the **stored bytes**; never rebuild |

A `409` has exactly one cause: a delivery the provider recorded as refused
actually landed. It is the receiver reporting that the provider's record is
wrong, and `held_by` names the delivery holding the number so the record can be
put right without reading anybody's logs. Treating it as a transport failure
would be the damaging misreading — that offers "send it again unchanged", into
a number that is permanently accounted for.

The division of labour in the codes is worth stating: **a `409` is the
provider's to fix and a `500` is the receiver's.** Before the receiver added
the `409`, a taken sequence surfaced as `500 internal_error`, which is loud but
aimed at the wrong system — the provider would go looking for a bug at the
receiver when the fact worth acting on is that its own earlier delivery
landed.

Rebuilding after a transport failure is the one move that can silently publish
numbers nobody chose: if the original did land, the same `delivery_id` comes
back `200 already_stored`, the receiver keeps its copy, and the provider
records a success for figures that were discarded. Re-sending the stored bytes
is safe either way, which is why that is the only repair offered there.

### A 2xx is not always good news

Idempotency means the same `delivery_id` arriving again answers `200`, and on a
replay that is exactly what the provider wants: the original landed and only
the answer was lost. On a **first send or a corrected re-send**, the same `200`
means the receiver already held that id and kept its own copy — so the payload
just sent was *not* stored, and recording it as delivered would leave the
provider believing figures were published that were not.

This is the only place in the contract where a success code is a problem, and
the provider must tell the two apart by whether it expected the delivery to be
new.

**Which code a wrong refusal produces depends on a choice the table above does
not make for you.** A corrected re-send may reuse the original `delivery_id` or
mint a fresh one. The receiver accepts either, but **both fields are
constrained** — `unique (campaign_id, delivery_id)` and
`unique (campaign_id, sequence)` — and which one decides is what makes the two
surface the same fault differently:

| Corrected re-send uses | A refusal record that was wrong answers | Because |
| --- | --- | --- |
| The **same** `delivery_id` | `200 already_stored` | Idempotency matches first; the receiver keeps its copy and the corrected payload is discarded |
| A **fresh** `delivery_id` | `409 sequence_taken` | No id matches, so the sequence constraint decides |

Neither is wrong, and the provider needs the guard either way: a `200` must be
treated as a failure when the delivery was expected to be new, or the fault is
absorbed as a success. This implementation reuses the id, because the row's
primary key *is* the delivery id here and a fresh one would leave the stored
payload disagreeing with the row it sits on — breaking the replay path to
harden the re-send path. So the case to expect is the `200`, and `409` is left
for the one it cannot cover: a sequence the receiver holds under a
`delivery_id` the provider has no record of at all, where `held_by` is the only
thing that would let anyone work out what happened.

**Reusing the id is safe because of the `delivery_id` constraint, not merely
permitted despite it.** What produces the `200` is an explicit lookup on
`delivery_id` before anything is written; the unique index is the backstop that
holds that lookup under concurrency. Were the field unconstrained, a reused id
arriving twice at once would pass both lookups and write two rows — the same
poll delivered under two sequences, which is the quiet restatement both ends
are append-only to prevent. Any provider reusing ids is depending on that
index, so a schema change that dropped it would break this strategy silently
rather than loudly.

### A lost delivery leaves a permanent gap

This is the case the table above leaves open: a delivery that may have landed,
whose stored payload is gone.

A replay sends the **stored payload**, byte for byte. When the original cannot
be reproduced, the answer is a new delivery under a **new** sequence, and the
old number stays missing for ever. Current numbers must never be pushed into a
slot the receiver has already accepted something under. Note the narrowness:
this is not about refusals, which consume nothing and are repaired in place.

This rule can only live with the provider. The receiver has no way to tell a
faithful replay from a regenerated one — both arrive as a payload under a
sequence — so nothing at its end can catch the substitution. What it does
enforce is that a sequence is used once, which means resequencing either gets
refused or succeeds and silently restates a published figure under a number
that already meant something else.

A permanent gap is the honest reading. It says a delivery was lost and never
recovered, which is true, and it needs no special case at either end: the
receiver's gap list is a set difference over `1..max`, so the number simply
stays in it. The corollary is that storing what was sent earns its keep only
for the window in which a replay is still faithful; outside that window a new
sequence is the correct answer and not a fallback.

Gaps also close by themselves. The receiver does not require sequences to
arrive in order — 5 may land before 4 — so a delivery that fails need not
block the ones behind it. Carry on and backfill.

If automated recovery is wanted later, the provider can expose a read endpoint
listing deliveries for a campaign. That requires a credential in the other
direction and is deliberately out of scope here.

## Residency

The polling platform's database is Neon `us-east-2`. Politracker's is
`eu-central-1`, behind a documented residency position.

Aggregate results are not personal data, so delivering them into Politracker
raises no transfer question. That holds only while the "never crosses" list
above holds. Anything identifying moving the other way would be an export from
the EEA and runs into the same gate currently holding up voice canvassing.

Both sides have agreed this position, including that it holds conditionally
rather than absolutely. The condition is the "never crosses" list, which is
why that list is enforced in the receiver's parser and not just written here.

## The four questions, settled

1. **Token storage.** This side: an environment variable, with the endpoint URL
   in a platform setting. Not in a poll record — it is a credential for another
   system.
2. **Breakdowns: delivered by default.** Every row carries its own verdict, so a
   subgroup that should not be published arrives marked and is stored that way,
   and the far end will not chart what has not been cleared. Withholding them is
   the worse option: a campaign that cannot see East End at all will ask for it
   by other means, and those means have no gate on them.
3. **Retention: superseded deliveries kept indefinitely.** They are aggregate
   and tiny, and the point of append-only is that the history exists. A campaign
   ending removes all of it — every table cascades from the campaign.
4. **Poll visible before results: not yet, and the gate makes it cheap when
   wanted.** An early delivery with `quotable: false` and a blocker saying
   fieldwork is open shows as "in field" with no chartable number. That is a
   product decision at the far end, not a schema one, so nothing is needed here.

## Still open

- **A key exists but has not been handed over.** One was issued at the far end
  on its operator's instruction: campaign `STERLING`, scope `poll_results`,
  never used. It has deliberately not been sent here, and whether it is the
  one to use or a fresh one is issued for a different campaign is still open.
  `STERLING` was picked because it has one seat and thirteen electors, so it
  is plainly not a live operation — which matters, because there is no way to
  delete a delivery.

  Do not invent a token to try the path. An unknown key returns a flat `401`
  and is byte-identical to sending no key at all, so a fabricated one buys a
  misleading failure rather than a test.
- **Nothing renders the numbers** at the far end yet, so the gate has no
  enforcement in the one place a reader would actually meet it.
- ~~Key use is not recorded in the far end's running deployment.~~ Deployed
  and observed, 3 November. Struck through rather than deleted: this document
  was wrong about this twice — first promising a column nothing wrote, then
  describing a fix that had not shipped — and anyone who relied on either
  should be able to see that the line moved rather than find it tidy.
