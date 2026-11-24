import type { PollCallOutcome } from "@prisma/client";
import { CALL_OUTCOMES } from "./config";

/**
 * What outcome a call ends up with once Retell's analysis has arrived.
 *
 * This is its own module, and pure, for one reason: the rule it enforces is an
 * invariant nothing else contradicts.
 *
 * `PollCall.outcome` defaults to IN_PROGRESS, and Prisma omits a field whose
 * value is `undefined` from an update. So returning "I could not tell" from
 * here used to leave the column at its default — a row asserting that a
 * finished interview was still running. Nothing contradicted it: `reconcile`
 * skips any call that already has a row, and there is no sweep for stale ones,
 * so such a row stayed IN_PROGRESS permanently and the dashboard's "In
 * progress" count only ever climbed. Three rows reached production that way.
 *
 * Hence the return type: a `PollCallOutcome`, never `undefined`. An analysed
 * call always gets a terminal outcome. The invariant worth remembering is
 *
 *     endedAt IS NOT NULL  =>  outcome <> IN_PROGRESS
 *
 * because a genuinely live call is the one case where IN_PROGRESS is true, and
 * it has no `endedAt`. `scripts/check-outcome.ts` asserts this.
 *
 * Neither fallback outcome counts as a completed interview, so an unreadable
 * analysis can never inflate a published base. That is the property that makes
 * guessing here safe at all.
 */

/**
 * Disconnection reasons that mean the call never reached a person.
 *
 * For the outcome column all three are NO_ANSWER: nobody was interviewed.
 * Do not reuse this set for the sampling frame. `rdd.ts` splits these three
 * apart deliberately — `dial_failed` is a carrier refusing setup, which marks
 * a number unassigned, while `dial_no_answer` and `dial_busy` prove a number
 * exists. Collapsing them there would delete live numbers from the frame.
 */
export const NOT_REACHED: ReadonlySet<string> = new Set([
  "dial_busy",
  "dial_failed",
  "dial_no_answer",
]);

/** Whether a disconnection reason says the dial never got through. */
export function dialNeverConnected(reason: unknown): boolean {
  return typeof reason === "string" && NOT_REACHED.has(reason.trim().toLowerCase());
}

/** The outcome Retell's own analysis reported, when it reported a usable one. */
export function outcomeFromAnalysis(value: unknown): PollCallOutcome | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!(CALL_OUTCOMES as readonly string[]).includes(key)) return undefined;
  return key.toUpperCase() as PollCallOutcome;
}

/** What we know about a call whose analysis has come back. */
export interface AnalysedCall {
  /** `call_analysis.custom_analysis_data.call_outcome`, unvalidated. */
  reportedOutcome: unknown;
  /** `call_analysis.in_voicemail`. */
  inVoicemail?: boolean | null;
  /** Call length in milliseconds as Retell reported it. */
  durationMs?: number | null;
  /** `disconnection_reason` — why the call ended, including dial failures. */
  disconnectionReason?: unknown;
  /** The outcome already on the row. */
  existing?: PollCallOutcome | null;
}

export function resolveAnalysedOutcome(call: AnalysedCall): PollCallOutcome {
  // Recorded live, mid-call, by the agent's own tools. A respondent who asked
  // not to be called again said so; an analysis pass does not get to revise
  // that, even when it reports something it recognises. This has to outrank
  // the reported outcome below, which is why it is not merged with the
  // "keep what we already knew" step further down — that one must lose to it.
  if (call.existing === "DO_NOT_CALL" || call.existing === "CALLBACK_REQUESTED") {
    return call.existing;
  }

  const reported = outcomeFromAnalysis(call.reportedOutcome);
  if (reported) return reported;

  if (call.inVoicemail) return "VOICEMAIL";

  // Analysis told us nothing usable. If the row already carries a terminal
  // outcome from an earlier pass, that is better evidence than anything the
  // guesses below produce, so leave it alone. Only a row still sitting on the
  // IN_PROGRESS default needs rescuing.
  if (call.existing && call.existing !== "IN_PROGRESS") return call.existing;

  // Evidence, not inference: the dial itself says nobody was reached. This is
  // the rule the `call_ended` path has always applied, and it has to apply
  // here too — a call that never connected can still arrive as `call_analyzed`
  // when Retell attaches an analysis to it, which is how three rows with
  // `dial_no_answer` ended up stranded on the IN_PROGRESS default.
  if (dialNeverConnected(call.disconnectionReason)) return "NO_ANSWER";

  // Down to inference. A call with measurable duration did happen, so claiming
  // nobody spoke would be a fabrication; PARTIAL says an interview took place
  // without asserting it finished. Zero duration is the honest NO_CONVERSATION.
  return (call.durationMs ?? 0) > 0 ? "PARTIAL" : "NO_CONVERSATION";
}
