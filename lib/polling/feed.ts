import type { Poll } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildDelivery, type DeliveryPayload } from "./delivery";
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

  const [calls, results] = await Promise.all([
    prisma.pollCall.findMany({
      where: { pollId: poll.id },
      select: { outcome: true, durationMs: true, analysis: true, startedAt: true, optionOrder: true },
    }),
    loadPollResults(poll, { includePartial, weighted: true }),
  ]);

  const stats = computeStats(calls);
  const { config: weightingConfig, weighting, tallies } = results;
  const answered = weighting ? weighting.n : tallies[0]?.total ?? 0;

  if (answered === 0) {
    return { ok: false, reason: "This poll has no completed interviews to deliver." };
  }

  const started = calls.map((c) => c.startedAt).filter((d): d is Date => d !== null);
  started.sort((a, b) => a.getTime() - b.getTime());

  // A wave is how many deliveries this poll has already had, plus this one.
  // Counting here is safe where counting the sequence is not: a wave is a
  // property of this poll's own history and a gap in it means nothing to
  // anybody, whereas a reused sequence would hide a lost delivery.
  const priorWaves = await prisma.pollDelivery.count({ where: { pollId: poll.id } });

  const deliveryId = crypto.randomUUID();
  const built = buildDelivery({
    deliveryId,
    sequence: 0, // replaced once a sequence is allocated below
    poll: {
      id: poll.id,
      name: poll.name,
      topic: String((poll.variables as Record<string, unknown>)?.poll_topic ?? "") || null,
      wave: priorWaves + 1,
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

  if (!built.ok) {
    return { ok: false, reason: "The results could not be assembled into a delivery.", problems: built.problems };
  }

  const row = await allocate(target, poll, deliveryId, built.payload);
  if (row === null) {
    return { ok: false, reason: "Could not allocate a delivery sequence; another delivery may be in flight." };
  }

  return send(row.id, config.endpointUrl, row.payload as unknown as DeliveryPayload);
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

  return send(row.id, config.endpointUrl, payload);
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
    missing_sequences?: number[];
  };
  const missing = Array.isArray(body.missing_sequences) ? body.missing_sequences : [];

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
