import type { Poll } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildDelivery, type BuildResult, type DeliveryPayload } from "./delivery";
import { publicationBlockers } from "./publication";
import { computeStats } from "./results";
import { loadPollResults } from "./weighted";
import { weightedToLabel } from "./weighting";

/**
 * Delivering a poll's results to a campaign in Politracker.
 *
 * The contract is `docs/poll-results-api.md`. One direction, aggregates only,
 * one credential that reads nothing. The receiving end derives the campaign
 * from the bearer key and accepts no campaign field, so there is nothing here
 * that names one in a request.
 *
 * Imports `lib/db.ts`, so this module runs in the Worker and nowhere else —
 * not under `next dev`, not in a script. The payload builder is separate and
 * pure for exactly that reason.
 */

const TARGET_DEFAULT = "default";
const MAX_SEQUENCE_ATTEMPTS = 5;

export interface FeedConfig {
  enabled: boolean;
  endpointUrl: string;
  /** Present or not; never returned, logged or rendered. */
  hasToken: boolean;
}

/**
 * Endpoint in a platform setting, token in the environment.
 *
 * The split follows `lib/integrations/ads-cayworks.ts`, and the token is not
 * in a poll record or any other row for the reason the contract gives: it is a
 * credential for somebody else's system, and a credential that lives in a
 * record is one that eventually turns up in a dump, a log line or an export.
 */
export async function loadFeedConfig(): Promise<FeedConfig> {
  const row = await prisma.platformSetting.findUnique({ where: { key: "poll_feed" } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  return {
    enabled: Boolean(value.enabled),
    endpointUrl: String(value.endpointUrl ?? process.env.POLITRACKER_FEED_URL ?? ""),
    hasToken: Boolean(process.env.POLITRACKER_FEED_TOKEN),
  };
}

export type DeliveryOutcome =
  | { ok: true; status: "accepted" | "already_stored"; id: string; sequence: number; missing: number[] }
  | { ok: false; reason: string; id?: string; problems?: string[] };

/**
 * Build and send one delivery for a poll.
 *
 * The row is written before the request goes out and keeps its sequence
 * whatever the request does. That ordering is the whole mechanism: a delivery
 * that fails holds its number and its payload, so a replay re-sends the same
 * bytes under the same `delivery_id` rather than rebuilding from data that
 * has moved on since.
 */
export async function deliverPoll(
  poll: Poll,
  options: { target?: string; includePartial?: boolean } = {},
): Promise<DeliveryOutcome> {
  const target = options.target ?? TARGET_DEFAULT;
  const includePartial = options.includePartial ?? false;

  const config = await loadFeedConfig();
  if (!config.enabled) return { ok: false, reason: "The campaign feed is switched off." };
  if (config.endpointUrl === "") return { ok: false, reason: "No endpoint URL is configured." };
  if (!config.hasToken) {
    return { ok: false, reason: "POLITRACKER_FEED_TOKEN is not set in the environment." };
  }

  // A wave is how many deliveries this poll has already had, plus this one.
  // Counting here is safe where counting the sequence is not: a wave is a
  // property of this poll's own history and a gap in it means nothing to
  // anybody, whereas a reused sequence would hide a lost delivery.
  const priorWaves = await prisma.pollDelivery.count({ where: { pollId: poll.id } });

  const deliveryId = crypto.randomUUID();
  const built = await assemble(poll, {
    deliveryId,
    sequence: 0, // replaced once a sequence is allocated below
    wave: priorWaves + 1,
    includePartial,
  });
  if (built === null) {
    return { ok: false, reason: "This poll has no completed interviews to deliver." };
  }
  if (!built.ok) {
    return { ok: false, reason: "The results could not be assembled into a delivery.", problems: built.problems };
  }

  const row = await allocate(target, poll, deliveryId, built.payload);
  if (row === null) {
    return { ok: false, reason: "Could not allocate a delivery sequence; another delivery may be in flight." };
  }

  return send(row.id, config.endpointUrl, row.payload as unknown as DeliveryPayload, {
    expectNew: true,
  });
}

/**
 * Re-deliver a refused delivery under the sequence it already holds.
 *
 * A refusal consumes no sequence at the far end. A 401 and a 403 return before
 * the payload is looked at, and a 422 returns before the delivery is stored —
 * read out of its route, and it now has a test pinning the invariant: a
 * sequence is consumed if and only if that endpoint answered 2xx. So the
 * number this row holds still means nothing to anybody, and the corrected
 * payload belongs under it.
 *
 * Getting this wrong would have discredited the permanent-gap rule with the
 * first thing it reported. A gap is supposed to mean a delivery was lost; if
 * every setup-time 422 left one too, the first real delivery — the one most
 * likely to be refused — would leave an unclosable gap at sequence 1, and the
 * feed's first visible fact would be a false report of loss.
 *
 * Only `REFUSED` qualifies. A `FAILED` row is a transport error or a 5xx,
 * where whether the original landed is unknown; that case replays the stored
 * bytes instead (see {@link replayDelivery}), because rebuilding under a
 * sequence the far end may already have accepted something under is the one
 * move that could silently publish numbers nobody chose.
 */
export async function redeliverRefused(
  id: string,
  options: { includePartial?: boolean } = {},
): Promise<DeliveryOutcome> {
  const config = await loadFeedConfig();
  if (!config.enabled) return { ok: false, reason: "The campaign feed is switched off." };
  if (config.endpointUrl === "") return { ok: false, reason: "No endpoint URL is configured." };
  if (!config.hasToken) {
    return { ok: false, reason: "POLITRACKER_FEED_TOKEN is not set in the environment." };
  }

  const row = await prisma.pollDelivery.findUnique({
    where: { id },
    select: { id: true, sequence: true, status: true, payload: true, poll: true },
  });
  if (row === null) return { ok: false, reason: "No such delivery." };
  if (row.status !== "REFUSED") {
    return {
      ok: false,
      id,
      reason:
        row.status === "FAILED" || row.status === "PENDING"
          ? "This delivery was never refused, so whether it arrived is unknown. Send it again unchanged rather than rebuilding it — rebuilding could restate numbers under a sequence that has already been accepted."
          : `This delivery was already accepted (#${row.sequence}). Its sequence is spent; deliver again to send revised numbers under a new one.`,
    };
  }

  const stored = row.payload as unknown as DeliveryPayload | null;
  // The same wave, because this is a retry of it rather than a new one.
  const wave = stored?.poll?.wave ?? 1;

  // The same delivery_id, which is this row's own primary key.
  //
  // A fresh one was the first instinct — if this row's REFUSED were wrong and
  // the far end did hold the original, a reused id comes back 200
  // already_stored, which looks like success. But the row's id *is* the
  // delivery id here, so a fresh one leaves the stored payload disagreeing
  // with the row it sits on, which is exactly the state replayDelivery
  // refuses to send. It would have broken the replay path to harden the
  // re-send path.
  //
  // It is also unnecessary, because the unexpected-200 guard in `send` already
  // catches that case and catches it loudly: on a corrected re-send a 200
  // means the far end kept its copy and these numbers were dropped, and it is
  // recorded as a failure rather than a delivery. The invariant is worth more
  // than the second mechanism.
  const built = await assemble(row.poll, {
    deliveryId: id,
    sequence: row.sequence,
    wave,
    includePartial: options.includePartial ?? false,
  });
  if (built === null) {
    return { ok: false, id, reason: "This poll has no completed interviews to deliver." };
  }
  if (!built.ok) {
    return {
      ok: false,
      id,
      reason: "The results still could not be assembled into a delivery.",
      problems: built.problems,
    };
  }

  await prisma.pollDelivery.update({
    where: { id },
    data: {
      payload: built.payload as never,
      status: "PENDING",
      httpStatus: null,
      detail: null,
    },
  });

  return send(id, config.endpointUrl, built.payload, { expectNew: true });
}

/**
 * Gather this poll's current results into a payload under a given sequence.
 *
 * Null when there is nothing to deliver, so the caller can say so rather than
 * sending an empty poll.
 */
async function assemble(
  poll: Poll,
  opts: { deliveryId: string; sequence: number; wave: number; includePartial: boolean },
): Promise<BuildResult | null> {
  const [calls, results] = await Promise.all([
    prisma.pollCall.findMany({
      where: { pollId: poll.id },
      select: { outcome: true, durationMs: true, analysis: true, startedAt: true, optionOrder: true },
    }),
    loadPollResults(poll, { includePartial: opts.includePartial, weighted: true }),
  ]);

  const stats = computeStats(calls);
  const { config: weightingConfig, weighting, tallies } = results;
  const answered = weighting ? weighting.n : tallies[0]?.total ?? 0;
  if (answered === 0) return null;

  const started = calls.map((c) => c.startedAt).filter((d): d is Date => d !== null);
  started.sort((a, b) => a.getTime() - b.getTime());

  return buildDelivery({
    deliveryId: opts.deliveryId,
    sequence: opts.sequence,
    poll: {
      id: poll.id,
      name: poll.name,
      topic: String((poll.variables as Record<string, unknown>)?.poll_topic ?? "") || null,
      wave: opts.wave,
    },
    fieldwork: { from: started[0] ?? null, to: started[started.length - 1] ?? null },
    deliveredAt: new Date(),
    stats,
    tallies,
    weighting,
    answered,
    blockers: publicationBlockers(answered, weighting),
    weightedTo: weightedToLabel(weightingConfig, weighting),
    rotated: calls.filter((c) => c.optionOrder !== null).length,
  });
}

/**
 * Reserve the next sequence for this target and store the payload under it.
 *
 * `max + 1` over rows that already exist, retried when two deliveries race:
 * the unique index on (target, sequence) is what actually decides, and losing
 * the race means picking the next number up rather than overwriting anybody.
 * Neon over HTTP gives no advisory lock to take instead.
 *
 * A failed delivery does not block the ones behind it, and that is safe rather
 * than merely convenient: the receiver computes its gaps as a set difference
 * over 1..max, not from a high-water mark, so 5 may arrive before 4 and the
 * gap closes by itself when 4 lands. Carrying on and backfilling is the
 * intended shape. What must not happen is two deliveries claiming one number
 * — that it refuses outright — which is why the number is read back off the
 * row rather than recomputed anywhere.
 */
async function allocate(
  target: string,
  poll: Poll,
  deliveryId: string,
  payload: DeliveryPayload,
): Promise<{ id: string; payload: unknown } | null> {
  for (let attempt = 0; attempt < MAX_SEQUENCE_ATTEMPTS; attempt++) {
    const highest = await prisma.pollDelivery.findFirst({
      where: { target },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const sequence = (highest?.sequence ?? 0) + 1;

    try {
      const row = await prisma.pollDelivery.create({
        data: {
          id: deliveryId,
          tenantId: poll.tenantId,
          pollId: poll.id,
          target,
          sequence,
          payload: { ...payload, sequence } as never,
        },
        select: { id: true, payload: true },
      });
      return row;
    } catch (err) {
      // P2002 is the unique violation on (target, sequence): somebody else
      // took this number between the read and the write. Anything else is a
      // real failure and should not be retried behind the operator's back.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
    }
  }
  return null;
}

/**
 * Re-send a stored delivery, unchanged, under its original `delivery_id`.
 *
 * Only ever the stored bytes. If the original payload cannot be reproduced,
 * the answer is a **new** delivery with a new sequence, leaving the old number
 * permanently missing — never current numbers pushed into the old slot.
 *
 * That rule has to live here, because the receiving end cannot enforce it: it
 * has no way to tell a faithful replay from a regenerated one. What it does
 * enforce is that a sequence is used once, so resequencing would either be
 * refused or, worse, succeed and silently restate a figure. A permanent gap is
 * the honest outcome — it reads as "a delivery was lost", which is true, and
 * their `missingSequences` is a set difference that reports it for ever
 * without needing a special case.
 */
export async function replayDelivery(id: string): Promise<DeliveryOutcome> {
  const config = await loadFeedConfig();
  if (!config.enabled) return { ok: false, reason: "The campaign feed is switched off." };
  if (config.endpointUrl === "") return { ok: false, reason: "No endpoint URL is configured." };
  if (!config.hasToken) {
    return { ok: false, reason: "POLITRACKER_FEED_TOKEN is not set in the environment." };
  }

  const row = await prisma.pollDelivery.findUnique({
    where: { id },
    select: { id: true, sequence: true, payload: true },
  });
  if (row === null) return { ok: false, reason: "No such delivery." };

  // The stored payload must still be the one this row describes. If the two
  // have come apart, something has rewritten a row that was meant to be
  // immutable, and sending it would restate numbers under a sequence that
  // already means something else. Refusing leaves the gap, which is the
  // outcome the rule above asks for anyway.
  const payload = row.payload as unknown as DeliveryPayload | null;
  if (payload === null || typeof payload !== "object") {
    return {
      ok: false,
      reason:
        "This delivery has no stored payload, so it cannot be replayed faithfully. Deliver again to send current numbers under a new sequence; this one stays missing.",
      id,
    };
  }
  if (payload.sequence !== row.sequence || payload.delivery_id !== row.id) {
    return {
      ok: false,
      reason: `This delivery's stored payload no longer matches the row (payload #${payload.sequence}, row #${row.sequence}). It will not be replayed. Deliver again to send current numbers under a new sequence.`,
      id,
    };
  }

  // A replay expects a 200 to be possible and welcome: it means the original
  // did land after all and the transport lost the answer.
  return send(row.id, config.endpointUrl, payload, { expectNew: false });
}

/**
 * POST a stored payload and record what came back.
 *
 * The `detail` string on a 422 names the offending field, and it is kept
 * against the row rather than dropped: an integration whose failures all read
 * "invalid_request" is one somebody debugs by guessing.
 */
async function send(
  id: string,
  endpointUrl: string,
  payload: DeliveryPayload,
  options: { expectNew: boolean },
): Promise<DeliveryOutcome> {
  const record = async (data: Record<string, unknown>): Promise<void> => {
    await prisma.pollDelivery.update({
      where: { id },
      data: { ...data, attempts: { increment: 1 } },
    });
  };

  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.POLITRACKER_FEED_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await record({ status: "FAILED", detail: reason });
    return { ok: false, reason: `The request did not complete: ${reason}`, id };
  }

  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    detail?: string;
    error?: string;
    held_by?: string;
    missing_sequences?: number[];
  };
  const missing = Array.isArray(body.missing_sequences) ? body.missing_sequences : [];

  // A 200 means the far end already held this delivery_id. On a replay that is
  // the point. On a first send or a corrected re-send it is a problem wearing
  // a success's clothes: the far end kept its copy and these numbers were
  // discarded, so recording it as delivered would leave this side believing
  // figures were published that were not.
  if (res.status === 200 && options.expectNew) {
    const detail =
      "The far end already held this delivery id, so the payload just sent was not stored. Its copy stands.";
    await record({ status: "FAILED", httpStatus: 200, detail, missing });
    return { ok: false, id, reason: detail };
  }

  if (res.status === 202 || res.status === 200) {
    await record({
      status: res.status === 200 ? "DUPLICATE" : "ACCEPTED",
      httpStatus: res.status,
      sentAt: new Date(),
      detail: null,
      missing,
    });
    return {
      ok: true,
      status: res.status === 200 ? "already_stored" : "accepted",
      id,
      sequence: payload.sequence,
      missing,
    };
  }

  // 409 means the far end already holds this sequence under a different
  // delivery. There is exactly one way that happens: a delivery this side
  // recorded as refused actually landed. So the number is spent, this attempt
  // can never be delivered under it, and the repair is a revision under a new
  // sequence rather than anything done to this row.
  //
  // It is deliberately not FAILED. A FAILED row offers "send it again
  // unchanged", which here would re-send into a number that is already
  // accounted for, for ever. `held_by` names the delivery holding it — this
  // side's own id, so the record can be put right without reading anybody's
  // logs.
  if (res.status === 409) {
    const heldBy = typeof body.held_by === "string" ? body.held_by : null;
    const detail =
      `Sequence #${payload.sequence} is already held at the far end` +
      (heldBy === null ? "" : ` by delivery ${heldBy}`) +
      `. This delivery was recorded as refused, but it landed. Deliver again to send revised numbers under a new sequence.`;

    // Put the record straight. The far end is authoritative about what it
    // holds, and leaving a landed delivery marked refused is how a gap gets
    // reported that was never a gap.
    if (heldBy !== null && heldBy !== id) {
      await prisma.pollDelivery
        .update({
          where: { id: heldBy },
          data: { status: "ACCEPTED", httpStatus: 202, sentAt: new Date(), detail: null },
        })
        .catch(() => undefined);
    }

    await record({ status: "DUPLICATE", httpStatus: 409, detail, missing });
    return { ok: false, id, reason: detail };
  }

  // 401, 403 and 422 will not come good on a retry without something
  // changing at one end or the other, so they are told apart from a
  // transport failure that is safe to replay unchanged.
  const refused = res.status === 401 || res.status === 403 || res.status === 422;
  const detail = body.detail ?? body.error ?? `HTTP ${res.status}`;
  await record({
    status: refused ? "REFUSED" : "FAILED",
    httpStatus: res.status,
    detail,
    missing,
  });

  return { ok: false, reason: explain(res.status, detail), id };
}

function explain(status: number, detail: string): string {
  switch (status) {
    case 500:
      return `The receiving end reported a fault of its own, so this is not something to fix here: ${detail}`;
    case 401:
      return "The feed token was not recognised. It has been rotated or revoked at the other end.";
    case 403:
      return "The token is valid but the campaign is suspended, so results are not landing.";
    case 422:
      return `The receiving end refused the payload: ${detail}`;
    default:
      return `The receiving end returned ${status}: ${detail}`;
  }
}
