import Link from "next/link";
import type { Poll, PollDeliveryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadFeedConfig } from "@/lib/polling/feed";
import { formatRelative } from "@/lib/utils";
import { deliverResults, fixAndResendResults, replayResults } from "../actions";

/**
 * Delivering results to the campaign that commissioned the poll.
 *
 * Shows what has already gone, because a delivery log nobody can see is one
 * where a lost push looks the same as a push that was never made. The replay
 * button re-sends a stored payload unchanged rather than rebuilding it; see
 * `docs/poll-results-api.md` for why that distinction is load-bearing.
 */

// DUPLICATE covers two outcomes that mean the same thing for this row — the
// far end already has this accounted for and there is nothing to do to it. A
// 200 is the delivery id already held; a 409 is the sequence held by another
// delivery, which means a row recorded as refused actually landed. They are
// told apart by `httpStatus` and spelled out in `detail`, rather than by a
// fourth enum value, because adding one would mean another production DDL for
// a distinction the row already carries.
const TONE: Record<PollDeliveryStatus, { label: string; color: string }> = {
  PENDING: { label: "In flight", color: "#8a6d1f" },
  ACCEPTED: { label: "Delivered", color: "#1f6d4a" },
  DUPLICATE: { label: "Already held", color: "#1f5d6d" },
  REFUSED: { label: "Refused", color: "#8f2020" },
  FAILED: { label: "Did not arrive", color: "#8f2020" },
};

export async function DeliveryPanel({
  poll,
  includePartial,
}: {
  poll: Poll;
  includePartial: boolean;
}): Promise<JSX.Element> {
  const [config, deliveries] = await Promise.all([
    loadFeedConfig(),
    prisma.pollDelivery.findMany({
      where: { pollId: poll.id },
      orderBy: { sequence: "desc" },
      select: {
        id: true,
        sequence: true,
        status: true,
        httpStatus: true,
        detail: true,
        missing: true,
        attempts: true,
        createdAt: true,
        sentAt: true,
      },
    }),
  ]);

  const ready = config.enabled && config.endpointUrl !== "" && config.hasToken;
  const reasons = [
    !config.enabled ? "the feed is switched off in platform settings" : null,
    config.endpointUrl === "" ? "no endpoint URL is set" : null,
    // Names the action rather than the mechanism. "POLITRACKER_FEED_TOKEN is
    // not in the environment" was accurate and told an operator nothing they
    // could act on from this page.
    !config.hasToken ? "no campaign key — add one under Settings" : null,
  ].filter((r): r is string => r !== null);

  return (
    <div className="card">
      <h2 className="text-sm font-semibold">Deliver to campaign</h2>
      <p className="mt-2 text-sm text-ink/60">
        Sends the toplines, the disclosure block and the publication gate to the
        campaign that commissioned this poll. Aggregates only — no respondent
        rows, no numbers, not even hashed ones. A figure that is not fit to
        publish is still delivered, marked unquotable with the reasons attached.
      </p>

      {!ready && (
        <p className="mt-3 text-sm" style={{ color: "#8a6d1f" }}>
          Not configured: {reasons.join(", ")}.{" "}
          {/* The key lives on Settings because it identifies a campaign and
              many polls deliver to the same one. That is the right home and
              the wrong place to go looking from here, so the door is put
              where somebody stuck on this page would want it. */}
          {!config.hasToken && (
            <Link href="/admin/settings" className="underline">
              Add a campaign key
            </Link>
          )}
        </p>
      )}

      {/* A stored key that will not decrypt is its own case: the feed looks
          configured and is not, and the cause is almost always that
          PHONE_HASH_SECRET changed. Saying so here saves an operator looking
          for a fault at the far end. */}
      {config.problem !== null && (
        <p className="mt-3 text-sm" style={{ color: "#8f2020" }}>
          {config.problem}
        </p>
      )}

      {ready && (
        <p className="mt-3 text-sm text-ink/50">
          Delivering with the{" "}
          {config.tokenSource === "stored" ? "stored campaign key" : "key from the Worker environment"}
          {config.fingerprint === null ? "" : <> (<code>{config.fingerprint}</code>…)</>}.
        </p>
      )}

      {/* Two buttons rather than a checkbox, because the difference is not a
          setting — it is what the campaign will permanently hold. A delivery
          cannot be withdrawn, so the test form says what it writes. */}
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <form action={deliverResults}>
          <input type="hidden" name="pollId" value={poll.id} />
          <input type="hidden" name="include" value={includePartial ? "partial" : "completed"} />
          <button type="submit" className="btn-primary" disabled={!ready}>
            Deliver these results
          </button>
        </form>

        <form action={deliverResults}>
          <input type="hidden" name="pollId" value={poll.id} />
          <input type="hidden" name="include" value={includePartial ? "partial" : "completed"} />
          <input type="hidden" name="asTest" value="1" />
          <button type="submit" className="btn-secondary" disabled={!ready}>
            Deliver as a test
          </button>
        </form>
      </div>

      <p className="mt-3 text-sm text-ink/50">
        A test delivery is marked unquotable and carries a sentence saying it is
        a trial and not a measurement of opinion. It is still permanent — there
        is no way to withdraw a delivery — so the marking is the whole point of
        it rather than a formality.
      </p>

      {deliveries.length === 0 ? (
        <p className="mt-4 text-sm text-ink/50">Nothing has been delivered yet.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {deliveries.map((d) => {
            const tone = TONE[d.status];
            const replayable = d.status === "FAILED" || d.status === "PENDING";
            const refused = d.status === "REFUSED";
            return (
              <li key={d.id} className="border-t border-ink/10 pt-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium tabular-nums">#{d.sequence}</span>
                  <span className="font-medium" style={{ color: tone.color }}>
                    {tone.label}
                  </span>
                  {d.httpStatus !== null && (
                    <span className="text-ink/40 tabular-nums">HTTP {d.httpStatus}</span>
                  )}
                  <span className="text-ink/40">
                    {formatRelative(d.sentAt ?? d.createdAt)}
                  </span>
                  {d.attempts > 1 && (
                    <span className="text-ink/40">{d.attempts} attempts</span>
                  )}
                </div>

                {/* break-words, not break-all: this is the one element that
                    renders a string of the far end's choosing, and theirs
                    contain unbroken tokens with no space to wrap at — a 422
                    names a field path like
                    `breakdowns[0].rows[0].answers[0].pct_with_a_view`, and a
                    409 carries a delivery uuid. At phone width that overruns
                    the card. break-all would also chop the prose around it. */}
                {d.detail !== null && (
                  <p className="mt-1 break-words text-ink/70">{d.detail}</p>
                )}

                {d.missing.length > 0 && (
                  <p className="mt-1" style={{ color: "#8a6d1f" }}>
                    The campaign has never received{" "}
                    {d.missing.length === 1 ? "delivery" : "deliveries"}{" "}
                    {d.missing.map((m) => `#${m}`).join(", ")}. Replay{" "}
                    {d.missing.length === 1 ? "it" : "them"} from the poll{" "}
                    {d.missing.length === 1 ? "it" : "they"} belong to.
                  </p>
                )}

                {/* Two different repairs, and offering one button for both
                    would be wrong. A refusal stored nothing at the far end, so
                    its number is still free and the fix is a corrected payload
                    under it. A failure might have landed, so the only safe
                    move is the original bytes again — rebuilding could restate
                    numbers under a sequence already accepted. */}
                {refused && (
                  <form action={fixAndResendResults} className="mt-2">
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="deliveryId" value={d.id} />
                    <input
                      type="hidden"
                      name="include"
                      value={includePartial ? "partial" : "completed"}
                    />
                    <button type="submit" className="btn-secondary" disabled={!ready}>
                      Fix and send again as #{d.sequence}
                    </button>
                    <span className="ml-2 text-ink/50">
                      Rebuilds from the current results. This number is still
                      free, so no gap is left.
                    </span>
                  </form>
                )}

                {replayable && (
                  <form action={replayResults} className="mt-2">
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="deliveryId" value={d.id} />
                    <button type="submit" className="btn-secondary" disabled={!ready}>
                      Send it again unchanged
                    </button>
                    <span className="ml-2 text-ink/50">
                      It may already have arrived, so the stored payload goes
                      again rather than a rebuilt one.
                    </span>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
