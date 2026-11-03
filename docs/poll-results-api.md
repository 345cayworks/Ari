# Poll results API — delivering a poll to a campaign

Contract between the polling platform (**provider**, polling.cayworks.net) and
Politracker (**receiver**, politracker.cayworks.net). Written from the provider
side because the provider publishes the contract; the receiving half is
Politracker's to design against it.

Status: proposed. Nothing is built.

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
- **logged** on use, so a delivery can be traced.

Sent as `Authorization: Bearer <token>` over TLS.

Blast radius if it leaks: someone can post fabricated results into one
campaign's dashboard. That is bad enough to warrant rotation on any suspicion,
and it is the reason the token reads nothing — a leak should not also expose a
register of electors.

## Endpoint

```
POST /v1/poll-results
Authorization: Bearer <token>
Content-Type: application/json
```

Returns `202` with `{ "delivery_id": "...", "status": "accepted" }`, or `200`
with the same body if this `delivery_id` was already stored — see idempotency.

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

## Open questions

1. Who issues and stores the token on the polling side, and where — it is a
   credential for a third-party system and should not sit in a poll record.
2. Are breakdowns delivered by default, or only when the pollster marks them
   releasable? Subgroup figures are the most likely to be misused.
3. Retention: how long does Politracker keep superseded deliveries, and does a
   campaign ending delete them?
4. Does a campaign see a poll's existence before results arrive — a
   "requested · in field · delivered" record — or only the result?
