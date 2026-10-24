import { PollCallOutcome, type Poll } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CALL_OUTCOMES } from "./config";
import { hashPhone, normalizePhone } from "./phone";
import {
  respondentNumber,
  retellApi,
  type RetellCall,
  type RetellFunctionRequest,
} from "./retell";

// --- Linking calls to polls --------------------------------------

// Calls we place carry poll_id in metadata; test calls from the Retell
// dashboard can pass it as a dynamic variable instead.
export async function resolvePoll(call: RetellCall): Promise<Poll | null> {
  const pollId =
    (call.metadata?.poll_id as string | undefined) ??
    call.retell_llm_dynamic_variables?.poll_id;
  if (pollId) {
    return prisma.poll.findUnique({ where: { id: pollId } });
  }
  return prisma.poll.findFirst({
    where: { retellAgentId: call.agent_id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
}

function toDate(ms?: number): Date | undefined {
  return ms ? new Date(ms) : undefined;
}

// Only link batches that belong to this poll, so stray metadata can't
// break the foreign key.
async function batchIdFor(call: RetellCall, poll: Poll): Promise<string | undefined> {
  const id = call.metadata?.batch_id;
  if (typeof id !== "string") return undefined;
  const batch = await prisma.pollBatch.findFirst({ where: { id, pollId: poll.id }, select: { id: true } });
  return batch?.id;
}

export async function upsertPollCall(call: RetellCall, poll: Poll) {
  const batchId = await batchIdFor(call, poll);
  const live = {
    callStatus: call.call_status,
    startedAt: toDate(call.start_timestamp),
    endedAt: toDate(call.end_timestamp),
    durationMs: call.duration_ms,
    disconnectionReason: call.disconnection_reason,
  };
  return prisma.pollCall.upsert({
    where: { retellCallId: call.call_id },
    update: live,
    create: {
      ...live,
      tenantId: poll.tenantId,
      pollId: poll.id,
      retellCallId: call.call_id,
      batchId,
      retellAgentId: call.agent_id,
      direction: call.direction ?? "outbound",
      phoneHash: hashPhone(respondentNumber(call)),
    },
  });
}

// --- In-call functions -------------------------------------------

type FunctionResult = { result: string; status?: number };

export async function handleFunctionCall(
  req: RetellFunctionRequest
): Promise<FunctionResult> {
  const poll = await resolvePoll(req.call);
  if (!poll) {
    console.error(`Retell function ${req.name}: no poll for call ${req.call.call_id}`);
    // Never break the interview over our own bookkeeping.
    return { result: "Noted. Carry on with the call." };
  }
  const pollCall = await upsertPollCall(req.call, poll);
  const args = req.args ?? {};

  switch (req.name) {
    case "record_answer": {
      const questionId = String(args.question_id ?? "").trim().toUpperCase();
      const answer = String(args.answer ?? "").trim();
      if (!questionId || !answer) {
        return { result: "Missing question_id or answer. Record it again with both." };
      }
      const verbatim = args.verbatim ? String(args.verbatim) : null;
      await prisma.pollResponse.upsert({
        where: { pollCallId_questionId: { pollCallId: pollCall.id, questionId } },
        update: { answer, verbatim, source: "function" },
        create: { pollCallId: pollCall.id, questionId, answer, verbatim, source: "function" },
      });
      await prisma.pollCall.update({
        where: { id: pollCall.id },
        data: { lastQuestionReached: questionId },
      });
      return { result: `Saved ${questionId}. Continue with the next question.` };
    }

    case "add_to_do_not_call": {
      await addToDoNotCall(poll.tenantId, pollCall.phoneHash, "function", args.reason);
      await prisma.pollCall.update({
        where: { id: pollCall.id },
        data: { outcome: PollCallOutcome.DO_NOT_CALL },
      });
      return { result: "Number removed from all future calls. Confirm this to them, then end the call." };
    }

    case "schedule_callback": {
      const preferredTime = String(args.preferred_time ?? "").trim();
      if (!preferredTime) {
        return { result: "Ask what time suits them, then try again." };
      }
      await saveCallback(req.call, poll, preferredTime);
      await prisma.pollCall.update({
        where: { id: pollCall.id },
        data: { outcome: PollCallOutcome.CALLBACK_REQUESTED },
      });
      return { result: `Callback noted for ${preferredTime}. Thank them and end the call.` };
    }

    default:
      return { result: `Unknown function ${req.name}`, status: 400 };
  }
}

async function addToDoNotCall(
  tenantId: string,
  phoneHash: string,
  source: string,
  reason?: unknown
): Promise<void> {
  await prisma.doNotCall.upsert({
    where: { tenantId_phoneHash: { tenantId, phoneHash } },
    update: {},
    create: { tenantId, phoneHash, source, reason: reason ? String(reason) : null },
  });
}

async function saveCallback(call: RetellCall, poll: Poll, preferredTime: string): Promise<void> {
  await prisma.pollCallback.upsert({
    where: { retellCallId: call.call_id },
    update: { preferredTime },
    create: {
      tenantId: poll.tenantId,
      pollId: poll.id,
      retellCallId: call.call_id,
      phoneNumber: normalizePhone(respondentNumber(call)),
      preferredTime,
    },
  });
}

// --- Webhook events ----------------------------------------------

const NOT_REACHED = new Set(["dial_busy", "dial_failed", "dial_no_answer"]);

function outcomeFromAnalysis(value: unknown): PollCallOutcome | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!(CALL_OUTCOMES as readonly string[]).includes(key)) return undefined;
  return key.toUpperCase() as PollCallOutcome;
}

function parseAnswers(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim())
        .map(([k, v]) => [k.trim().toUpperCase(), String(v).trim()])
    );
  } catch {
    return {};
  }
}

export async function handleWebhookEvent(event: string, call: RetellCall): Promise<void> {
  const poll = await resolvePoll(call);
  if (!poll) {
    console.warn(`Retell ${event}: no poll for call ${call.call_id}, ignoring`);
    return;
  }
  const pollCall = await upsertPollCall(call, poll);

  if (event === "call_ended" && call.disconnection_reason && NOT_REACHED.has(call.disconnection_reason)) {
    await prisma.pollCall.update({
      where: { id: pollCall.id },
      data: { outcome: PollCallOutcome.NO_ANSWER },
    });
    return;
  }

  if (event !== "call_analyzed" || !call.call_analysis) return;

  const analysis = call.call_analysis;
  const data = analysis.custom_analysis_data ?? {};

  let outcome = outcomeFromAnalysis(data.call_outcome);
  if (!outcome && analysis.in_voicemail) outcome = PollCallOutcome.VOICEMAIL;
  // A do-not-call or callback recorded live outranks the analysis guess.
  if (
    pollCall.outcome === PollCallOutcome.DO_NOT_CALL ||
    pollCall.outcome === PollCallOutcome.CALLBACK_REQUESTED
  ) {
    outcome = pollCall.outcome;
  }

  await prisma.pollCall.update({
    where: { id: pollCall.id },
    data: {
      outcome,
      completed: outcome === PollCallOutcome.COMPLETED,
      consentGiven: typeof data.consent_given === "boolean" ? data.consent_given : undefined,
      lastQuestionReached:
        pollCall.lastQuestionReached ??
        (typeof data.last_question_reached === "string" && data.last_question_reached.trim()
          ? data.last_question_reached.trim().toUpperCase()
          : undefined),
      summary: analysis.call_summary,
      sentiment: analysis.user_sentiment,
      callSuccessful: analysis.call_successful,
      inVoicemail: analysis.in_voicemail,
      analysis: data as object,
    },
  });

  if (data.do_not_call_requested === true || outcome === PollCallOutcome.DO_NOT_CALL) {
    await addToDoNotCall(poll.tenantId, pollCall.phoneHash, "analysis");
  }

  const callbackTime =
    typeof data.callback_requested_time === "string" ? data.callback_requested_time.trim() : "";
  if (callbackTime && outcome === PollCallOutcome.CALLBACK_REQUESTED) {
    const existing = await prisma.pollCallback.findUnique({ where: { retellCallId: call.call_id } });
    if (!existing) await saveCallback(call, poll, callbackTime);
  }

  // Fill gaps only: answers saved live by record_answer take precedence.
  const answers = parseAnswers(data.answers_json);
  if (Object.keys(answers).length > 0) {
    await prisma.pollResponse.createMany({
      data: Object.entries(answers).map(([questionId, answer]) => ({
        pollCallId: pollCall.id,
        questionId,
        answer,
        source: "analysis",
      })),
      skipDuplicates: true,
    });
  }
}

// --- Placing calls -----------------------------------------------

export class DoNotCallError extends Error {}

// Cayman has no daylight saving, so this is always UTC-5.
export const POLL_TIMEZONE = "America/Cayman";
// Tasks per Retell batch request. Each task carries the whole script as
// dynamic variables, so this keeps request bodies to a few MB.
const RETELL_BATCH_CHUNK = 1000;

function requireActive(poll: Poll): void {
  if (poll.status !== "ACTIVE") {
    throw new Error(`Poll ${poll.id} is ${poll.status}, not ACTIVE`);
  }
}

function fromNumberFor(poll: Poll): string {
  const fromNumber = poll.fromNumber ?? process.env.RETELL_FROM_NUMBER;
  if (!fromNumber) throw new Error("Set RETELL_FROM_NUMBER or Poll.fromNumber");
  return fromNumber;
}

// One outbound call, in the shape both create-phone-call and batch tasks take.
function callTask(poll: Poll, toNumber: string, batchId?: string) {
  const variables = Object.fromEntries(
    Object.entries((poll.variables ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])
  );
  return {
    to_number: normalizePhone(toNumber),
    override_agent_id: poll.retellAgentId ?? process.env.RETELL_AGENT_ID,
    metadata: { tenant_id: poll.tenantId, poll_id: poll.id, ...(batchId ? { batch_id: batchId } : {}) },
    retell_llm_dynamic_variables: { ...variables, poll_id: poll.id },
  };
}

export async function placePollCall(pollId: string, toNumber: string): Promise<{ call_id: string }> {
  const poll = await prisma.poll.findUniqueOrThrow({ where: { id: pollId } });
  requireActive(poll);
  const phoneHash = hashPhone(toNumber);
  const blocked = await prisma.doNotCall.findUnique({
    where: { tenantId_phoneHash: { tenantId: poll.tenantId, phoneHash } },
  });
  if (blocked) throw new DoNotCallError("Number is on the do-not-call list");

  return retellApi("POST", "/v2/create-phone-call", {
    from_number: fromNumberFor(poll),
    ...callTask(poll, toNumber),
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Hashes from `hashes` that are present in a table, queried in chunks to
// stay under Postgres' bind-parameter limit.
async function existingHashes(
  hashes: string[],
  find: (chunk: string[]) => Promise<{ phoneHash: string }[]>
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(hashes, 5000)) {
    for (const row of await find(part)) found.add(row.phoneHash);
  }
  return found;
}

export interface BatchOptions {
  name: string;
  windowStart: number; // minutes since midnight, Cayman time
  windowEnd: number;
  days: string[];
  startsAt?: Date;
  skipAlreadyCalled: boolean;
  reservedConcurrency?: number;
}

export interface BatchResult {
  batchId: string | null;
  submitted: number;
  skippedDnc: number;
  skippedCalled: number;
  skippedInvalid: number;
  error?: string;
}

export async function createPollBatch(
  pollId: string,
  rawNumbers: string[],
  opts: BatchOptions
): Promise<BatchResult> {
  const poll = await prisma.poll.findUniqueOrThrow({ where: { id: pollId } });
  requireActive(poll);
  if (!(opts.windowStart >= 0 && opts.windowStart < opts.windowEnd && opts.windowEnd <= 1440)) {
    throw new Error("Calling window must start before it ends, within one day");
  }

  const byHash = new Map<string, string>();
  for (const raw of rawNumbers) {
    if (raw.replace(/\D/g, "").length < 7) continue;
    const number = normalizePhone(raw);
    if (!/^\+\d{8,15}$/.test(number)) continue;
    byHash.set(hashPhone(number), number);
  }
  const skippedInvalid = rawNumbers.length - byHash.size;
  const hashes = [...byHash.keys()];

  const dnc = await existingHashes(hashes, (part) =>
    prisma.doNotCall.findMany({
      where: { tenantId: poll.tenantId, phoneHash: { in: part } },
      select: { phoneHash: true },
    })
  );
  const called = opts.skipAlreadyCalled
    ? await existingHashes(hashes, (part) =>
        prisma.pollCall.findMany({
          where: { pollId: poll.id, phoneHash: { in: part } },
          select: { phoneHash: true },
          distinct: ["phoneHash"],
        })
      )
    : new Set<string>();

  const eligible = hashes.filter((h) => !dnc.has(h) && !called.has(h)).map((h) => byHash.get(h)!);
  const result: BatchResult = {
    batchId: null,
    submitted: 0,
    skippedDnc: hashes.filter((h) => dnc.has(h)).length,
    skippedCalled: hashes.filter((h) => !dnc.has(h) && called.has(h)).length,
    skippedInvalid,
  };
  if (eligible.length === 0) {
    result.error = "No numbers left to call after removing invalid, do-not-call and already-called numbers.";
    return result;
  }

  const fromNumber = fromNumberFor(poll);
  const batch = await prisma.pollBatch.create({
    data: {
      tenantId: poll.tenantId,
      pollId: poll.id,
      name: opts.name,
      retellBatchIds: [],
      submittedCount: 0,
      skippedDnc: result.skippedDnc,
      skippedCalled: result.skippedCalled,
      skippedInvalid,
      startsAt: opts.startsAt,
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
      days: opts.days,
    },
  });
  result.batchId = batch.id;

  const parts = chunk(eligible, RETELL_BATCH_CHUNK);
  const sent = await Promise.allSettled(
    parts.map((numbers, i) =>
      retellApi<{ batch_call_id: string }>("POST", "/create-batch-call", {
        name: `${poll.name} – ${opts.name}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}`,
        from_number: fromNumber,
        tasks: numbers.map((n) => callTask(poll, n, batch.id)),
        trigger_timestamp: opts.startsAt?.getTime(),
        call_time_window: {
          windows: [{ start: opts.windowStart, end: opts.windowEnd }],
          ...(opts.days.length ? { day: opts.days } : {}),
          timezone: POLL_TIMEZONE,
        },
        ...(opts.reservedConcurrency ? { reserved_concurrency: opts.reservedConcurrency } : {}),
      }).then((res) => ({ id: res.batch_call_id, count: numbers.length }))
    )
  );

  const ok = sent.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failures = sent.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
  result.submitted = ok.reduce((n, r) => n + r.count, 0);
  if (failures.length) result.error = failures[0].slice(0, 300);

  await prisma.pollBatch.update({
    where: { id: batch.id },
    data: {
      retellBatchIds: ok.map((r) => r.id),
      submittedCount: result.submitted,
      status: failures.length === 0 ? "SENT" : ok.length ? "PARTIAL" : "FAILED",
      error: result.error,
    },
  });
  return result;
}
