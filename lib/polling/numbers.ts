/**
 * Screening a list of Cayman numbers before it becomes a calling campaign.
 *
 * The platform already refuses to dial a number that is not plainly Cayman or
 * NANP (`tryNormalizePhone`), already de-duplicates, and already checks the
 * do-not-call list — see `createPollBatch`. What it could not do is tell an
 * allocated exchange from one that does not exist, and for a list produced by
 * random digit dialling that is the difference that matters:
 *
 *   structurally valid NXX codes (N = 2-9)   800
 *   actually allocated by OfReg               86
 *
 * So RDD across structurally-valid space puts roughly 89% of its dials into
 * exchanges with no subscribers behind them. Everything here exists to catch
 * that before Retell is paid to find it out.
 *
 * Pure on purpose: no `lib/db.ts` import, so this runs under Node and
 * `scripts/check-numbers.ts` can exercise it. The checks that need the
 * database — do-not-call, already-called — stay in `calls.ts`, which is also
 * where they already were.
 */
import { OFREG_345, SOURCED_AT, type OfregRow } from "./nxx-345-data";
import { tryNormalizePhone } from "./phone";

export const NXX_SOURCED_AT = SOURCED_AT;

export type LineType = "mobile" | "fixed" | "premium" | "blocked" | "non-dialable" | "unknown";

export type NxxInfo = {
  nxx: string;
  holder: string;
  service: string;
  note: string;
  line: LineType;
  /** Could a call to this code be answered by somebody who might take a survey? */
  reachable: boolean;
  /** Reachable, but an office or business switchboard rather than a household. */
  institutional: boolean;
  /** Why it is unreachable, or why it is flagged. Null for an ordinary code. */
  reason: string | null;
  /**
   * OfReg published a service or a note that no rule below covers.
   *
   * Such a row is treated as **unreachable**, and `npm run check:numbers`
   * fails on it. A new allocation must not be able to become dialable just
   * because nothing here recognised it — see the note on conservatism below.
   *
   * Only raised where it could matter: an unparsed note on a code already
   * excluded by its service type is informational, since nothing here ever
   * upgrades a code to reachable.
   */
  unrecognised: boolean;
};

function lineOf(service: string): LineType {
  // Every mobile row OfReg publishes starts "Mobile", then varies freely:
  // "Mobile - GSM", "Mobile - Pre Pd. TDMA", "Mobile - GSM Post Paid". The
  // prefix is the stable part, and the technology behind it is not something
  // this platform acts on.
  if (service.startsWith("Mobile")) return "mobile";
  if (service === "Fixed") return "fixed";
  if (service === "Premium") return "premium";
  if (service === "Blocked") return "blocked";
  if (service === "Non-Dialable") return "non-dialable";
  return "unknown";
}

function serviceRecognised(service: string): boolean {
  // The empty string is recognised: OfReg genuinely leaves 345-638 blank, and
  // its note carries the meaning. Anything else unknown is not recognised.
  return service === "" || lineOf(service) !== "unknown";
}

/**
 * What a note means for whether we would dial the code. First match wins.
 *
 * No note OfReg currently publishes matches two of these, so the order is not
 * load-bearing today, and `check:numbers` asserts that rather than leaving it
 * to be assumed. First-match-wins is the structure for when one does overlap:
 * a note reading "Government Central Office Codes" and one reading "Cable and
 * Wireless internal use only" are both institutional-sounding, and only one of
 * them can answer a telephone, so an exclusion must win over a flag.
 */
export const NOTE_RULES: readonly {
  match: RegExp;
  reachable: boolean;
  institutional: boolean;
  reason: string;
}[] = [
  { match: /internal use only/i, reachable: false, institutional: false, reason: "carrier internal use" },
  { match: /Paging/i, reachable: false, institutional: false, reason: "paging range, not voice" },
  { match: /Temp\.? Location Directory Number/i, reachable: false, institutional: false, reason: "temporary location numbers, not subscribers" },
  { match: /National only/i, reachable: false, institutional: false, reason: "national-only service range" },
  { match: /Reserved in connection with LNP/i, reachable: false, institutional: false, reason: "reserved for number portability" },
  { match: /Internet (Service|Access)/i, reachable: false, institutional: false, reason: "internet access range" },
  { match: /Government Central Office Codes/i, reachable: true, institutional: true, reason: "government central office" },
  { match: /Direct Inward Dial/i, reachable: true, institutional: true, reason: "business direct-inward-dial range" },
];

/**
 * Notes that say nothing about who answers, so they need no rule.
 *
 * Kept narrow deliberately. "Effective <date>" is the only free-form note
 * OfReg currently uses that is pure metadata, and a date that has not arrived
 * yet is still a real allocation — Paradise Mobile's 412-416 were published
 * ahead of 9 March 2026 and are dialable now.
 */
const BENIGN_NOTE = /^(?:|Effective\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})$/i;

function classify([nxx, holder, service, note]: OfregRow): NxxInfo {
  const line = lineOf(service);
  const rule = NOTE_RULES.find((r) => r.match.test(note));
  const noteUnderstood = Boolean(rule) || BENIGN_NOTE.test(note);
  const dialableLine = line === "mobile" || line === "fixed";

  // A note needs a rule only where it could change the outcome, which means
  // only on a code whose service type would otherwise be dialed. 345-995 is
  // published "Non-Dialable" with the note "National (Stop Line) Allocation":
  // the service type has already settled it, and no rule here ever upgrades a
  // code to reachable, so an unparsed note on such a row cannot make it wrong.
  // Demanding a rule anyway made the first run of `check:numbers` fail on a
  // row that was classified correctly.
  const unrecognised = !serviceRecognised(service) || (dialableLine && !noteUnderstood);

  // Conservative by construction: a code is dialable only when its service is
  // one we know carries subscribers AND nothing unexplained is attached to it.
  // The failure this guards against is one-directional — misclassifying a live
  // exchange as unreachable costs reach and shows up as a count in the report,
  // while misclassifying a stop line or a paging range as reachable puts calls
  // somewhere they cannot be answered and nothing in the system contradicts it.
  const reachable = !unrecognised && dialableLine && (rule ? rule.reachable : true);

  return {
    nxx,
    holder,
    service,
    note,
    line,
    reachable,
    institutional: reachable && Boolean(rule?.institutional),
    reason: unrecognised
      ? `unrecognised OfReg entry (service ${JSON.stringify(service)}, note ${JSON.stringify(note)})`
      : rule
        ? rule.reason
        : dialableLine
          ? null
          : `published as ${service || "no service type"}`,
    unrecognised,
  };
}

export const NXX_345: readonly NxxInfo[] = OFREG_345.map(classify);

export const NXX_BY_CODE: ReadonlyMap<string, NxxInfo> = new Map(NXX_345.map((r) => [r.nxx, r]));

/**
 * The codes worth drawing from, for a generator that would rather not produce
 * numbers only to have them screened out. Ordinary reachable codes only:
 * government and business direct-inward-dial ranges are excluded here and
 * reported separately, because including them is a sampling decision and not
 * this module's to make.
 */
export const DIALABLE_NXX: readonly string[] = NXX_345.filter(
  (r) => r.reachable && !r.institutional
).map((r) => r.nxx);

export const MOBILE_NXX: readonly string[] = NXX_345.filter(
  (r) => r.reachable && !r.institutional && r.line === "mobile"
).map((r) => r.nxx);

export const FIXED_NXX: readonly string[] = NXX_345.filter(
  (r) => r.reachable && !r.institutional && r.line === "fixed"
).map((r) => r.nxx);

// --- Screening ---------------------------------------------------

export type Screened =
  | {
      verdict: "ok";
      input: string;
      e164: string;
      nxx: string;
      line: "mobile" | "fixed";
      holder: string;
      institutional: boolean;
    }
  | { verdict: "invalid"; input: string }
  | { verdict: "out-of-area"; input: string; e164: string }
  | { verdict: "unallocated"; input: string; e164: string; nxx: string }
  | { verdict: "not-dialable"; input: string; e164: string; nxx: string; reason: string }
  | { verdict: "duplicate"; input: string; e164: string };

export type ScreenCounts = {
  ok: number;
  mobile: number;
  fixed: number;
  institutional: number;
  invalid: number;
  outOfArea: number;
  unallocated: number;
  notDialable: number;
  duplicate: number;
};

export type ScreenReport = {
  total: number;
  rows: Screened[];
  /** Deduplicated E.164 numbers that passed, in the order they were given. */
  clean: string[];
  counts: ScreenCounts;
  /**
   * Unallocated exchanges, commonest first.
   *
   * The useful output for diagnosing a generator rather than a list: it names
   * the codes being drawn that do not exist, which is a property of the
   * generator and not of any one number.
   */
  unallocatedByNxx: readonly (readonly [string, number])[];
  sourcedAt: string;
};

export type ScreenOptions = {
  /** Keep government and business direct-inward-dial ranges. Off by default. */
  includeInstitutional?: boolean;
  /** Restrict to one line type. Both by default — dropping fixed lines skews a sample. */
  line?: "mobile" | "fixed" | "any";
};

/**
 * Screen a list without dialling it and without storing anything.
 *
 * Storing nothing is a requirement rather than an omission: the schema keeps
 * numbers only as an HMAC precisely so that a number cannot be recovered from
 * this platform, and a screening pass that wrote the plaintext list it was
 * handed would undo that for every list screened. It also keeps screening
 * distinguishable from calling, which matters if anyone ever asks what this
 * platform did with a number.
 */
export function screen(inputs: readonly string[], opts: ScreenOptions = {}): ScreenReport {
  const includeInstitutional = opts.includeInstitutional ?? false;
  const line = opts.line ?? "any";

  const rows: Screened[] = [];
  const clean: string[] = [];
  const seen = new Set<string>();
  const unallocated = new Map<string, number>();

  for (const input of inputs) {
    const e164 = tryNormalizePhone(input);
    if (!e164) {
      rows.push({ verdict: "invalid", input });
      continue;
    }
    if (!e164.startsWith("+1345")) {
      rows.push({ verdict: "out-of-area", input, e164 });
      continue;
    }
    // Duplicate is decided on the normalised number, so "9491234" and
    // "+1 345 949 1234" are one number rather than two.
    if (seen.has(e164)) {
      rows.push({ verdict: "duplicate", input, e164 });
      continue;
    }
    seen.add(e164);

    const nxx = e164.slice(5, 8);
    const info = NXX_BY_CODE.get(nxx);
    if (!info) {
      unallocated.set(nxx, (unallocated.get(nxx) ?? 0) + 1);
      rows.push({ verdict: "unallocated", input, e164, nxx });
      continue;
    }
    if (!info.reachable) {
      rows.push({ verdict: "not-dialable", input, e164, nxx, reason: info.reason ?? "not dialable" });
      continue;
    }
    if (info.institutional && !includeInstitutional) {
      rows.push({ verdict: "not-dialable", input, e164, nxx, reason: info.reason ?? "institutional range" });
      continue;
    }
    if (line !== "any" && info.line !== line) {
      rows.push({ verdict: "not-dialable", input, e164, nxx, reason: `${info.line} line, ${line} only requested` });
      continue;
    }

    rows.push({
      verdict: "ok",
      input,
      e164,
      nxx,
      line: info.line as "mobile" | "fixed",
      holder: info.holder,
      institutional: info.institutional,
    });
    clean.push(e164);
  }

  const ok = rows.filter((r) => r.verdict === "ok");
  return {
    total: inputs.length,
    rows,
    clean,
    counts: {
      ok: ok.length,
      mobile: ok.filter((r) => r.verdict === "ok" && r.line === "mobile").length,
      fixed: ok.filter((r) => r.verdict === "ok" && r.line === "fixed").length,
      institutional: ok.filter((r) => r.verdict === "ok" && r.institutional).length,
      invalid: rows.filter((r) => r.verdict === "invalid").length,
      outOfArea: rows.filter((r) => r.verdict === "out-of-area").length,
      unallocated: rows.filter((r) => r.verdict === "unallocated").length,
      notDialable: rows.filter((r) => r.verdict === "not-dialable").length,
      duplicate: rows.filter((r) => r.verdict === "duplicate").length,
    },
    unallocatedByNxx: [...unallocated.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    sourcedAt: SOURCED_AT,
  };
}

/**
 * Pull one phone number per line from pasted text or a CSV/TXT upload: the
 * first cell with at least seven digits. Header rows have none, so they drop
 * out on their own.
 *
 * Lives here rather than beside the action that used to own it so the route
 * handler, the action and `check:numbers` all parse a list the same way. A
 * screening pass that disagreed with the dialling pass about what counts as a
 * line would report on a list nobody is about to call.
 */
export function extractNumbers(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/).find((cell) => cell.replace(/\D/g, "").length >= 7))
    .filter((cell): cell is string => Boolean(cell))
    .map((cell) => cell.replace(/^["']|["']$/g, "").trim());
}
