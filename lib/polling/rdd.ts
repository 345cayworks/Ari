/**
 * The Cayman random-digit-dial sampling frame, as seen from Polimeter.
 *
 * The frame itself is a separate Cloudflare Worker holding ~100,965 numbers
 * drawn uniformly from 47 regulator-confirmed Cayman mobile NXX blocks, out of
 * a 470,000-number universe. This module is the client for it, and the whole
 * reason the poll statistics in `lib/polling/weighting.ts` and
 * `lib/polling/results.ts` mean anything: cooperation rate, effective n,
 * design effect and margin of error are only strictly defined over a sample
 * with known selection probabilities. An uploaded list has none. A draw from
 * this frame does.
 *
 * Pure on purpose: nothing here touches the database, so `scripts/check-rdd.ts`
 * can exercise the CSV parser and the disposition mapping under plain Node.
 * `lib/db.ts` is the driver-adapter Prisma client and does not run under Node
 * at all, which is why the split exists rather than a preference. The
 * database-facing half is `lib/polling/rdd-frame.ts`.
 *
 * There is no paid phone-screening step in front of this and there must not
 * be one added. It was measured: Twilio Lookup returned "mobile" for 187 of
 * 187 randomly generated Cayman numbers, including the 345-919 range, which
 * holds no subscribers at all; hlr-lookups.com answered out of a portability
 * database rather than querying the network. Both resolve per *block*, not per
 * number, so neither can tell a live Cayman mobile from a dead one. A number's
 * liveness can only be established by dialling it, which means the dial
 * outcome IS the screening step — and it is why roughly seven in ten of any
 * draw is an unassigned number that dies on the first ring. That is the
 * expected shape of the work, not a fault, and it is why a draw is
 * oversampled against the frame's measured assignment rate.
 */

// --- Talking to the worker ---------------------------------------

export interface RddCredentials {
  baseUrl: string;
  token: string;
}

/** What `POST /api/samples` reports about a draw. */
export interface RddSampleDraw {
  sampleId: string;
  /** Numbers the worker intended to hand over, after oversampling. */
  targetSize: number;
  /** Numbers it actually could hand over. */
  actualSize: number;
  /** Numbers it had left to draw from. */
  candidatePool: number;
  /** targetSize minus actualSize, when the pool ran short. */
  shortfall: number;
  /** The assignment rate the oversample was computed against, 0–1. */
  assignmentRate: number | null;
}

/** One row of `GET /api/samples/:id/export.csv`. */
export interface RddDialRow {
  e164: string;
  operator: string | null;
  /**
   * The disposition the frame already holds, or null if it holds none.
   *
   * Null covers both an empty cell and the frame's `not_attempted` default —
   * see `DISPOSITION_NOT_REPORTED`. The distinction does not exist for any
   * caller, and collapsing it here is what stops the write-back's progress
   * marker reading "already reported" for a number never reported.
   */
  disposition: string | null;
}

export class RddError extends Error {}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function rddFetch(
  creds: RddCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<string> {
  const base = normalizeBaseUrl(creds.baseUrl);
  if (base === "") throw new RddError("No sampling-frame URL is configured.");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // The status is kept in the message because the two that matter are told
    // apart by it and by nothing else: a 401 is the token, a 404 on a sample
    // is a draw that no longer exists at the far end.
    throw new RddError(`Sampling frame ${method} ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

/**
 * Read a number out of a response whose exact key casing is a copy of the
 * worker's, held in two repositories with no shared package.
 *
 * Both spellings are accepted rather than one being guessed, because the cost
 * of guessing wrong is a draw that silently reports `targetSize: 0` and an
 * operator who cannot tell a short pool from a parse miss.
 */
function num(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function str(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

export interface DrawRequest {
  name: string;
  targetLive: number;
  seed?: string;
  maxAttempts?: number;
}

/**
 * Draw an oversampled batch.
 *
 * `targetLive` is a number of *live respondents*, not a number of numbers: the
 * worker multiplies it up by the frame's measured assignment rate, which is
 * the whole point of asking it rather than guessing a multiplier here. The
 * seed is passed through so a draw can be reproduced, which is what makes the
 * selection auditable after publication.
 */
export async function drawSample(creds: RddCredentials, req: DrawRequest): Promise<RddSampleDraw> {
  const text = await rddFetch(creds, "POST", "/api/samples", {
    name: req.name,
    targetLive: req.targetLive,
    ...(req.seed ? { seed: req.seed } : {}),
    ...(req.maxAttempts ? { maxAttempts: req.maxAttempts } : {}),
  });
  return parseSampleDraw(text);
}

export function parseSampleDraw(text: string): RddSampleDraw {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RddError("The sampling frame did not return JSON for the draw.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RddError("The sampling frame returned an unexpected shape for the draw.");
  }
  const obj = parsed as Record<string, unknown>;
  // Some workers wrap the body in `sample`; read through it if present.
  const inner =
    obj.sample && typeof obj.sample === "object" && !Array.isArray(obj.sample)
      ? { ...obj, ...(obj.sample as Record<string, unknown>) }
      : obj;

  const sampleId = str(inner, "sampleId", "sample_id", "id");
  if (sampleId === null) throw new RddError("The draw came back without a sample id.");

  const targetSize = num(inner, "targetSize", "target_size") ?? 0;
  const actualSize = num(inner, "actualSize", "actual_size") ?? 0;
  return {
    sampleId,
    targetSize,
    actualSize,
    candidatePool: num(inner, "candidatePool", "candidate_pool") ?? 0,
    // Derived when absent rather than defaulted to zero: a shortfall the
    // worker did not name is still a shortfall, and reporting none would tell
    // an operator the draw was full when it was not.
    shortfall: num(inner, "shortfall") ?? Math.max(0, targetSize - actualSize),
    assignmentRate: num(inner, "assignmentRate", "assignment_rate"),
  };
}

export async function fetchDialList(
  creds: RddCredentials,
  sampleId: string,
): Promise<RddDialRow[]> {
  const csv = await rddFetch(creds, "GET", `/api/samples/${encodeURIComponent(sampleId)}/export.csv`);
  return parseDialList(csv);
}

export async function fetchFrameStats(creds: RddCredentials): Promise<Record<string, unknown>> {
  const text = await rddFetch(creds, "GET", "/api/stats");
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Report one number's frame disposition.
 *
 * Read the contract in `reportableDisposition` below before changing anything
 * about what reaches this function. It is the only write this platform makes
 * to the frame, and it is deliberately the narrowest one that keeps the frame
 * usable.
 */
export async function postDisposition(
  creds: RddCredentials,
  sampleId: string,
  e164: string,
  disposition: string,
): Promise<void> {
  await rddFetch(creds, "POST", `/api/samples/${encodeURIComponent(sampleId)}/disposition`, {
    e164,
    disposition,
  });
}

// --- The dial list ------------------------------------------------

/**
 * Split one CSV line, honouring double quotes and doubled quotes inside them.
 *
 * Hand-rolled rather than a dependency: the file has six columns, one of which
 * is a carrier name that can contain a comma, and nothing else about it needs
 * a parser. Written out because a `split(",")` here would silently shift every
 * column right of the first quoted comma.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * The dial list, reduced to the three fields this platform has a use for.
 *
 * `carrier_name`, `attempts` and `last_attempt_at` are parsed past and
 * dropped. That is not laziness: a per-respondent carrier attribute stored
 * beside that respondent's answers is a quasi-identifier in a small
 * jurisdiction, and the frame was already verified uniform across all four
 * operators, so there is nothing a per-number carrier buys a poll. The
 * operator column survives only as far as `operatorMix`, which is a
 * batch-level count and carries no row.
 *
 * `disposition` is kept because it is what the frame already knows about each
 * number, and it is the write-back's progress marker — see
 * `lib/polling/rdd-frame.ts`. Holding that state at the frame rather than here
 * is deliberate: the alternative is a table in this database mapping a
 * plaintext number to a call, which is exactly the join the whole design
 * exists to prevent.
 */
export function parseDialList(csv: string): RddDialRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const at = (...names: string[]): number => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iE164 = at("e164", "e_164", "number", "msisdn");
  // A header row is required rather than inferred by position. Reading column
  // 0 as the number when the header is missing would turn a changed export
  // into a batch of calls to whatever the first column now holds.
  if (iE164 === -1) {
    throw new RddError("The dial list has no e164 column; the export format has changed.");
  }
  const iOperator = at("operator");
  const iDisposition = at("disposition");

  const rows: RddDialRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const e164 = cells[iE164] ?? "";
    if (e164 === "") continue;
    const disposition = iDisposition === -1 ? "" : (cells[iDisposition] ?? "");
    const reported =
      disposition === "" || disposition.toLowerCase() === DISPOSITION_NOT_REPORTED
        ? null
        : disposition;
    rows.push({
      e164,
      operator: iOperator === -1 ? null : (cells[iOperator] ?? "") || null,
      disposition: reported,
    });
  }
  return rows;
}

/** Batch-level counts per operator. An aggregate: no row, no number. */
export function operatorMix(rows: RddDialRow[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const row of rows) {
    const key = row.operator ?? "unknown";
    mix[key] = (mix[key] ?? 0) + 1;
  }
  return mix;
}

// --- What may be reported back ------------------------------------

/**
 * ============================================================
 * THE WRITE-BACK CONTRACT. Read this before widening anything.
 * ============================================================
 *
 * Polimeter stores a respondent's telephone number only as an HMAC
 * (`PollCall.phoneHash`, see `lib/polling/phone.ts`). There is no plaintext
 * telephone column anywhere in this schema except `PollCallback.phoneNumber`,
 * which exists to dial back and is blanked the moment it is used. Every
 * respondent is told, in the agent's own opening line, that their answers are
 * anonymous.
 *
 * The sampling frame holds the plaintext numbers. So the two datasets are one
 * HMAC apart: anyone holding both, plus `PHONE_HASH_SECRET`, can hash the
 * frame's plaintext and join. The anonymity promise therefore does not rest on
 * the hash. It rests on the frame never learning anything about a respondent's
 * *answers*, or about which poll response came from which number. Keep that
 * true and the join yields nothing worth having; break it once and the promise
 * is retroactively false for every interview already conducted.
 *
 * Hence exactly two values ever leave this platform for the frame:
 *
 *   unassigned -> "disconnected"   the number does not exist
 *   reached    -> one live value   the number exists
 *
 * and nothing else. Not completes, not refusals, not partials, not answers,
 * not sentiment, not summaries, not consent, not question progress, not
 * do-not-call, not call duration, not a timestamp of our choosing. A refusal
 * and an eight-minute completed interview send byte-identical payloads, and
 * that identity is the mechanism rather than an accident of the current
 * mapping. "This number completed a poll" is withheld too: it is participation
 * data about an identifiable person and the frame has no use for it.
 *
 * The division of labour, stated so a later change has to argue with it:
 * Polimeter owns outcomes, the frame owns hygiene. The frame needs to know
 * which numbers are not worth drawing again and roughly what share of the
 * universe is live. Both of those are answered by assigned/not-assigned. Every
 * richer disposition it might like is a disclosure this side cannot make.
 *
 * If a future need seems to require more, the honest move is to change the
 * consent script first and tell respondents what is shared, not to widen this
 * payload. A cleaner split would be for the frame to hold no outcome at all
 * and for Polimeter to publish only an aggregate assignment rate; that was
 * considered and rejected because the frame must suppress specific dead
 * numbers to stay usable, which cannot be done from an aggregate.
 */

/** The frame's value for a number that does not exist. */
export const DISPOSITION_UNASSIGNED = "disconnected";

/**
 * The frame's spelling for a number it has never been told anything about.
 *
 * Its `sample_members.disposition` column is `NOT NULL DEFAULT
 * 'not_attempted'`, so every row of the export carries a value and a number
 * awaiting its first report reads `not_attempted` — never an empty cell.
 * Observed on the live frame: `+13453210151,Digicel Cayman Limited,,
 * not_attempted,0,`.
 *
 * This matters because `reportFrameOutcomes` uses the frame's own column as
 * its progress marker, skipping anything that already carries a disposition.
 * Read literally, that skipped everything, and the write-back reported
 * nothing while returning success. So the sentinel is normalised away here, at
 * the parse boundary, rather than special-cased at the one call site: the
 * field means "what the frame already knows about this number", and "nothing
 * yet" is `null`.
 */
export const DISPOSITION_NOT_REPORTED = "not_attempted";

/**
 * The single value reported for every number that turned out to exist.
 *
 * One value, not a vocabulary. "live" is the default because it is true of
 * every case it covers and says nothing more: a number that rang out, a number
 * that was engaged, a number that refused and a number that completed the
 * whole questionnaire all send this.
 *
 * CONFIRMED ACCEPTED BY THE WORKER, 2026-11-03. Established by probing with
 * a deliberately invalid value, which the worker refuses with 400 and an
 * enumeration of what it takes — so the vocabulary is readable without
 * writing anything to a real number. "live" now appears in it, alongside
 * "disconnected", which confirms both halves of the payload.
 *
 * It did not at first. The initial probe returned a list in which every value
 * but "disconnected" and "not_attempted" named an outcome, four of them
 * ("complete", "refused", "no_answer", "voicemail") among the strings
 * `scripts/check-rdd.ts` asserts can never reach the allowlist here. Nothing
 * on that list could be sent truthfully: "complete" for a refusal is a lie,
 * and any of them discloses what the contract above withholds. So the value
 * was added at the far end rather than substituted at this one — which is the
 * precedent worth keeping if the frame ever wants a richer disposition again.
 */
export const DISPOSITION_LIVE_DEFAULT = "live";

/**
 * The only live values an operator may configure.
 *
 * An allowlist rather than a free-text field, because a free-text field is how
 * the contract above gets widened without anyone editing this file: someone
 * types "completed" into a settings box one afternoon and the frame starts
 * learning who answered. Every value here asserts that the number exists and
 * nothing else. A value naming an outcome — "answered", "refused",
 * "no_answer", "voicemail", "complete" — does not belong on this list, and
 * "answered" is excluded on purpose despite being the likeliest spelling at
 * the far end: a number that rang out unanswered is still live, so reporting
 * it as answered would be both a disclosure shape and a lie.
 */
export const LIVE_DISPOSITIONS = ["live", "assigned", "in_service", "active", "ring"] as const;

export function isLiveDisposition(value: string): boolean {
  return (LIVE_DISPOSITIONS as readonly string[]).includes(value);
}

/**
 * What a dial outcome says about the number's existence, and nothing else.
 *
 * Three values, because "we have no evidence either way" is a real answer and
 * reporting it as either of the others corrupts the frame — in one direction
 * by suppressing a live number for good, in the other by inflating the
 * assignment rate the next oversample is computed from.
 */
export type FrameSignal = "unassigned" | "reached" | "unknown";

/**
 * The narrow input this mapping is allowed to see.
 *
 * Deliberately not `PollCall`. The function cannot leak an answer, a summary
 * or a sentiment into the frame because it is never handed one, and a later
 * edit that wants to would have to widen this type first — which is a visible
 * change in a reviewed diff rather than a quiet read of a field that happened
 * to be in scope.
 */
export interface DialEvidence {
  outcome: string;
  disconnectionReason: string | null;
}

/**
 * Retell's reason for a call that never connected.
 *
 * `dial_failed` is the carrier refusing call setup, which for a number drawn
 * from a confirmed-allocated Cayman mobile block is the signature of an
 * unassigned subscriber number. `dial_no_answer` and `dial_busy` are the
 * opposite: something was there to ring or to be engaged, so the number
 * exists. Getting those two the wrong way round would permanently delete live
 * numbers from the frame, so they are named rather than lumped into a
 * not-reached set.
 */
const DIAL_UNASSIGNED = "dial_failed";
const DIAL_REACHED = new Set(["dial_no_answer", "dial_busy"]);

export function frameSignal(evidence: DialEvidence): FrameSignal {
  // A call still running tells us nothing yet.
  if (evidence.outcome === "IN_PROGRESS") return "unknown";

  const reason = (evidence.disconnectionReason ?? "").trim().toLowerCase();
  if (reason === DIAL_UNASSIGNED) return "unassigned";
  if (DIAL_REACHED.has(reason)) return "reached";

  // Anything that reached an outcome other than NO_ANSWER got far enough for
  // the agent to be on the line, which only happens on a number that exists.
  // This covers every conversational outcome without enumerating them, so a
  // new outcome added to the enum later is read as "reached" rather than
  // silently falling through to "unknown".
  if (evidence.outcome !== "NO_ANSWER") return "reached";

  // NO_ANSWER with an unrecognised or absent reason: no evidence either way.
  return "unknown";
}

/**
 * Combine several calls to the same number into one signal.
 *
 * Any evidence that the number exists settles it, whatever a later attempt
 * did: a number that talked on Tuesday and failed to dial on Thursday is a
 * live number behind a network fault, and reporting it unassigned would remove
 * a real respondent from the universe for good. Evidence of existence is
 * therefore sticky and evidence of absence is not.
 */
export function combineSignals(signals: FrameSignal[]): FrameSignal {
  if (signals.includes("reached")) return "reached";
  if (signals.includes("unassigned")) return "unassigned";
  return "unknown";
}

/** The value to send for a signal, or null when there is nothing to say. */
export function reportableDisposition(signal: FrameSignal, liveDisposition: string): string | null {
  if (signal === "unassigned") return DISPOSITION_UNASSIGNED;
  if (signal === "reached") return liveDisposition;
  return null;
}

// --- Guards -------------------------------------------------------

/**
 * Above this share of unassigned, a write-back refuses to run.
 *
 * `dial_failed` is also what a broken SIP trunk, an exhausted concurrency
 * limit and a misconfigured caller number look like, and those are
 * indistinguishable per call from a dead number. Per call it does not matter —
 * suppressing one number costs almost nothing. Across a whole batch it matters
 * a great deal: a trunk that was down for an hour would report every number it
 * touched as disconnected and quietly burn several hundred live numbers out of
 * a 470,000-number universe, permanently, with no record of which.
 *
 * The frame's measured assignment rate puts the honest figure near seven in
 * ten unassigned. A batch at 97% is not a run of bad luck, it is a fault at
 * this end. 0.95 leaves room for a genuinely unlucky draw and still catches
 * the only failure mode that destroys data.
 */
export const IMPLAUSIBLE_UNASSIGNED_SHARE = 0.95;

/** Below this many calls the share above is noise, so the guard stays quiet. */
export const GUARD_MIN_CALLS = 40;

/**
 * Dispositions reported per run.
 *
 * A Cloudflare Worker gets a bounded number of subrequests per request, and a
 * draw targeting 500 live respondents is some 1,700 numbers. So a run reports
 * a page and the operator presses the button again; the frame's own
 * `disposition` column is what records how far it got, which means no progress
 * state is kept on this side and no plaintext number has to be stored here to
 * track it.
 */
export const MAX_DISPOSITIONS_PER_RUN = 300;
