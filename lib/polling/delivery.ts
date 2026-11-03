import { isNoViewOption } from "./rotation";
import type { Tally } from "./results";
import type { WeightingResult } from "./weighting";

/**
 * Building the payload that goes to a campaign. See `docs/poll-results-api.md`.
 *
 * Pure on purpose: nothing here touches the database, so it can be exercised
 * by `scripts/check-delivery.ts` under plain Node. `lib/db.ts` is the WASM
 * Prisma client and does not run under Node at all, which is the reason the
 * split exists rather than a preference.
 *
 * The receiving end validates every level of this against an allowlist and
 * refuses an unknown field with a 422. So the limits and the field names below
 * are duplicated from its parser rather than imported — two codebases, two
 * deployments, no shared package — and `scripts/check-delivery.ts` is what
 * stops the copy drifting.
 */

/**
 * What a test delivery says about itself, permanently.
 *
 * A delivery cannot be withdrawn: the receiving end is append-only and has no
 * delete path, and the only removal takes the campaign's register of electors
 * with it. So the first delivery made to prove the connection works is a row
 * somebody may read years from now, and it has to be honest then rather than
 * merely harmless now.
 *
 * The publication gate would already refuse a trial poll for its sample size,
 * and that is not enough. "The sample is 6" is true and still lets a reader
 * conclude this was real fieldwork with few respondents. This says what it
 * actually is.
 *
 * Fixed wording, not an operator's free text, because it has to read correctly
 * to someone who was not here and cannot ask.
 */
export const TEST_DELIVERY_BLOCKER =
  "This delivery is a test of the connection between the polling platform and " +
  "this campaign, not fieldwork. The figures come from a trial poll and are not " +
  "a measurement of public opinion. Do not publish, quote or chart them.";

/** The receiver's limits. Exceeding one is a 422, not a truncation. */
export const LIMITS = {
  text: 2000,
  label: 400,
  questions: 100,
  answers: 60,
  breakdowns: 40,
  rows: 80,
  blockers: 20,
} as const;

/**
 * Field names that must never appear anywhere in a payload.
 *
 * The receiver refuses these too, with a message explaining why. Checking it
 * here as well is not redundant: catching it before the request means a
 * mistake shows up in a check run rather than as a rejected delivery, and the
 * promise being kept — every respondent was told their answers are anonymous
 * and combined with hundreds of others — is this side's promise to keep.
 */
const RESPONDENT_FIELDS = new Set([
  "phone", "phonehash", "numberhash", "hash", "hashes",
  "respondent", "respondentid", "respondents",
  "interview", "interviewid",
  "call", "calls", "callid", "retellcallid",
  "constituent", "constituentid", "elector", "electorid",
  "verbatim", "verbatims", "transcript", "transcripts",
]);

export interface Publication {
  quotable: boolean;
  blockers: string[];
}

/**
 * One answer's figures.
 *
 * **No valence field, deliberately.** This side can tell a favourable answer
 * from an unfavourable one — `isOrderedScale` and the positive/negative lists
 * in `rotation.ts` exist precisely to do that, and rotation depends on it —
 * and none of it is transmitted. The receiving end therefore colours every bar
 * one hue rather than diverging, because inferring direction from free-text
 * labels would be it inventing meaning it cannot know.
 *
 * So do not add a valence, sentiment or direction field here as a convenience.
 * Their allowlist refuses an unknown key at this level and
 * `scripts/check-delivery.ts` would fail against their real parser, but those
 * stop it rather than explain it. If diverging colour is ever actually wanted,
 * it is a change to the contract agreed at both ends, not a field slipped in
 * because this side happens to know.
 */
export interface DeliveryAnswer {
  answer: string;
  /** Unweighted respondents giving this answer. The honest base. */
  n: number;
  pct_all: number;
  /** Null on an answer that expresses no view: it has no share of that base. */
  pct_with_a_view: number | null;
  moe: number;
}

export interface DeliveryQuestion {
  id: string;
  text: string | null;
  base: { all: number; with_a_view: number };
  answers: DeliveryAnswer[];
  /** Optional. Omitted, the top-level gate applies to this question. */
  publication?: Publication;
}

export interface DeliveryBreakdownRow {
  group: string;
  n: number;
  quotable: boolean;
  blockers: string[];
  answers: DeliveryAnswer[];
}

export interface DeliveryBreakdown {
  by: string;
  question_id: string;
  rows: DeliveryBreakdownRow[];
}

export interface DeliveryMethod {
  mode: string;
  population: string;
  dialled: number;
  interviews: number;
  cooperation_rate: number | null;
  weighted_to: string | null;
  effective_n: number | null;
  design_effect: number | null;
  margin_of_error: number | null;
  answer_order: "rotated" | "as written";
}

export interface DeliveryPayload {
  delivery_id: string;
  sequence: number;
  poll: {
    id: string;
    wave: number;
    name: string;
    topic: string | null;
    fieldwork: { from: string | null; to: string | null };
    delivered_at: string;
  };
  method: DeliveryMethod;
  publication: Publication;
  questions: DeliveryQuestion[];
  breakdowns?: DeliveryBreakdown[];
}

export interface BuildInput {
  deliveryId: string;
  sequence: number;
  poll: { id: string; name: string; topic: string | null; wave: number };
  fieldwork: { from: Date | null; to: Date | null };
  deliveredAt: Date;
  stats: { dialled: number; completed: number; partial: number; refused: number };
  tallies: Tally[];
  weighting: WeightingResult | null;
  /** The headline base: weighted n when weighting is on, else the topline total. */
  answered: number;
  /** From `publicationBlockers`. Empty means the headline is fit to quote. */
  blockers: string[];
  weightedTo: string;
  /** Interviews that heard a rotated option order. */
  rotated: number;
  /**
   * Optional, and nothing in this repo produces them yet: `tallyResponses`
   * has no by-group split, so there is no crosstab source to draw on. The
   * shape is here so that when one exists it has somewhere to go, and so the
   * limits below already cover it.
   */
  breakdowns?: DeliveryBreakdown[];
}

export type BuildResult =
  | { ok: true; payload: DeliveryPayload }
  | { ok: false; problems: string[] };

const POPULATION = "Adults aged 18 and over resident in the Cayman Islands";
const MODE =
  "Automated telephone interview conducted by an AI interviewer, disclosed as automated at the start of every call";

/** 95%, in percentage points, from this answer's own proportion. */
function marginOfError(p: number, base: number): number {
  if (base <= 0) return 0;
  const clamped = Math.min(Math.max(p, 0), 1);
  return round(1.96 * Math.sqrt((clamped * (1 - clamped)) / base) * 100, 1);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** A proportion, rounded far enough to survive a round trip without drifting. */
function share(part: number, whole: number): number {
  return whole > 0 ? round(part / whole, 4) : 0;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Turn one question's tally into a figure.
 *
 * Both percentage bases are always present, because a percentage of everyone
 * who answered and a percentage of those expressing a view are different
 * numbers and switching between them silently is how a 40% becomes a 52%.
 */
function figureFor(
  tally: Tally,
  weighting: WeightingResult | null,
  gate: Publication | undefined,
): DeliveryQuestion {
  const weighted = weighting !== null;
  const totalAll = weighted ? tally.totalWeight : tally.total;

  const withAView = tally.answers
    .filter((a) => !isNoViewOption(a.answer))
    .reduce((sum, a) => sum + (weighted ? a.weight : a.count), 0);

  // Weighting cuts the base the margin should be read off. Scale this
  // question's base by the same factor rather than quoting the headline
  // effective N against a question only some respondents reached.
  const shrink =
    weighting && weighting.n > 0 ? weighting.effectiveN / weighting.n : 1;
  const effectiveBase = Math.max(0, tally.total * shrink);

  const answers: DeliveryAnswer[] = tally.answers.map((a) => {
    const value = weighted ? a.weight : a.count;
    const pctAll = share(value, totalAll);
    return {
      answer: a.answer,
      n: a.count,
      pct_all: pctAll,
      pct_with_a_view: isNoViewOption(a.answer)
        ? null
        : share(value, withAView),
      moe: marginOfError(pctAll, effectiveBase),
    };
  });

  return {
    id: tally.questionId,
    text: tally.text ?? null,
    base: {
      all: tally.total,
      with_a_view: tally.answers
        .filter((a) => !isNoViewOption(a.answer))
        .reduce((sum, a) => sum + a.count, 0),
    },
    answers,
    ...(gate ? { publication: gate } : {}),
  };
}

/** Walk a built payload for anything respondent-level. Belt and braces. */
function respondentLeak(value: unknown, path = "body"): string | null {
  if (Array.isArray(value)) {
    for (const [i, entry] of value.entries()) {
      const found = respondentLeak(entry, `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (RESPONDENT_FIELDS.has(key.toLowerCase().replace(/[\s_-]/g, ""))) {
      return `${path}.${key} is respondent-level and must never be delivered`;
    }
    const found = respondentLeak(entry, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Assemble a delivery, or say what is wrong with it.
 *
 * Over-long text is reported rather than trimmed. Trimming a question to fit
 * would change the record of what was actually asked, and a poll carrying a
 * 2000-character question is a thing to fix at the source, not on the way
 * out of the door.
 */
export function buildDelivery(input: BuildInput): BuildResult {
  const problems: string[] = [];
  const check = (value: string | null, max: number, where: string): void => {
    if (value !== null && value.length > max) {
      problems.push(`${where} is ${value.length} characters; the limit is ${max}`);
    }
  };

  const gate: Publication = {
    quotable: input.blockers.length === 0,
    blockers: input.blockers,
  };
  if (!gate.quotable && gate.blockers.length === 0) {
    problems.push("publication is not quotable but gives no blockers saying why");
  }
  if (gate.blockers.length > LIMITS.blockers) {
    problems.push(`publication.blockers holds ${gate.blockers.length}; the limit is ${LIMITS.blockers}`);
  }
  gate.blockers.forEach((b, i) => check(b, LIMITS.text, `publication.blockers[${i}]`));

  const cooperationBase = input.stats.completed + input.stats.partial + input.stats.refused;

  const method: DeliveryMethod = {
    mode: MODE,
    population: POPULATION,
    dialled: input.stats.dialled,
    interviews: input.answered,
    cooperation_rate:
      cooperationBase > 0 ? share(input.stats.completed, cooperationBase) : null,
    weighted_to: input.weightedTo.trim() === "" ? null : input.weightedTo.trim(),
    effective_n: input.weighting ? Math.round(input.weighting.effectiveN) : null,
    design_effect: input.weighting ? round(input.weighting.designEffect, 2) : null,
    margin_of_error: input.weighting ? round(input.weighting.marginOfError, 1) : null,
    answer_order: input.rotated > 0 ? "rotated" : "as written",
  };
  check(method.mode, LIMITS.label, "method.mode");
  check(method.population, LIMITS.label, "method.population");
  check(method.weighted_to, LIMITS.label, "method.weighted_to");

  if (input.tallies.length > LIMITS.questions) {
    problems.push(`questions holds ${input.tallies.length}; the limit is ${LIMITS.questions}`);
  }

  const questions = input.tallies.map((tally) => {
    // The same reasoning as the headline gate, applied to this question's own
    // base. A question only half the sample reached does not inherit a clean
    // bill of health from the topline.
    const perQuestion =
      tally.total < input.answered
        ? {
            quotable: input.blockers.length === 0 && tally.total >= 100,
            blockers:
              input.blockers.length > 0
                ? input.blockers
                : tally.total >= 100
                  ? []
                  : [
                      `Only ${tally.total.toLocaleString()} respondents reached this question; 100 is the usual floor for publishing a figure.`,
                    ],
          }
        : undefined;
    return figureFor(tally, input.weighting, perQuestion);
  });

  questions.forEach((q, i) => {
    check(q.text, LIMITS.text, `questions[${i}].text`);
    check(q.id, LIMITS.label, `questions[${i}].id`);
    if (q.answers.length > LIMITS.answers) {
      problems.push(`questions[${i}].answers holds ${q.answers.length}; the limit is ${LIMITS.answers}`);
    }
    q.answers.forEach((a, j) => check(a.answer, LIMITS.label, `questions[${i}].answers[${j}].answer`));
    // The with-a-view base is summed from the answers while the all base is
    // the tally's own respondent count. They agree on well-formed data, and
    // when they do not the tally is wrong in a way worth stopping for rather
    // than guessing past: the receiver refuses this too, and a percentage of a
    // base larger than the sample is the kind of number that gets quoted.
    if (q.base.with_a_view > q.base.all) {
      problems.push(
        `questions[${i}].base.with_a_view is ${q.base.with_a_view}, more than the ${q.base.all} who answered at all`,
      );
    }
    if (q.publication && !q.publication.quotable && q.publication.blockers.length === 0) {
      problems.push(`questions[${i}].publication is not quotable but gives no blockers saying why`);
    }
  });

  const breakdowns = input.breakdowns ?? [];
  if (breakdowns.length > LIMITS.breakdowns) {
    problems.push(`breakdowns holds ${breakdowns.length}; the limit is ${LIMITS.breakdowns}`);
  }
  breakdowns.forEach((b, i) => {
    if (b.rows.length > LIMITS.rows) {
      problems.push(`breakdowns[${i}].rows holds ${b.rows.length}; the limit is ${LIMITS.rows}`);
    }
    b.rows.forEach((r, j) => {
      check(r.group, LIMITS.label, `breakdowns[${i}].rows[${j}].group`);
      if (!r.quotable && r.blockers.length === 0) {
        problems.push(
          `breakdowns[${i}].rows[${j}] is not quotable but gives no blockers saying why`,
        );
      }
    });
  });

  const payload: DeliveryPayload = {
    delivery_id: input.deliveryId,
    sequence: input.sequence,
    poll: {
      id: input.poll.id,
      wave: input.poll.wave,
      name: input.poll.name,
      topic: input.poll.topic,
      fieldwork: { from: isoDate(input.fieldwork.from), to: isoDate(input.fieldwork.to) },
      delivered_at: input.deliveredAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    },
    method,
    publication: gate,
    questions,
    ...(breakdowns.length > 0 ? { breakdowns } : {}),
  };

  check(payload.delivery_id, LIMITS.label, "delivery_id");
  check(payload.poll.name, LIMITS.label, "poll.name");
  check(payload.poll.topic, LIMITS.label, "poll.topic");

  const leak = respondentLeak(payload);
  if (leak !== null) problems.push(leak);

  return problems.length > 0 ? { ok: false, problems } : { ok: true, payload };
}
