import Link from "next/link";
import type { Poll } from "@prisma/client";
import { loadRddConfig, frameStats } from "@/lib/polling/rdd-frame";
import { DISPOSITION_UNASSIGNED } from "@/lib/polling/rdd";
import { MAX_TARGET_LIVE, WEEKDAYS } from "@/lib/polling/results";
import { drawRddSample } from "../actions";

/**
 * Drawing a probability sample instead of uploading a list.
 *
 * Sits above the paste-a-list form on the Calls tab rather than replacing it,
 * because an uploaded list is still the right thing for a client's own
 * customer base or a re-contact wave. What it must not do is look equivalent:
 * the statistics this platform publishes — margin of error, design effect,
 * effective n — are only defined over a sample with known selection
 * probabilities, and only one of the two forms provides that. So this panel
 * says which is which, in those words, where the choice is actually made.
 */

function pickNumber(stats: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (stats === null) return null;
  for (const key of keys) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

export async function RddPanel({ poll }: { poll: Poll }): Promise<JSX.Element> {
  const config = await loadRddConfig(poll.tenantId);
  // Only asked for when a draw is actually possible: an unconfigured panel has
  // no reason to make an outbound request to say so.
  const stats = config.ready ? await frameStats(poll.tenantId) : null;

  const total = pickNumber(stats, "total", "numbers", "frameSize", "frame_size");
  const undialled = pickNumber(stats, "undialled", "available", "remaining");
  const assignmentRate = pickNumber(stats, "assignmentRate", "assignment_rate");
  const active = poll.status === "ACTIVE";

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Draw a random sample</h2>
        <p className="mt-1 text-sm text-ink/60">
          Draws numbers at random from the Cayman mobile sampling frame — a
          universe of 470,000 numbers across 47 regulator-confirmed mobile
          blocks. Every number in that universe has the same chance of being
          drawn, which is what makes a margin of error on these results mean
          anything. A list you upload below has no known selection
          probabilities, so the same figures computed over it are decoration.
        </p>
      </div>

      {!config.ready && (
        <p className="text-sm" style={{ color: "#8a6d1f" }}>
          {config.problem ??
            (config.baseUrl === ""
              ? "No sampling frame is configured."
              : "No sampling-frame key is installed.")}{" "}
          <Link href="/admin/settings" className="underline">
            Set up the sampling frame
          </Link>
          .
        </p>
      )}

      {config.ready && (
        <p className="text-sm text-ink/50">
          Drawing from <code className="break-all">{config.baseUrl}</code>
          {config.fingerprint === null ? "" : <> with key <code>{config.fingerprint}</code>…</>}
          {total === null ? "" : <> · {total.toLocaleString()} numbers in the frame</>}
          {undialled === null ? "" : <> · {undialled.toLocaleString()} never dialled</>}
          {assignmentRate === null ? (
            ""
          ) : (
            <> · {Math.round(assignmentRate * 100)}% measured assignment rate</>
          )}
          .
        </p>
      )}

      {/* The oversample is the single most surprising thing about this feature
          and the one most likely to be read as a bug, so it is stated before
          the button rather than in a tooltip after it. */}
      <div className="rounded-2xl bg-sand-warm/60 px-5 py-4 text-sm text-ink/70">
        <p className="font-medium text-ink">Expect most of these numbers to be dead.</p>
        <p className="mt-2">
          Around seven in ten numbers in any Cayman random-digit-dial draw are
          not assigned to a subscriber and ring out on the first attempt. That
          is why the frame hands over several times the number you ask for.
        </p>
        <p className="mt-2">
          No lookup service can screen them out in advance. Both of the paid
          ones were tested against this frame and both answer per block rather
          than per number: one returned &ldquo;mobile&rdquo; for 187 of 187
          numbers, including a range that holds no subscribers at all. Dialling
          is the only test, so the dial is the screening step.
        </p>
      </div>

      <form action={drawRddSample} className="space-y-5">
        <input type="hidden" name="pollId" value={poll.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="targetLive">
              Live respondents wanted
            </label>
            <input
              id="targetLive"
              name="targetLive"
              type="number"
              min={1}
              max={MAX_TARGET_LIVE}
              defaultValue={400}
              className="input"
              required
            />
            <p className="mt-1 text-xs text-ink/50">
              Numbers that turn out to exist, not interviews completed. Cooperation
              is a separate loss on top, so ask for more than the sample size you
              want to publish.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="rdd-name">
              Batch name
            </label>
            <input
              id="rdd-name"
              name="name"
              className="input"
              placeholder="Wave 1, random sample"
            />
          </div>
        </div>

        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="rdd-windowStart">Call from</label>
            <input id="rdd-windowStart" name="windowStart" type="time" className="input" defaultValue="09:00" required />
          </div>
          <div>
            <label className="label" htmlFor="rdd-windowEnd">Until</label>
            <input id="rdd-windowEnd" name="windowEnd" type="time" className="input" defaultValue="20:00" required />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="rdd-startsAt">Start (optional)</label>
            <input id="rdd-startsAt" name="startsAt" type="datetime-local" className="input" />
          </div>
        </div>

        <fieldset>
          <legend className="label">Days</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="days"
                  value={d}
                  defaultChecked={d !== "Sunday"}
                  className="h-4 w-4 rounded border-ink/20"
                />
                {d.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="skipAlreadyCalled" defaultChecked className="h-4 w-4 rounded border-ink/20" />
          Skip numbers already called for this poll
        </label>

        <details className="text-sm">
          <summary className="cursor-pointer text-ink/60">Advanced</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="seed">Seed (optional)</label>
              <input id="seed" name="seed" className="input font-mono text-xs" placeholder="wave-1-2026-11" />
              <p className="mt-1 text-xs text-ink/50">
                Recorded with the batch and passed to the frame, so this exact
                draw can be reproduced and shown to have been random rather
                than chosen. Worth setting on anything you intend to publish.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="rdd-reservedConcurrency">
                Lines kept free for other calls
              </label>
              <input
                id="rdd-reservedConcurrency"
                name="reservedConcurrency"
                type="number"
                min={0}
                className="input"
                placeholder="0"
              />
            </div>
          </div>
        </details>

        {/* Said here as well as in the write-back code, because this is where
            somebody decides to press it. */}
        <p className="text-xs text-ink/50">
          Drawn numbers are dialled through the same path as any other batch and
          are recorded only as a hash. The frame is told afterwards, on request,
          which numbers turned out not to exist — reported as{" "}
          <code>{DISPOSITION_UNASSIGNED}</code> — and which did. It is never
          told what anybody said, or whether a call became an interview.
        </p>

        <button className="btn-primary" type="submit" disabled={!config.ready || !active}>
          Draw and queue
        </button>
        {!active && (
          <p className="text-sm text-accent-deep">
            Activate this poll on the Setup tab before drawing a sample.
          </p>
        )}
      </form>
    </div>
  );
}
