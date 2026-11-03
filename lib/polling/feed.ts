import type { Poll } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildDelivery,
  TEST_DELIVERY_BLOCKER,
  type BuildResult,
  type DeliveryPayload,
} from "./delivery";
import { publicationBlockers } from "./publication";
import { fingerprint, open } from "./secret-box";
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
  /** Present or not; the token itself is never returned, logged or rendered. */
  hasToken: boolean;
  /** Where the token came from, for telling an operator what to fix. */
  tokenSource: "none" | "stored" | "environment";
  /** First eight hex of the token's SHA-256 when one is stored. */
  fingerprint: string | null;
  /** Set when a stored token exists but would not decrypt. */
  problem: string | null;
}

/**
 * Where the endpoint and the token come from, in that order of preference.
 *
 * A stored `FeedTarget` wins over the environment. The contract settled that
 * the token belongs in an environment variable rather than a record, and the
 * reasoning — a credential in a row turns up in a dump, a log line or an
 * export — was right and is answered rather than abandoned: what is stored is
 * ciphertext whose key is derived from `PHONE_HASH_SECRET` and is not in the
 * database. See `lib/polling/secret-box.ts`.
 *
 * The environment path stays because it is still the safer of the two and
 * because a deployment delivering to one campaign has no reason to move. It is
 * the fallback, not the deprecated option.
 */
export async function loadFeedConfig(target = TARGET_DEFAULT): Promise<FeedConfig> {
  const [setting, stored] = await Promise.all([
    prisma.platformSetting.findUnique({ where: { key: "poll_feed" } }),
    prisma.feedTarget.findFirst({
      where: { target, revokedAt: null },
      select: { endpointUrl: true, tokenSealed: true, tokenFingerprint: true },
    }),
  ]);
  const value = (setting?.value ?? {}) as Record<string, unknown>;
  const enabled = Boolean(value.enabled);
  const settingUrl = String(value.endpointUrl ?? process.env.POLITRACKER_FEED_URL ?? "");

  if (stored !== null) {
    // Opened here rather than at send time so the panel can say "the stored
    // token will not decrypt" instead of letting a delivery fail with it.
    const plaintext = await open(stored.tokenSealed);
    return {
      enabled,
      endpointUrl: stored.endpointUrl || settingUrl,
      hasToken: plaintext !== null,
      tokenSource: plaintext === null ? "none" : "stored",
      fingerprint: stored.tokenFingerprint,
      problem:
        plaintext === null
          ? "The stored token could not be decrypted. PHONE_HASH_SECRET has most likely changed; paste the token again to replace it."
          : null,
    };
  }

  const fromEnv = process.env.POLITRACKER_FEED_TOKEN;
  return {
    enabled,
    endpointUrl: settingUrl,
    hasToken: Boolean(fromEnv),
    tokenSource: fromEnv ? "environment" : "none",
    fingerprint: fromEnv ? await fingerprint(fromEnv) : null,
    problem: null,
  };
}

/** The token to send with, or null. Never returned by `loadFeedConfig`. */
async function tokenFor(target: string): Promise<string | null> {
  const stored = await prisma.feedTarget.findFirst({
    where: { target, revokedAt: null },
    select: { tokenSealed: true },
  });
  if (stored !== null) return open(stored.tokenSealed);
  return process.env.POLITRACKER_FEED_TOKEN ?? null;
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
  options: { target?: string; includePartial?: boolean; markAsTest?: boolean } = {},
): Promise<DeliveryOutcome> {
  const target = options.target ?? TARGET_DEFAULT;
  const includePartial = options.includePartial ?? false;

  const config = await loadFeedConfig();
  if (!config.enabled) return { ok: false, reason: "The campaign feed is switched off." };
  if (config.endpointUrl === "") return { ok: false, reason: "No endpoint URL is configured." };
  if (!config.hasToken) {
    return {
      ok: false,
      reason:
        config.problem ??
        "No feed token. Add one on the Settings page, or set POLITRACKER_FEED_TOKEN as a Worker secret.",
    };
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
    markAsTest: options.markAsTest ?? false,
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
    target,
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
    return {
      ok: false,
      reason:
        config.problem ??
        "No feed token. Add one on the Settings page, or set POLITRACKER_FEED_TOKEN as a Worker secret.",
    };
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
  // Whether this was a test is recoverable from what was stored, so it needs
  // no column: a re-send of a test delivery must stay marked as one, and
  // losing that on a retry would turn a trial into something that reads as
  // fieldwork.
  const wasTest = (stored?.publication?.blockers ?? []).includes(TEST_DELIVERY_BLOCKER);

  const built = await assemble(row.poll, {
    deliveryId: id,
    sequence: row.sequence,
    wave,
    includePartial: options.includePartial ?? false,
    markAsTest: wasTest,
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
  opts: {
    deliveryId: string;
    sequence: number;
    wave: number;
    includePartial: boolean;
    markAsTest: boolean;
  },
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
    // Appended rather than replacing: a test delivery of an underpowered
    // poll is both things, and dropping the real gate's reasons to make
    // room for the test notice would lose true information.
    blockers: opts.markAsTest
      ? [TEST_DELIVERY_BLOCKER, ...publicationBlockers(answered, weighting)]
      : publicationBlockers(answered, weighting),
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
 * than merely convenient: the receiver computes its gaps over 1..max rather
 * than from a high-water mark, so 5 may arrive before 4 and the gap closes by
 * itself when 4 lands. Carrying on and backfilling is the
 * intended shape. What must not happen is two deliveries claiming one number
 * — that it refuses outright — which is why the number is read back off the
 * row rather than recomputed anywhere.
 *
 * What a change here is holding, stated as a constraint rather than a fact
 * because the fact alone does not warn anybody. Out-of-order is safe.
 * **Skipping a number is not**: their gap list is the set of numbers no
 * delivery holds and no withdrawal accounts for, so a number this side never
 * sends is reported to a campaign as a delivery that was lost.
 *
 * **Never re-offer a number they have withdrawn.** An earlier version of this
 * comment said doing so "would collide rather than tidy up". It would not
 * have. They measured it: the delivery row is gone, so their uniqueness
 * constraint sees a free slot and takes it, and the campaign ends up holding
 * a delivery at sequence 1 beside a notice saying delivery 1 was withdrawn.
 * Each half true, nothing raised, nothing to notice unless somebody reads the
 * page. A collision would at least have told one of us.
 *
 * Their rule settles why: a sequence is consumed if and only if that endpoint
 * answered 2xx. A withdrawn delivery *was* accepted, so its number is spent;
 * withdrawing records what became of the delivery and cannot un-spend the
 * number.
 *
 * They have built the guarantee — a trigger refusing the insert, answering
 * 409 with `withdrawn: true` — but **it is not in their production yet**, so
 * at the time of writing a re-offered withdrawn number is still accepted
 * silently. This side cannot provoke it by accident, because `allocate` takes
 * max + 1 over rows here and never goes backwards. It is a mistake or a
 * hand-driven replay that would.
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
 * their `missingSequences` reports it for as long as it stays true.
 *
 * Note what that now excludes. Their gap list omits numbers they have
 * recorded as withdrawn, so appearing in it means no delivery holds the
 * number *and* no withdrawal accounts for it. That is narrower than it was
 * this morning and therefore a stronger claim: a gap is loss, and a
 * withdrawal is not a gap.
 */
export async function replayDelivery(id: string): Promise<DeliveryOutcome> {
  const config = await loadFeedConfig();
  if (!config.enabled) return { ok: false, reason: "The campaign feed is switched off." };
  if (config.endpointUrl === "") return { ok: false, reason: "No endpoint URL is configured." };
  if (!config.hasToken) {
    return {
      ok: false,
      reason:
        config.problem ??
        "No feed token. Add one on the Settings page, or set POLITRACKER_FEED_TOKEN as a Worker secret.",
    };
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
  options: { expectNew: boolean; target?: string },
): Promise<DeliveryOutcome> {
  const record = async (data: Record<string, unknown>): Promise<void> => {
    await prisma.pollDelivery.update({
      where: { id },
      data: { ...data, attempts: { increment: 1 } },
    });
  };

  // Resolved here rather than passed in, so the plaintext exists only inside
  // this function and never crosses a boundary where it could be logged.
  const token = await tokenFor(options.target ?? TARGET_DEFAULT);
  if (token === null) {
    const detail = "No usable feed token at send time.";
    await record({ status: "FAILED", detail });
    return { ok: false, reason: detail, id };
  }

  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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
    withdrawn?: boolean;
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

    // `held_by` naming *this* delivery is deliberately not handled, and the
    // reason is worth keeping because the obvious instinct is to guard it.
    //
    // It would mean the receiver resolved the sequence before the delivery id,
    // which exactly one of its builds did — introduced and fixed between two
    // commits that ship in the same deploy, so the response has never left
    // that platform and will not. Its deployed build has no conflict handling
    // at all and answers a unique violation with a 500; its next one resolves
    // the id first and answers 200. Neither can produce a self-naming 409.
    //
    // A guard for it would be the mistake this file has already made once: a
    // second mechanism for a hazard the first one covers, except here the
    // hazard does not exist. Dead defensive code is not free — it reads as
    // evidence that the thing it guards against happens, and the next person
    // takes a wrong model of that endpoint from it.
    // `withdrawn` distinguishes the two ways a number can be spent, and
    // without it the message sends somebody looking for a row that is gone:
    // `held_by` names the delivery holding the sequence, which for a
    // withdrawal is one this side may have no record of at all.
    const detail = body.withdrawn
      ? `Sequence #${payload.sequence} is spent: a delivery was accepted under it at the far end and later withdrawn` +
        (heldBy === null ? "" : ` (${heldBy})`) +
        `. Withdrawing records what became of a delivery; it does not free the number. Deliver again under a new sequence.`
      : `Sequence #${payload.sequence} is already held at the far end` +
        (heldBy === null ? "" : ` by delivery ${heldBy}`) +
        `. This delivery was recorded as refused, but it landed. Deliver again to send revised numbers under a new sequence.`;

    // Put the record straight. The far end is authoritative about what it
    // holds, and leaving a landed delivery marked refused is how a gap gets
    // reported that was never a gap. The `!== id` test is not a guard against
    // the self-naming case above — it is there so this update and the `record`
    // below cannot both write the same row, the second overwriting the first.
    // Only for a live holder. Marking a row ACCEPTED because a *withdrawn*
    // delivery holds the number would assert the far end still has it, which
    // is the opposite of what a withdrawal means.
    if (heldBy !== null && heldBy !== id && body.withdrawn !== true) {
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
