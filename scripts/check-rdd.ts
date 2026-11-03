/**
 * Checks the sampling-frame client: the dial-list parser, the format gate, and
 * the disposition mapping that is the only thing this platform writes back.
 *
 * Run with:  npm run check:rdd
 *
 * Worth its own script for two separate reasons.
 *
 * The parser: a dial list whose columns have shifted is a batch of calls
 * placed to whatever the first column now holds, and that failure is visible
 * only on the phone bill.
 *
 * The mapping: the write-back contract in `lib/polling/rdd.ts` says exactly
 * two values ever leave for the frame, and a contract stated in a comment is
 * one a later edit can widen without noticing. The assertions below hold it
 * shut mechanically — every outcome in the Prisma enum is pushed through the
 * mapping and the set of values it can produce is checked to have size two.
 *
 * Every assertion is paired with the thing that would make it pass by
 * accident. "dial_failed is unassigned" is worthless without "dial_no_answer
 * is not", and "the parser finds e164" is worthless without "it refuses a file
 * that has no e164 column".
 */
import { tryNormalizePhone } from "../lib/polling/phone";
import {
  combineSignals,
  DISPOSITION_LIVE_DEFAULT,
  DISPOSITION_UNASSIGNED,
  frameSignal,
  isLiveDisposition,
  LIVE_DISPOSITIONS,
  operatorMix,
  parseDialList,
  parseSampleDraw,
  RddError,
  reportableDisposition,
  normalizeBaseUrl,
} from "../lib/polling/rdd";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

/** Every value of the Prisma `PollCallOutcome` enum, copied rather than imported. */
const OUTCOMES = [
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
  console.log("The dial list");

  const csv = [
    "e164,operator,carrier_name,disposition,attempts,last_attempt_at",
    "+13455550101,Flow,\"Cable & Wireless (Cayman), Ltd.\",,0,",
    "+13455550102,Digicel,Digicel Cayman,disconnected,1,2026-11-01T14:02:00Z",
    "+13455550103,Flow,\"Cable & Wireless (Cayman), Ltd.\",,0,",
    "",
  ].join("\n");
  const rows = parseDialList(csv);
  check("three rows parse", rows.length === 3, `got ${rows.length}`);
  check("the number is read from the e164 column", rows[0]?.e164 === "+13455550101", rows[0]?.e164);
  // Without this, a split(",") parser would pass everything above: the carrier
  // name holds a comma, so a naive split shifts disposition into carrier.
  check(
    "a quoted comma in carrier_name does not shift the columns",
    rows[1]?.disposition === "disconnected",
    JSON.stringify(rows[1]),
  );
  check("an undialled row has a null disposition", rows[0]?.disposition === null);
  check("the operator survives", rows[0]?.operator === "Flow", String(rows[0]?.operator));
  check("a trailing blank line is not a row", !rows.some((r) => r.e164 === ""));

  // Column order is read from the header, not assumed.
  const reordered = parseDialList(
    ["disposition,operator,e164", "live,Flow,+13455550104"].join("\n"),
  );
  check(
    "columns in a different order still parse",
    reordered[0]?.e164 === "+13455550104" && reordered[0]?.disposition === "live",
    JSON.stringify(reordered[0]),
  );

  // And a file with no e164 column must throw rather than read column 0,
  // which is the whole point of requiring a header.
  let threw = false;
  try {
    parseDialList(["number_x,operator", "+13455550105,Flow"].join("\n"));
  } catch (err) {
    threw = err instanceof RddError;
  }
  check("a dial list with no e164 column is refused", threw);

  check(
    "the operator mix is a count and nothing else",
    JSON.stringify(operatorMix(rows)) === JSON.stringify({ Flow: 2, Digicel: 1 }),
    JSON.stringify(operatorMix(rows)),
  );

  console.log("\nThe format gate stays in the path");

  // The reason tryNormalizePhone is not skipped for frame output: it is cheap,
  // and it is what caught an 11-digit typo being dialled to France.
  check(
    "frame output passes the gate unchanged",
    tryNormalizePhone("+13455550101") === "+13455550101",
    String(tryNormalizePhone("+13455550101")),
  );
  check(
    "a malformed frame row is refused rather than dialled",
    tryNormalizePhone("+3345532490001") === null,
  );
  check("the France-shaped typo is still refused", tryNormalizePhone("33453249000") === null);
  // Paired with the above: a gate that refused everything would pass it.
  check("a plain seven-digit Cayman number is still accepted", tryNormalizePhone("5550101") === "+13455550101");

  console.log("\nWhat the frame is told");

  check(
    "a number that failed to dial is unassigned",
    frameSignal({ outcome: "NO_ANSWER", disconnectionReason: "dial_failed" }) === "unassigned",
  );
  // Without these two, a mapping that called everything unassigned would pass
  // the line above — and would permanently delete live numbers from the frame.
  check(
    "a number that rang out is reached, not unassigned",
    frameSignal({ outcome: "NO_ANSWER", disconnectionReason: "dial_no_answer" }) === "reached",
  );
  check(
    "a number that was engaged is reached",
    frameSignal({ outcome: "NO_ANSWER", disconnectionReason: "dial_busy" }) === "reached",
  );
  check(
    "a call still running says nothing",
    frameSignal({ outcome: "IN_PROGRESS", disconnectionReason: null }) === "unknown",
  );
  check(
    "no answer with no reason says nothing",
    frameSignal({ outcome: "NO_ANSWER", disconnectionReason: null }) === "unknown",
  );
  check(
    "a conversational outcome is reached",
    frameSignal({ outcome: "REFUSED", disconnectionReason: "user_hangup" }) === "reached",
  );

  check(
    "evidence the number exists outranks a later dial failure",
    combineSignals(["unassigned", "reached"]) === "reached",
  );
  check(
    "and two failures are still unassigned",
    combineSignals(["unassigned", "unassigned"]) === "unassigned",
  );
  check("nothing known stays nothing known", combineSignals(["unknown"]) === "unknown");

  console.log("\nThe write-back cannot widen");

  // The contract: exactly two values may ever leave for the frame, and a
  // refusal must be indistinguishable from a completed interview. Run every
  // outcome in the enum, against every dial reason, through the mapping and
  // count the distinct values that come out.
  const reasons = [null, "dial_failed", "dial_no_answer", "dial_busy", "user_hangup", "agent_hangup", "error_llm"];
  const emitted = new Set<string>();
  for (const outcome of OUTCOMES) {
    for (const reason of reasons) {
      const value = reportableDisposition(
        frameSignal({ outcome, disconnectionReason: reason }),
        DISPOSITION_LIVE_DEFAULT,
      );
      if (value !== null) emitted.add(value);
    }
  }
  check(
    "exactly two values can ever be sent",
    emitted.size === 2,
    [...emitted].join(", "),
  );
  check(
    "and they are the two intended ones",
    emitted.has(DISPOSITION_UNASSIGNED) && emitted.has(DISPOSITION_LIVE_DEFAULT),
    [...emitted].join(", "),
  );
  check(
    "a completed interview and a refusal are indistinguishable",
    reportableDisposition(
      frameSignal({ outcome: "COMPLETED", disconnectionReason: "agent_hangup" }),
      DISPOSITION_LIVE_DEFAULT,
    ) ===
      reportableDisposition(
        frameSignal({ outcome: "REFUSED", disconnectionReason: "user_hangup" }),
        DISPOSITION_LIVE_DEFAULT,
      ),
  );
  check(
    "a do-not-call request reports the same as any other live number",
    reportableDisposition(
      frameSignal({ outcome: "DO_NOT_CALL", disconnectionReason: "agent_hangup" }),
      DISPOSITION_LIVE_DEFAULT,
    ) === DISPOSITION_LIVE_DEFAULT,
  );
  check("an unknown signal sends nothing", reportableDisposition("unknown", DISPOSITION_LIVE_DEFAULT) === null);

  // The allowlist is the other half of the same guard: the configurable value
  // must not be able to name an outcome.
  check("the default live value is on the allowlist", isLiveDisposition(DISPOSITION_LIVE_DEFAULT));
  for (const outcomeish of ["completed", "complete", "refused", "answered", "no_answer", "voicemail", "interviewed"]) {
    check(`"${outcomeish}" is not an allowed live value`, !isLiveDisposition(outcomeish));
  }
  check(
    "the allowlist does not contain the unassigned value either",
    !(LIVE_DISPOSITIONS as readonly string[]).includes(DISPOSITION_UNASSIGNED),
  );

  console.log("\nThe draw response");

  const camel = parseSampleDraw(
    JSON.stringify({
      sampleId: "smp_1",
      targetSize: 1400,
      actualSize: 1400,
      candidatePool: 98000,
      shortfall: 0,
      assignmentRate: 0.29,
    }),
  );
  check("camelCase keys parse", camel.sampleId === "smp_1" && camel.targetSize === 1400);
  const snake = parseSampleDraw(
    JSON.stringify({
      sample_id: "smp_2",
      target_size: 1400,
      actual_size: 1200,
      candidate_pool: 400,
      assignment_rate: 0.29,
    }),
  );
  check("snake_case keys parse too", snake.sampleId === "smp_2" && snake.candidatePool === 400);
  // A shortfall the worker did not name is still a shortfall. Reporting none
  // would tell an operator the draw was full when it was 200 short.
  check("an unnamed shortfall is derived", snake.shortfall === 200, String(snake.shortfall));
  let drawThrew = false;
  try {
    parseSampleDraw(JSON.stringify({ targetSize: 10 }));
  } catch (err) {
    drawThrew = err instanceof RddError;
  }
  check("a draw with no sample id is refused", drawThrew);

  check("a trailing slash on the base URL is dropped", normalizeBaseUrl("https://x.dev/") === "https://x.dev");

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

main();
