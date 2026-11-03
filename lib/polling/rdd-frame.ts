import type { Poll, PollBatch } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPollBatch, type BatchOptions } from "./calls";
import { hashPhone, tryNormalizePhone } from "./phone";
import { MAX_BATCH_NUMBERS } from "./results";
import { fingerprint, open } from "./secret-box";
import {
  combineSignals,
  drawSample,
  fetchDialList,
  fetchFrameStats,
  GUARD_MIN_CALLS,
  IMPLAUSIBLE_UNASSIGNED_SHARE,
  isLiveDisposition,
  MAX_DISPOSITIONS_PER_RUN,
  normalizeBaseUrl,
  operatorMix,
  postDisposition,
  reportableDisposition,
  RddError,
  frameSignal,
  DISPOSITION_LIVE_DEFAULT,
  type FrameSignal,
  type RddCredentials,
  type RddDialRow,
} from "./rdd";

/**
 * Drawing a probability sample from the Cayman RDD frame, and reporting frame
 * hygiene back to it.
 *
 * Imports `lib/db.ts`, so this module runs in the Worker and nowhere else —
 * not under `next dev`, not in a script. The parsing and the disposition
 * mapping live in `lib/polling/rdd.ts`, which is pure for exactly that reason
 * and is where the write-back contract is written down. Read it before
 * changing what this file sends.
 */

// --- Credentials --------------------------------------------------

export interface RddConfig {
  /** A draw is possible: a URL and a token that opens. */
  ready: boolean;
  baseUrl: string;
  /** Present or not; the token itself is never returned, logged or rendered. */
  hasToken: boolean;
  tokenSource: "none" | "stored" | "environment";
  fingerprint: string | null;
  /** The one value a reached number is reported as. */
  liveDisposition: string;
  /** Set when a stored token exists but would not decrypt. */
  problem: string | null;
}

/**
 * Where the frame's URL and token come from, in that order of preference.
 *
 * A stored `RddSource` wins over the environment, and the environment path
 * stays because it is still the safer of the two — the same arrangement, for
 * the same reasons, as `loadFeedConfig` in `lib/polling/feed.ts`. Retell's own
 * credentials are environment-only, which is the pattern this follows; the
 * stored row exists so a token can be rotated from the admin pages rather than
 * through `wrangler secret put`.
 */
export async function loadRddConfig(tenantId: string): Promise<RddConfig> {
  const stored = await prisma.rddSource.findFirst({
    where: { tenantId, revokedAt: null },
    select: { baseUrl: true, tokenSealed: true, tokenFingerprint: true, liveDisposition: true },
  });

  const envUrl = normalizeBaseUrl(process.env.RDD_BASE_URL ?? "");

  if (stored !== null) {
    // Opened here rather than at draw time so the panel can say "the stored
    // token will not decrypt" instead of letting a draw fail with it.
    const plaintext = await open(stored.tokenSealed);
    const baseUrl = normalizeBaseUrl(stored.baseUrl) || envUrl;
    return {
      ready: plaintext !== null && baseUrl !== "",
      baseUrl,
      hasToken: plaintext !== null,
      tokenSource: plaintext === null ? "none" : "stored",
      fingerprint: stored.tokenFingerprint,
      liveDisposition: safeLiveDisposition(stored.liveDisposition),
      problem:
        plaintext === null
          ? "The stored sampling-frame token could not be decrypted. PHONE_HASH_SECRET has most likely changed; paste the token again to replace it."
          : null,
    };
  }

  const fromEnv = process.env.RDD_API_TOKEN;
  return {
    ready: Boolean(fromEnv) && envUrl !== "",
    baseUrl: envUrl,
    hasToken: Boolean(fromEnv),
    tokenSource: fromEnv ? "environment" : "none",
    fingerprint: fromEnv ? await fingerprint(fromEnv) : null,
    liveDisposition: safeLiveDisposition(process.env.RDD_LIVE_DISPOSITION),
    problem: null,
  };
}

/**
 * Fall back to the default rather than trust a stored or environment value.
 *
 * The allowlist is in `lib/polling/rdd.ts` beside the contract it protects. An
 * unrecognised value is not an error here: it is quietly replaced by the
 * default, because the alternative is a platform that refuses to report frame
 * hygiene until somebody fixes a settings field, and a wrong value in that
 * field is the one failure that could widen what the frame learns.
 */
function safeLiveDisposition(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed !== "" && isLiveDisposition(trimmed) ? trimmed : DISPOSITION_LIVE_DEFAULT;
}

/** The credentials to call with, or null. Never returned by `loadRddConfig`. */
async function credentialsFor(tenantId: string): Promise<RddCredentials | null> {
  const stored = await prisma.rddSource.findFirst({
    where: { tenantId, revokedAt: null },
    select: { baseUrl: true, tokenSealed: true },
  });
  if (stored !== null) {
    const token = await open(stored.tokenSealed);
    if (token === null) return null;
    const baseUrl = normalizeBaseUrl(stored.baseUrl) || normalizeBaseUrl(process.env.RDD_BASE_URL ?? "");
    return baseUrl === "" ? null : { baseUrl, token };
  }
  const token = process.env.RDD_API_TOKEN;
  const baseUrl = normalizeBaseUrl(process.env.RDD_BASE_URL ?? "");
  return token && baseUrl !== "" ? { baseUrl, token } : null;
}

/** Frame counts and the measured assignment rate, for the panel. Read-only. */
export async function frameStats(tenantId: string): Promise<Record<string, unknown> | null> {
  const creds = await credentialsFor(tenantId);
  if (creds === null) return null;
  try {
    return await fetchFrameStats(creds);
  } catch {
    // A panel that cannot show the frame's counts is a worse page, not a
    // broken one. The draw button says what is wrong if it is actually wrong.
    return null;
  }
}

// --- Drawing a sample ---------------------------------------------

export interface DrawOptions extends BatchOptions {
  /** Live respondents wanted. The frame oversamples this against its own rate. */
  targetLive: number;
  seed?: string;
  maxAttempts?: number;
}

export interface DrawResult {
  ok: boolean;
  reason?: string;
  batchId?: string | null;
  sampleId?: string;
  /** Numbers the frame handed over. */
  drawn?: number;
  /** Numbers actually sent to Retell, after the format gate and the skips. */
  submitted?: number;
  skippedDnc?: number;
  skippedCalled?: number;
  skippedInvalid?: number;
  shortfall?: number;
  assignmentRate?: number | null;
  error?: string;
}

/**
 * Draw an oversampled batch from the frame and queue it as a `PollBatch`.
 *
 * The dial list goes through `createPollBatch`, which means it goes through
 * `tryNormalizePhone`. That is on purpose even though the frame's output is
 * valid E.164 by construction: the gate is two regexes and it is the thing
 * that caught an 11-digit typo being dialled to France. A format gate that is
 * only applied to input somebody doubts is a gate that will be absent on the
 * day the trusted source is wrong — and "+1345" from a worker that was
 * redeployed an hour ago is exactly the kind of trusted source that is
 * occasionally wrong. Anything it rejects lands in `skippedInvalid` rather
 * than being dialled, which is a visible number on the batch rather than a
 * silent international call.
 */
export async function drawSampleForPoll(poll: Poll, opts: DrawOptions): Promise<DrawResult> {
  const creds = await credentialsFor(poll.tenantId);
  if (creds === null) {
    return { ok: false, reason: "The sampling frame is not configured. Add it under Settings." };
  }
  if (!(opts.targetLive > 0)) {
    return { ok: false, reason: "Ask for at least one live respondent." };
  }

  let draw;
  try {
    draw = await drawSample(creds, {
      name: `${poll.name} – ${opts.name}`,
      targetLive: opts.targetLive,
      seed: opts.seed,
      maxAttempts: opts.maxAttempts,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof RddError ? err.message : String(err) };
  }

  let rows: RddDialRow[];
  try {
    rows = await fetchDialList(creds, draw.sampleId);
  } catch (err) {
    // The draw happened at the far end even though this failed, so the sample
    // id is reported: those numbers are now marked as drawn and an operator
    // who cannot name the sample cannot go and look at it.
    return {
      ok: false,
      sampleId: draw.sampleId,
      reason: `The sample was drawn (${draw.sampleId}) but its dial list could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (rows.length === 0) {
    return { ok: false, sampleId: draw.sampleId, reason: "The frame returned an empty dial list." };
  }
  if (rows.length > MAX_BATCH_NUMBERS) {
    return {
      ok: false,
      sampleId: draw.sampleId,
      reason: `The draw returned ${rows.length.toLocaleString()} numbers; one batch holds ${MAX_BATCH_NUMBERS.toLocaleString()}. Ask for fewer live respondents and draw again.`,
    };
  }

  let batch;
  try {
    batch = await createPollBatch(
      poll.id,
      rows.map((r) => r.e164),
      opts,
    );
  } catch (err) {
    return {
      ok: false,
      sampleId: draw.sampleId,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (batch.batchId !== null) {
    await prisma.pollBatch.update({
      where: { id: batch.batchId },
      data: {
        rddSampleId: draw.sampleId,
        rddSeed: opts.seed ?? null,
        rddTargetLive: opts.targetLive,
        rddTargetSize: draw.targetSize,
        rddActualSize: draw.actualSize,
        rddCandidatePool: draw.candidatePool,
        rddShortfall: draw.shortfall,
        rddAssignmentRate: draw.assignmentRate,
        rddOperatorMix: operatorMix(rows),
      },
    });
  }

  return {
    ok: batch.batchId !== null,
    reason: batch.batchId === null ? batch.error : undefined,
    batchId: batch.batchId,
    sampleId: draw.sampleId,
    drawn: rows.length,
    submitted: batch.submitted,
    skippedDnc: batch.skippedDnc,
    skippedCalled: batch.skippedCalled,
    skippedInvalid: batch.skippedInvalid,
    shortfall: draw.shortfall,
    assignmentRate: draw.assignmentRate,
    error: batch.error,
  };
}

// --- Reporting frame hygiene back --------------------------------

export interface ReportResult {
  ok: boolean;
  reason?: string;
  /** Numbers reported as not existing. */
  unassigned?: number;
  /** Numbers reported as existing. */
  live?: number;
  /** Numbers this run had nothing to say about yet. */
  undecided?: number;
  /** Numbers still waiting to be reported after this run. */
  remaining?: number;
  /** Dispositions the frame rejected, with the first reason. */
  rejected?: number;
  error?: string;
}

/**
 * Report, for each number in a drawn batch, whether it exists. Nothing else.
 *
 * ==================================================================
 * This function is the entire outbound surface from Polimeter to the
 * frame, and the contract it must keep is written out in full at
 * `lib/polling/rdd.ts` under "THE WRITE-BACK CONTRACT". Read it
 * before changing anything here. The short version: the frame holds
 * plaintext numbers, this platform holds HMACs of them, so the two are
 * one hash apart — and the anonymity every respondent was promised
 * survives only because the frame never learns anything about answers
 * or about which response came from which number. A refusal and a
 * completed interview send byte-identical payloads. That identity is
 * the mechanism, not a coincidence of today's mapping.
 * ==================================================================
 *
 * Three design points are load-bearing and easy to undo by accident:
 *
 * 1. The plaintext numbers are fetched from the frame here and held only for
 *    the length of this call. They are never written to this database. The
 *    obvious implementation — a table mapping `phoneHash` to the number it
 *    came from, so outcomes can be looked up later — would put the join key
 *    and the answers in the same database, which is the one thing the schema
 *    does not do anywhere.
 *
 * 2. The call rows are read with a three-field `select`. Not for performance:
 *    an answer, a summary or a sentiment cannot be reported to the frame by a
 *    careless later edit because this function never has one in scope.
 *
 * 3. How far the reporting got is recorded at the *frame*, in its own
 *    `disposition` column, and read back from the dial list. That is why no
 *    progress state is kept here — keeping it would require storing the
 *    numbers, see (1).
 */
export async function reportFrameOutcomes(batch: PollBatch): Promise<ReportResult> {
  if (batch.rddSampleId === null) {
    return { ok: false, reason: "This batch was not drawn from the sampling frame." };
  }
  const creds = await credentialsFor(batch.tenantId);
  if (creds === null) {
    return { ok: false, reason: "The sampling frame is not configured. Add it under Settings." };
  }
  const config = await loadRddConfig(batch.tenantId);
  const liveDisposition = config.liveDisposition;

  let rows: RddDialRow[];
  try {
    rows = await fetchDialList(creds, batch.rddSampleId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  // Only the three fields the mapping is allowed to see. See (2) above.
  const calls = await prisma.pollCall.findMany({
    where: { batchId: batch.id },
    select: { phoneHash: true, outcome: true, disconnectionReason: true },
  });

  const signalByHash = new Map<string, FrameSignal[]>();
  for (const call of calls) {
    const list = signalByHash.get(call.phoneHash) ?? [];
    list.push(frameSignal({ outcome: call.outcome, disconnectionReason: call.disconnectionReason }));
    signalByHash.set(call.phoneHash, list);
  }

  // Match a dial-list number to its calls by hashing it with the same keyed
  // hash the dialler used. The plaintext lives in `rows` and in this loop and
  // goes no further.
  const pending: { e164: string; disposition: string }[] = [];
  let undecided = 0;
  let unassignedSeen = 0;
  let decidedSeen = 0;

  for (const row of rows) {
    const normalized = tryNormalizePhone(row.e164);
    // A frame row this platform would refuse to dial is one it has no outcome
    // for either, so there is nothing to report about it.
    if (normalized === null) continue;
    const signals = signalByHash.get(hashPhone(normalized));
    if (signals === undefined) continue;

    const signal = combineSignals(signals);
    if (signal === "unassigned") unassignedSeen += 1;
    if (signal !== "unknown") decidedSeen += 1;
    const disposition = reportableDisposition(signal, liveDisposition);
    if (disposition === null) {
      undecided += 1;
      continue;
    }
    // Already carries a disposition at the frame: that is this write-back's
    // progress marker, so skip it rather than restate it.
    if (row.disposition !== null) continue;
    pending.push({ e164: normalized, disposition });
  }

  // The guard. `dial_failed` is also what a broken SIP trunk looks like, and a
  // batch reported wholesale as disconnected would burn live numbers out of
  // the universe permanently, with no record of which. See
  // IMPLAUSIBLE_UNASSIGNED_SHARE in lib/polling/rdd.ts.
  if (decidedSeen >= GUARD_MIN_CALLS && unassignedSeen / decidedSeen > IMPLAUSIBLE_UNASSIGNED_SHARE) {
    const pct = Math.round((unassignedSeen / decidedSeen) * 100);
    return {
      ok: false,
      reason:
        `${pct}% of this batch failed to dial at all, against roughly 70% expected for this frame. ` +
        "That is the signature of a fault at this end — a trunk outage, an exhausted concurrency " +
        "limit, a caller number Retell cannot place +1 345 calls from — not a run of dead numbers. " +
        "Nothing has been reported, because marking live numbers disconnected cannot be undone. " +
        "Fix the dialling path, re-dial, then report.",
      unassigned: 0,
      live: 0,
      undecided,
      remaining: pending.length,
    };
  }

  const thisRun = pending.slice(0, MAX_DISPOSITIONS_PER_RUN);
  let unassigned = 0;
  let live = 0;
  let rejected = 0;
  let firstError = "";

  // Small groups rather than one Promise.all: a Worker has a bounded
  // subrequest budget per request and the frame is a single worker that does
  // not need several hundred concurrent writes.
  const GROUP = 8;
  for (let i = 0; i < thisRun.length; i += GROUP) {
    const group = thisRun.slice(i, i + GROUP);
    const settled = await Promise.allSettled(
      group.map((p) => postDisposition(creds, batch.rddSampleId!, p.e164, p.disposition)),
    );
    settled.forEach((outcome, j) => {
      if (outcome.status === "fulfilled") {
        if (group[j]!.disposition === liveDisposition) live += 1;
        else unassigned += 1;
      } else {
        rejected += 1;
        // The message is kept but the number in it is not: a rejection names
        // the e164 it was for, and that string would then be written to a
        // batch row. Only the frame's reason is kept.
        const message = String(
          outcome.reason instanceof Error ? outcome.reason.message : outcome.reason,
        );
        firstError ||= message.replace(/\+\d{7,15}/g, "(number)").slice(0, 300);
      }
    });
  }

  await prisma.pollBatch.update({
    where: { id: batch.id },
    data: {
      rddReportedAt: new Date(),
      rddReportedUnassigned: { increment: unassigned },
      rddReportedLive: { increment: live },
    },
  });

  return {
    ok: rejected === 0,
    unassigned,
    live,
    undecided,
    remaining: Math.max(0, pending.length - thisRun.length),
    rejected,
    error: firstError || undefined,
    reason:
      rejected > 0
        ? `The frame refused ${rejected} of ${thisRun.length} dispositions. If it refused all of them, the live disposition value is probably wrong for this frame — change it under Settings.`
        : undefined,
  };
}
