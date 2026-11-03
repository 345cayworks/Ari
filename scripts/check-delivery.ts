/**
 * Checks the campaign delivery payload builder.
 *
 * Run with:   npm run check:delivery
 * Or, to also validate against the receiving end's own parser:
 *             npm run check:delivery -- --parser <path to bundled feed.cjs>
 *
 * The second form is the one that matters and it needs explaining. The
 * receiving end (Politracker) validates every level of a delivery against an
 * allowlist and refuses an unknown field with a 422, so the field names and
 * limits in `lib/polling/delivery.ts` are a copy of its parser's — two
 * repositories, two deployments, no shared package. A copy drifts. Bundling
 * that parser with esbuild and running this payload through it is what catches
 * the drift, and it can be done offline because `parseDelivery` is pure and
 * touches no database:
 *
 *   esbuild <politracker>/packages/store-postgres/src/feed.ts --bundle \
 *     --platform=node --format=cjs --outfile=feed.cjs --external:pg
 *
 * Without `--parser` the structural checks below still run, so this is worth
 * having in CI either way; it simply cannot prove the copy is still faithful.
 */
import {
  buildDelivery,
  LIMITS,
  type BuildInput,
  type DeliveryAnswer,
  type DeliveryBreakdown,
  type DeliveryPayload,
} from "../lib/polling/delivery";
import type { Tally } from "../lib/polling/results";
import type { WeightingResult } from "../lib/polling/weighting";

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

function weighting(over: Partial<WeightingResult> = {}): WeightingResult {
  return {
    weights: new Map(),
    n: 612,
    effectiveN: 528,
    designEffect: 1.16,
    marginOfError: 4.3,
    minWeight: 0.6,
    maxWeight: 2.1,
    converged: true,
    margins: [],
    warnings: [],
    ...over,
  };
}

const tally = (over: Partial<Tally> = {}): Tally => ({
  questionId: "Q1",
  text: "Generally speaking, do you think things in the Cayman Islands are heading in the right direction, or the wrong direction?",
  total: 612,
  totalWeight: 612,
  answers: [
    { answer: "Right direction", count: 201, weight: 201 },
    { answer: "Wrong direction", count: 373, weight: 373 },
    { answer: "Don't know", count: 38, weight: 38 },
  ],
  ...over,
});

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    deliveryId: "11111111-2222-3333-4444-555555555555",
    sequence: 3,
    poll: { id: "cmv0001", name: "Cayman Pulse", topic: "the cost of living", wave: 3 },
    fieldwork: { from: new Date("2026-11-02T09:00:00Z"), to: new Date("2026-11-05T17:00:00Z") },
    deliveredAt: new Date("2026-11-06T14:00:00Z"),
    stats: { dialled: 4120, completed: 612, partial: 180, refused: 700 },
    tallies: [tally()],
    weighting: weighting(),
    answered: 612,
    blockers: [],
    weightedTo: "Raked to District × Age band",
    rotated: 612,
    ...over,
  };
}

console.log("A healthy poll");
const healthy = buildDelivery(input());
check("builds", healthy.ok, healthy.ok ? undefined : healthy.problems.join("; "));

if (healthy.ok) {
  const p = healthy.payload;
  const q = p.questions[0]!;
  const noView = q.answers.find((a) => a.answer === "Don't know")!;
  const view = q.answers.find((a) => a.answer === "Right direction")!;

  check("is quotable with no blockers", p.publication.quotable && p.publication.blockers.length === 0);
  check("carries the headline gate at the top level", p.publication !== undefined);
  check("reports the rotation", p.method.answer_order === "rotated");
  check(
    "cooperation rate is completed / (completed + partial + refused)",
    p.method.cooperation_rate === 0.4102,
    `got ${p.method.cooperation_rate}`,
  );
  check("effective N comes off the weighting", p.method.effective_n === 528);
  check("fieldwork is a pair of dates", p.poll.fieldwork.from === "2026-11-02" && p.poll.fieldwork.to === "2026-11-05");
  check("a no-view answer has no with-a-view share", noView.pct_with_a_view === null);
  check("a view-expressing answer has both shares", view.pct_all > 0 && (view.pct_with_a_view ?? 0) > 0);
  check(
    "the with-a-view share is the larger of the two",
    (view.pct_with_a_view ?? 0) > view.pct_all,
    `all ${view.pct_all}, with a view ${view.pct_with_a_view}`,
  );
  check("the with-a-view base excludes the no-view answers", q.base.with_a_view === 574);
  check("n stays unweighted", q.answers.reduce((s, a) => s + a.n, 0) === 612);
  check("margins differ by answer", view.moe !== noView.moe);
  check("a near-even split has a wider margin than a lopsided one", view.moe > noView.moe);
  check("breakdowns are omitted when there are none", p.breakdowns === undefined);
}

console.log("\nA poll that should not be published");
const thinTally = tally({
  total: 40,
  totalWeight: 40,
  answers: [
    { answer: "Right direction", count: 13, weight: 13 },
    { answer: "Wrong direction", count: 25, weight: 25 },
    { answer: "Don't know", count: 2, weight: 2 },
  ],
});
const thin = buildDelivery(input({
  answered: 40,
  tallies: [thinTally],
  weighting: null,
  blockers: ["The sample is 40; 100 is the usual floor for publishing a headline figure."],
}));
check("still builds", thin.ok, thin.ok ? undefined : thin.problems.join("; "));
if (thin.ok) {
  check("is marked unquotable", !thin.payload.publication.quotable);
  check("says why", thin.payload.publication.blockers.length > 0);
  check("drops the weighting fields", thin.payload.method.effective_n === null && thin.payload.method.design_effect === null);
}

console.log("\nA question only part of the sample reached");
const partial = buildDelivery(input({
  tallies: [
    tally(),
    tally({
      questionId: "Q2",
      text: "And on housing?",
      total: 60,
      totalWeight: 60,
      answers: [
        { answer: "Right direction", count: 20, weight: 20 },
        { answer: "Wrong direction", count: 37, weight: 37 },
        { answer: "Don't know", count: 3, weight: 3 },
      ],
    }),
  ],
}));
check("builds", partial.ok, partial.ok ? undefined : partial.problems.join("; "));
if (partial.ok) {
  const [q1, q2] = partial.payload.questions;
  check("the full-sample question inherits the top-level gate", q1!.publication === undefined);
  check("the thin question carries its own gate", q2!.publication !== undefined);
  check("and that gate refuses it", q2!.publication?.quotable === false);
  check("with a reason", (q2!.publication?.blockers.length ?? 0) > 0);
}

console.log("\nThings that must be refused rather than trimmed");
const longText = buildDelivery(input({ tallies: [tally({ text: "x".repeat(LIMITS.text + 1) })] }));
check("over-long question text is a problem", !longText.ok);
const longLabel = buildDelivery(input({
  tallies: [tally({ answers: [{ answer: "y".repeat(LIMITS.label + 1), count: 612, weight: 612 }] })],
}));
check("an over-long answer label is a problem", !longLabel.ok);
const tooMany = buildDelivery(input({
  tallies: Array.from({ length: LIMITS.questions + 1 }, (_, i) => tally({ questionId: `Q${i}` })),
}));
check("too many questions is a problem", !tooMany.ok);
const noReason = buildDelivery(input({ blockers: [] , answered: 612}));
check("an empty blocker list with a quotable figure is fine", noReason.ok);

const incoherent = buildDelivery(input({ tallies: [tally({ total: 40, totalWeight: 40 })] }));
check("a with-a-view base larger than the sample is a problem", !incoherent.ok,
  incoherent.ok ? "it was NOT caught" : incoherent.problems.join("; "));

// The guard exists so that a future edit which starts attaching call-level
// detail to a tally cannot ship it to a campaign. Reaching past the types is
// the point of the test: that is what such an edit would look like.
const leaky = buildDelivery(input({
  breakdowns: [
    { by: "district", question_id: "Q1", rows: [
      { group: "George Town", n: 240, quotable: true, blockers: [], answers: [], phone_hash: "deadbeef" },
    ] },
  ] as unknown as DeliveryBreakdown[],
}));
check("a respondent-level field is caught before it is sent", !leaky.ok,
  leaky.ok ? "it was NOT caught" : leaky.problems.join("; "));

// --- Against the receiving end's own parser ------------------------------
// Whether the cross-check against the receiver's real parser actually ran.
// Tracked because without it this script verifies only that the builder
// agrees with itself, and a summary line reading "all checks passed" after
// skipping it is a reassurance with nothing behind it.
let crossChecked = false;
const parserFlag = process.argv.indexOf("--parser");
if (parserFlag === -1 || process.argv[parserFlag + 1] === undefined) {
  console.log("\nReceiver parser: skipped (pass --parser <bundled feed.cjs> to include it)");
} else {
  const path = process.argv[parserFlag + 1]!;
  console.log(`\nAgainst the receiver's own parser (${path})`);
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { parseDelivery } = require(path) as {
    parseDelivery: (v: unknown) => { ok: true } | { ok: false; reason: string };
  };
  crossChecked = true;

  // A bundle is a copy of their parser frozen at the moment it was built, so
  // its age is the age of the only evidence this script has about their end.
  // Printed rather than enforced: there is no way from here to know which
  // commit it came from, and a wrong staleness threshold would be its own
  // false reassurance.
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { statSync } = require("node:fs") as typeof import("node:fs");
    const ageHours = (Date.now() - statSync(path).mtimeMs) / 3_600_000;
    console.log(
      `  (bundle built ${ageHours < 1 ? "under an hour" : `${Math.round(ageHours)} hour(s)`} ago — rebuild it if their parser has moved since)`,
    );
  } catch {
    // Not worth failing the run over.
  }
  const cases: [string, ReturnType<typeof buildDelivery>][] = [
    ["a healthy poll", healthy],
    ["a poll that should not be published", thin],
    ["a question only part of the sample reached", partial],
  ];
  for (const [label, built] of cases) {
    if (!built.ok) {
      check(`${label} — not built, cannot check`, false);
      continue;
    }
    const parsed = parseDelivery(JSON.parse(JSON.stringify(built.payload)));
    check(`${label} is accepted`, parsed.ok, parsed.ok ? undefined : parsed.reason);
  }

  // --- Do our limits equal theirs? ---------------------------------------
  //
  // LIMITS is a hand copy of their parser's, because there is no shared
  // package between two repositories. The other side checked by eye that all
  // seven agree and reported that they do. That is a claim in prose about
  // code, which is the exact thing that has gone wrong repeatedly here — so
  // it is checked instead.
  //
  // Each limit is pinned from both directions, because one direction alone
  // proves nothing useful. A payload AT the limit must be accepted by both:
  // if ours were stricter, deliveries would be refused here that they would
  // have taken. A payload OVER it must be refused by both: if ours were
  // looser, a delivery would pass our check and be refused on the wire,
  // which is the silent mismatch that would be hardest to diagnose.
  //
  // The over-limit payloads are built valid and then mutated past the limit,
  // because our own builder refuses to produce them — which is the point of
  // it, and also why it cannot be the thing that tests their end.
  const answer = (n: number, label = "A"): DeliveryAnswer => ({
    answer: label,
    n,
    pct_all: 0.5,
    pct_with_a_view: 0.5,
    moe: 1,
  });
  const breakdown = (rows: number): DeliveryBreakdown => ({
    by: "district",
    question_id: "Q1",
    rows: Array.from({ length: rows }, (_, i) => ({
      group: `G${i}`,
      n: 10,
      quotable: true,
      blockers: [],
      answers: [answer(5)],
    })),
  });
  const spread = (count: number, each: number): Tally["answers"] =>
    Array.from({ length: count }, (_, i) => ({
      answer: `A${i}`,
      count: each,
      weight: each,
    }));

  const limitCases: {
    name: string;
    limit: number;
    at: () => ReturnType<typeof buildDelivery>;
    over: (p: DeliveryPayload, n: number) => void;
  }[] = [
    {
      name: `question text (${LIMITS.text})`,
      limit: LIMITS.text,
      at: () => buildDelivery(input({ tallies: [tally({ text: "x".repeat(LIMITS.text) })] })),
      over: (p, n) => {
        p.questions[0]!.text = "x".repeat(n);
      },
    },
    {
      name: `answer label (${LIMITS.label})`,
      limit: LIMITS.label,
      at: () =>
        buildDelivery(
          input({ tallies: [tally({ answers: [{ answer: "y".repeat(LIMITS.label), count: 612, weight: 612 }] })] }),
        ),
      over: (p, n) => {
        p.questions[0]!.answers[0]!.answer = "y".repeat(n);
      },
    },
    {
      name: `questions (${LIMITS.questions})`,
      limit: LIMITS.questions,
      at: () =>
        buildDelivery(
          input({
            tallies: Array.from({ length: LIMITS.questions }, (_, i) => tally({ questionId: `Q${i}` })),
          }),
        ),
      over: (p, n) => {
        const q = p.questions[0]!;
        p.questions = Array.from({ length: n }, (_, i) => ({ ...q, id: `Q${i}` }));
      },
    },
    {
      name: `answers per question (${LIMITS.answers})`,
      limit: LIMITS.answers,
      at: () =>
        buildDelivery(
          input({
            tallies: [tally({ total: LIMITS.answers * 10, totalWeight: LIMITS.answers * 10, answers: spread(LIMITS.answers, 10) })],
          }),
        ),
      over: (p, n) => {
        p.questions[0]!.base = { all: n * 10, with_a_view: n * 10 };
        p.questions[0]!.answers = Array.from({ length: n }, (_, i) => answer(1, `A${i}`));
      },
    },
    {
      name: `breakdowns (${LIMITS.breakdowns})`,
      limit: LIMITS.breakdowns,
      at: () =>
        buildDelivery(input({ breakdowns: Array.from({ length: LIMITS.breakdowns }, () => breakdown(1)) })),
      over: (p, n) => {
        p.breakdowns = Array.from({ length: n }, () => breakdown(1));
      },
    },
    {
      name: `rows per breakdown (${LIMITS.rows})`,
      limit: LIMITS.rows,
      at: () => buildDelivery(input({ breakdowns: [breakdown(LIMITS.rows)] })),
      over: (p, n) => {
        p.breakdowns = [breakdown(n)];
      },
    },
    {
      name: `blockers (${LIMITS.blockers})`,
      limit: LIMITS.blockers,
      at: () =>
        buildDelivery(input({ blockers: Array.from({ length: LIMITS.blockers }, (_, i) => `Blocker ${i}.`) })),
      over: (p, n) => {
        p.publication = {
          quotable: false,
          blockers: Array.from({ length: n }, (_, i) => `Blocker ${i}.`),
        };
      },
    },
  ];

  console.log("");
  console.log("  Limit agreement, pinned from both directions");
  for (const c of limitCases) {
    const built = c.at();
    if (!built.ok) {
      check(`${c.name} — at the limit, ours accepts`, false, built.problems.join("; "));
    } else {
      const parsed = parseDelivery(JSON.parse(JSON.stringify(built.payload)));
      check(
        `${c.name} — at the limit, both accept`,
        parsed.ok,
        parsed.ok ? undefined : `theirs refused: ${parsed.reason}`,
      );

      const mutated = JSON.parse(JSON.stringify(built.payload)) as DeliveryPayload;
      c.over(mutated, c.limit + 1);
      const refused = parseDelivery(mutated);
      check(
        `${c.name} — one over, theirs refuses`,
        !refused.ok,
        refused.ok ? "theirs ACCEPTED a payload past our limit — ours is stricter than theirs" : undefined,
      );
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
} else if (crossChecked) {
  console.log("\nAll checks passed, including against the receiver's own parser.");
} else {
  // Deliberately not "all checks passed". Everything that ran compared the
  // builder with itself; the limits and every field name were not checked
  // against the only thing that decides them, which is the other end's
  // parser. Saying otherwise would make this script the thing it exists to
  // catch — a verification whose presence is reassuring and whose function
  // is absent.
  console.log("\nThe builder's own checks passed. The contract was NOT checked:");
  console.log("  limits and field names are unverified without --parser.");
}
process.exit(failures === 0 ? 0 : 1);
