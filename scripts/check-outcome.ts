/**
 * Checks how an analysed call's outcome is decided.
 *
 * Run with:  npm run check:outcome
 *
 * The bug this exists to prevent shipped once and was invisible for a month.
 * `resolveAnalysedOutcome`'s predecessor returned `undefined` when it could not
 * read Retell's analysis, and Prisma drops an undefined field from an update,
 * so the row kept its IN_PROGRESS default. Three production rows ended up
 * claiming a finished interview was still running, and nothing contradicted
 * them: reconcile skips calls that already have a row, no sweep looks for
 * stale ones, and every other field on those rows was written correctly.
 *
 * So the central assertion here is a sweep, not an example: across every
 * combination of reported outcome, voicemail flag, duration and prior outcome,
 * the result is never IN_PROGRESS. An example-based test would have passed
 * against the broken version, because the broken version was right whenever
 * Retell sent a readable outcome — which is most of the time.
 */
import type { PollCallOutcome } from "@prisma/client";
import { CALL_OUTCOMES } from "../lib/polling/config";
import {
  dialNeverConnected,
  outcomeFromAnalysis,
  resolveAnalysedOutcome,
} from "../lib/polling/outcome";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

const ALL_OUTCOMES: PollCallOutcome[] = [
  "IN_PROGRESS",
  "COMPLETED",
  "PARTIAL",
  "REFUSED",
  "SCREENED_OUT",
  "CALLBACK_REQUESTED",
  "DO_NOT_CALL",
  "VOICEMAIL",
  "NO_ANSWER",
  "WRONG_NUMBER_OR_LANGUAGE",
  "HOSTILE",
  "DISTRESSED",
  "NO_CONVERSATION",
];

function main(): void {
  console.log("An analysed call never stays IN_PROGRESS");
  // The invariant: endedAt IS NOT NULL => outcome <> IN_PROGRESS. Everything
  // reaching this function has been analysed, so it has ended.
  const junk: unknown[] = [
    undefined, null, "", "   ", "nonsense", "in_progress", "IN_PROGRESS",
    42, true, {}, [], "completed!",
  ];
  const reportedValues: unknown[] = [...CALL_OUTCOMES, ...junk];
  let swept = 0;
  let stuck: string | null = null;
  for (const reportedOutcome of reportedValues) {
    for (const inVoicemail of [true, false, null, undefined]) {
      for (const durationMs of [0, 1, 25438, null, undefined]) {
        for (const disconnectionReason of [
          "dial_no_answer", "dial_busy", "dial_failed", "user_hangup", "", null, undefined, 42,
        ]) {
          for (const existing of [...ALL_OUTCOMES, null, undefined]) {
            const got = resolveAnalysedOutcome({
              reportedOutcome, inVoicemail, durationMs, disconnectionReason, existing,
            });
            swept++;
            if (got === "IN_PROGRESS" && !stuck) {
              stuck = `reported=${JSON.stringify(reportedOutcome)} voicemail=${inVoicemail} duration=${durationMs} reason=${JSON.stringify(disconnectionReason)} existing=${existing}`;
            }
          }
        }
      }
    }
  }
  check(`across all ${swept.toLocaleString()} input combinations`, stuck === null, stuck ?? undefined);
  // Paired with the sweep: a function that returned a constant would pass it.
  check(
    "and the result still varies with the input",
    new Set(
      reportedValues.map((reportedOutcome) =>
        resolveAnalysedOutcome({ reportedOutcome, durationMs: 0, existing: "IN_PROGRESS" })
      )
    ).size > 3
  );

  console.log("");
  console.log("What Retell reported, when it reported something usable");
  for (const name of CALL_OUTCOMES) {
    const want = name.toUpperCase() as PollCallOutcome;
    check(
      `${name} is taken at its word`,
      resolveAnalysedOutcome({ reportedOutcome: name, existing: "IN_PROGRESS" }) === want
    );
  }
  check(
    "case and surrounding space do not matter",
    resolveAnalysedOutcome({ reportedOutcome: "  Completed  ", existing: "IN_PROGRESS" }) === "COMPLETED"
  );
  check("an unknown string is not passed through", outcomeFromAnalysis("nonsense") === undefined);
  check("a non-string is not passed through", outcomeFromAnalysis(42) === undefined);
  // in_progress is not in CALL_OUTCOMES, so analysis cannot ask for it. If it
  // were ever added there, the sweep above would start failing.
  check("analysis cannot name IN_PROGRESS itself", outcomeFromAnalysis("in_progress") === undefined);

  console.log("");
  console.log("Falling back when the analysis is unreadable");
  const unreadable = { reportedOutcome: undefined, existing: "IN_PROGRESS" as PollCallOutcome };
  check(
    "a voicemail is a voicemail",
    resolveAnalysedOutcome({ ...unreadable, inVoicemail: true, durationMs: 20405 }) === "VOICEMAIL"
  );
  check(
    "zero duration means nobody spoke",
    resolveAnalysedOutcome({ ...unreadable, durationMs: 0 }) === "NO_CONVERSATION"
  );
  check(
    "a missing duration is treated as zero",
    resolveAnalysedOutcome({ ...unreadable, durationMs: null }) === "NO_CONVERSATION"
  );
  // Paired with the above: a fallback that always said NO_CONVERSATION would
  // pass those, and would claim nobody spoke on a two-minute call.
  check(
    "a call with real duration is partial, not silent",
    resolveAnalysedOutcome({ ...unreadable, durationMs: 25438 }) === "PARTIAL"
  );

  console.log("");
  console.log("The dial's own verdict beats guessing from duration");
  // The three stranded production rows: dial_no_answer, arriving as
  // call_analyzed because Retell attached an analysis, so the call_ended
  // branch that exists for exactly this case never ran.
  for (const reason of ["dial_no_answer", "dial_busy", "dial_failed"]) {
    check(
      `${reason} is NO_ANSWER, not an inference`,
      resolveAnalysedOutcome({ ...unreadable, durationMs: 0, disconnectionReason: reason }) ===
        "NO_ANSWER"
    );
  }
  check(
    "case and space in the reason do not matter",
    resolveAnalysedOutcome({ ...unreadable, disconnectionReason: " Dial_No_Answer " }) === "NO_ANSWER"
  );
  // Paired: a rule that called every disconnection reason NO_ANSWER would pass
  // the four above and would mislabel ordinary completed calls.
  check(
    "a normal hangup is not NO_ANSWER",
    resolveAnalysedOutcome({ ...unreadable, durationMs: 25438, disconnectionReason: "user_hangup" }) ===
      "PARTIAL"
  );
  check(
    "an absent reason falls back to duration",
    resolveAnalysedOutcome({ ...unreadable, durationMs: 25438, disconnectionReason: null }) === "PARTIAL"
  );
  // What Retell actually said still outranks the dial reason.
  check(
    "a reported outcome outranks the dial reason",
    resolveAnalysedOutcome({
      reportedOutcome: "completed",
      disconnectionReason: "dial_no_answer",
      existing: "IN_PROGRESS",
    }) === "COMPLETED"
  );
  check(
    "dialNeverConnected rejects a non-string",
    !dialNeverConnected(42) && !dialNeverConnected(null) && !dialNeverConnected(undefined)
  );
  // The property that makes inferring an outcome safe at all: a guess can
  // never promote a call into the base of a published figure.
  check(
    "no unreadable analysis is ever guessed into COMPLETED",
    junk.every((reportedOutcome) =>
      [true, false].every((inVoicemail) =>
        [0, 1, 99999].every(
          (durationMs) =>
            resolveAnalysedOutcome({
              reportedOutcome,
              inVoicemail,
              durationMs,
              existing: "IN_PROGRESS",
            }) !== "COMPLETED"
        )
      )
    )
  );

  console.log("");
  console.log("What the analysis may not overrule");
  for (const live of ["DO_NOT_CALL", "CALLBACK_REQUESTED"] as PollCallOutcome[]) {
    check(
      `${live} recorded live survives a contradicting analysis`,
      resolveAnalysedOutcome({ reportedOutcome: "completed", existing: live }) === live
    );
    check(
      `${live} survives an unreadable analysis too`,
      resolveAnalysedOutcome({ reportedOutcome: undefined, durationMs: 0, existing: live }) === live
    );
  }
  // The regression a blind fallback would introduce: a second analysis pass
  // arriving empty must not demote a row we already knew the answer for.
  check(
    "an unreadable analysis does not clobber a known outcome",
    resolveAnalysedOutcome({ reportedOutcome: undefined, durationMs: 0, existing: "COMPLETED" }) === "COMPLETED"
  );
  // Paired: a function that always kept `existing` would pass that one, and
  // would ignore Retell whenever it did report something.
  check(
    "but a readable analysis still revises it",
    resolveAnalysedOutcome({ reportedOutcome: "partial", existing: "COMPLETED" }) === "PARTIAL"
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
