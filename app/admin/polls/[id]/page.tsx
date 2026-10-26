import Link from "next/link";
import { notFound } from "next/navigation";
import type { Poll, PollCallOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { loadPollResults } from "@/lib/polling/weighted";
import { cn, formatRelative } from "@/lib/utils";
import {
  compareQuestionIds,
  computeStats,
  formatOutcome,
  formatSeconds,
  MAX_BATCH_NUMBERS,
  MAX_CALLS_PER_SUBMIT,
  minutesToTime,
  parseQuestionText,
  POLL_VARIABLES,
  WEEKDAYS,
} from "@/lib/polling/results";
import {
  DisclosureBlock,
  DispositionChart,
  PublicationGate,
  publicationBlockers,
  QuestionChart,
} from "@/components/poll-charts";
import { POLL_TEMPLATES } from "@/lib/polling/templates";
import {
  applyTemplate,
  createBatch,
  placeCalls,
  reconcileCalls,
  resolveCallback,
  setPollStatus,
  updatePoll,
} from "../actions";
import { Banner } from "../banner";
import { StatusBadge } from "../status-badge";
import { WeightingTab } from "./weighting-tab";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | undefined>;
const TABS = [
  ["results", "Results"],
  ["calls", "Calls"],
  ["weighting", "Weighting"],
  ["setup", "Setup"],
] as const;

export default async function PollPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const poll = await prisma.poll.findFirst({ where: { id: params.id, tenantId } });
  if (!poll) notFound();

  const tab = TABS.some(([t]) => t === searchParams.tab) ? searchParams.tab! : "results";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/polls" className="text-sm text-sea-deep hover:underline">
          ← All polls
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{poll.name}</h1>
          <StatusBadge status={poll.status} />
        </div>
      </div>

      <nav className="flex gap-1 border-b border-ink/10">
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={`/admin/polls/${poll.id}?tab=${t}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition",
              tab === t
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-ink/60 hover:text-ink"
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {searchParams.error && (
        <Banner tone="error">{searchParams.error}</Banner>
      )}

      {tab === "results" && (
        <ResultsTab
          poll={poll}
          includePartial={searchParams.include === "partial"}
          weighted={searchParams.weights !== "off"}
        />
      )}
      {tab === "weighting" && <WeightingTab poll={poll} searchParams={searchParams} />}
      {tab === "calls" && <CallsTab poll={poll} searchParams={searchParams} />}
      {tab === "setup" && (
        <SetupTab poll={poll} saved={searchParams.saved === "1"} applied={searchParams.applied} />
      )}
    </div>
  );
}

// --- Results -----------------------------------------------------

async function ResultsTab({
  poll,
  includePartial,
  weighted,
}: {
  poll: Poll;
  includePartial: boolean;
  weighted: boolean;
}): Promise<JSX.Element> {
  const calls = await prisma.pollCall.findMany({
    where: { pollId: poll.id },
    select: { outcome: true, durationMs: true, analysis: true, startedAt: true, optionOrder: true },
  });
  const stats = computeStats(calls);
  const { config, weighting, tallies } = await loadPollResults(poll, { includePartial, weighted });

  // Buckets for the disposition chart. "Not reached" is the remainder, so the
  // stack always adds up to what was dialled rather than quietly dropping
  // outcomes the buckets don't name.
  const named = stats.completed + stats.partial + stats.refused + stats.screenedOut + stats.doNotCall;
  const buckets = {
    completed: stats.completed,
    partial: stats.partial,
    refused: stats.refused + stats.screenedOut,
    notReached: Math.max(0, stats.dialled - named),
    doNotCall: stats.doNotCall,
  };

  const answered = weighting ? weighting.n : tallies[0]?.total ?? 0;
  const blockers = publicationBlockers(answered, weighting);
  // Margins come off the effective sample when weighted, the raw count otherwise.
  const effectiveBase = weighting ? weighting.effectiveN : answered;

  const started = calls.map((c) => c.startedAt).filter((d): d is Date => d !== null);
  const questionText = parseQuestionText(poll.variables as Record<string, unknown>);
  const weightedTo = weighting
    ? `Raked to ${config.targets
        .filter((t) => t.categories.length >= 2)
        .map((t) => t.label)
        .join(" × ")}`
    : "";
  const vars = (poll.variables ?? {}) as Record<string, string>;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  const link = (overrides: { include?: boolean; weights?: boolean }) => {
    const q = new URLSearchParams({ tab: "results" });
    if (overrides.include ?? includePartial) q.set("include", "partial");
    if (!(overrides.weights ?? weighted)) q.set("weights", "off");
    return `/admin/polls/${poll.id}?${q}`;
  };
  const canWeight = config.enabled && config.targets.some((t) => t.categories.length >= 2);

  return (
    <div className="space-y-8">
      <PublicationGate blockers={blockers} />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Stat label="Completed" value={stats.completed.toLocaleString()} />
        <Stat label="Dialled" value={stats.dialled.toLocaleString()} />
        <Stat
          label="Cooperation rate"
          value={pct(stats.completed, stats.completed + stats.partial + stats.refused)}
          hint="completed ÷ (completed + partial + refused)"
        />
        <Stat label="Avg interview" value={formatSeconds(stats.avgCompletedSeconds)} />
      </div>

      <DispositionChart buckets={buckets} />

      {/* The detailed counts below double as the chart's table view, which the
          relief rule requires for the sub-3:1 fills. */}
      <div className="card">
        <h2 className="text-sm font-semibold">Outcomes</h2>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          {(
            [
              ["Partial", stats.partial],
              ["Refused", stats.refused],
              ["Screened out", stats.screenedOut],
              ["Do not call", stats.doNotCall],
              ["Callback requested", stats.callbacks],
              ["No answer / voicemail", stats.noAnswer],
              ["In progress", stats.inProgress],
              ["Reached", stats.reached],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-ink/60">{k}</dt>
              <dd className="font-medium">{v.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        {(stats.deviations > 0 || stats.poorUnderstanding > 0) && (
          <p className="mt-4 text-sm text-accent-deep">
            Quality: {stats.deviations} call{stats.deviations === 1 ? "" : "s"} where the agent strayed
            from the script, {stats.poorUnderstanding} with poor understanding. Review them on the Calls tab.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Answers</h2>
        <div className="flex items-center gap-3 text-sm">
          {canWeight && (
            <Link href={link({ weights: !weighted })} className="text-sea-deep hover:underline">
              {weighted ? "Show unweighted" : "Show weighted"}
            </Link>
          )}
          <Link href={link({ include: !includePartial })} className="text-sea-deep hover:underline">
            {includePartial ? "Completed interviews only" : "Include partial interviews"}
          </Link>
          <a href={`/admin/polls/${poll.id}/export`} className="btn-secondary px-3 py-1.5">
            Export CSV
          </a>
        </div>
      </div>
      <div className="-mt-6 space-y-1 text-xs text-ink/50">
        {weighting ? (
          <p>
            Weighted to {config.targets.filter((t) => t.categories.length >= 2).map((t) => t.label).join(" × ")}{" "}
            · {weighting.n.toLocaleString()} {includePartial ? "interviews" : "completed interviews"} · effective
            sample {Math.round(weighting.effectiveN).toLocaleString()} · margin of error ±
            {weighting.marginOfError.toFixed(1)} points.{" "}
            <Link href={`/admin/polls/${poll.id}?tab=weighting`} className="text-sea-deep hover:underline">
              Details
            </Link>
          </p>
        ) : (
          <p>
            Unweighted counts from {includePartial ? "all interviews with answers" : "completed interviews"}.
            {!canWeight && (
              <>
                {" "}
                <Link href={`/admin/polls/${poll.id}?tab=weighting`} className="text-sea-deep hover:underline">
                  Set up weighting
                </Link>
              </>
            )}
          </p>
        )}
        {weighting?.warnings.map((w) => (
          <p key={w} className="text-accent-deep">{w}</p>
        ))}
      </div>

      {tallies.length === 0 ? (
        <div className="card text-sm text-ink/60">No answers yet.</div>
      ) : (
        <div className="space-y-4">
          {tallies.map((t) => (
            <QuestionChart
              key={t.questionId}
              tally={t}
              weighted={Boolean(weighting)}
              effectiveBase={effectiveBase}
            />
          ))}
        </div>
      )}

      <DisclosureBlock
        facts={{
          pollName: vars.poll_name || poll.name,
          companyName: vars.company_name ?? "",
          sponsor: vars.sponsor_disclosure ?? "",
          topic: vars.poll_topic ?? "",
          firstCall: started.length ? new Date(Math.min(...started.map((d) => d.getTime()))) : null,
          lastCall: started.length ? new Date(Math.max(...started.map((d) => d.getTime()))) : null,
          dialled: stats.dialled,
          completed: stats.completed,
          partial: stats.partial,
          refused: stats.refused,
          n: answered,
          effectiveN: weighting ? weighting.effectiveN : null,
          marginOfError: weighting ? weighting.marginOfError : null,
          weightedTo,
          rotated: calls.filter((c) => c.optionOrder !== null).length,
          questions: [...questionText.entries()]
            .sort((a, b) => compareQuestionIds(a[0], b[0]))
            .map(([id, text]) => ({ id, text })),
        }}
      />
    </div>
  );
}

// --- Calls -------------------------------------------------------

async function CallsTab({
  poll,
  searchParams,
}: {
  poll: Poll;
  searchParams: SearchParams;
}): Promise<JSX.Element> {
  const [callbacks, calls, batches, batchOutcomes] = await Promise.all([
    prisma.pollCallback.findMany({
      where: { pollId: poll.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.pollCall.findMany({
      where: { pollId: poll.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { responses: true },
    }),
    prisma.pollBatch.findMany({
      where: { pollId: poll.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.pollCall.groupBy({
      by: ["batchId", "outcome"],
      where: { pollId: poll.id, batchId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const placed = searchParams.placed !== undefined;
  const batchProgress = new Map<string, { calls: number; completed: number }>();
  for (const row of batchOutcomes) {
    const p = batchProgress.get(row.batchId!) ?? { calls: 0, completed: 0 };
    p.calls += row._count._all;
    if (row.outcome === "COMPLETED") p.completed += row._count._all;
    batchProgress.set(row.batchId!, p);
  }
  const active = poll.status === "ACTIVE";

  return (
    <div className="space-y-8">
      {placed && (
        <Banner tone={Number(searchParams.failed) ? "error" : "ok"}>
          {searchParams.placed} call(s) placed
          {Number(searchParams.blocked) ? `, ${searchParams.blocked} skipped (do not call)` : ""}
          {Number(searchParams.failed) ? `, ${searchParams.failed} failed` : ""}
          {Number(searchParams.invalid)
            ? `, ${searchParams.invalid} rejected (not a Cayman or North American number)`
            : ""}
          {Number(searchParams.skipped)
            ? `, ${searchParams.skipped} not sent (limit is ${MAX_CALLS_PER_SUBMIT} per batch)`
            : ""}
          .
        </Banner>
      )}

      {searchParams.batchSent !== undefined && (
        <Banner tone={searchParams.error ? "error" : "ok"}>
          {Number(searchParams.batchSent).toLocaleString()} number(s) sent to Retell batch calling
          {Number(searchParams.batchDnc) ? `, ${searchParams.batchDnc} skipped (do not call)` : ""}
          {Number(searchParams.batchCalled) ? `, ${searchParams.batchCalled} skipped (already called)` : ""}
          {Number(searchParams.batchInvalid) ? `, ${searchParams.batchInvalid} invalid or duplicate` : ""}
          .
        </Banner>
      )}

      {searchParams.reconciled !== undefined && (
        <Banner tone="ok">
          {Number(searchParams.reconciled)
            ? `${searchParams.reconciled} call(s) pulled in from Retell`
            : "Nothing missing"}
          {` — ${searchParams.scanned} recent call(s) checked, ${searchParams.present} already here.`}
        </Banner>
      )}

      {!active && (
        <p className="text-sm text-accent-deep">
          Activate this poll on the Setup tab before placing calls.
        </p>
      )}

      {/* Retell can fail to deliver a webhook, which silently drops a finished
          interview from the results. This pulls those in on demand. */}
      <form action={reconcileCalls} className="card flex flex-wrap items-center gap-4">
        <input type="hidden" name="pollId" value={poll.id} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Check for missed calls</h2>
          <p className="mt-1 text-sm text-ink/60">
            Compares this poll&rsquo;s recent calls at Retell against the ones recorded here and
            ingests anything missing. Safe to run at any time.
          </p>
        </div>
        <button type="submit" className="btn-secondary shrink-0">
          Check now
        </button>
      </form>

      <form key={`b${searchParams.batch}`} action={createBatch} className="card space-y-5">
        <input type="hidden" name="pollId" value={poll.id} />
        <div>
          <h2 className="text-lg font-semibold">Batch calling</h2>
          <p className="mt-1 text-sm text-ink/60">
            Paste numbers or upload a CSV (the first column with a phone number is used), up to{" "}
            {MAX_BATCH_NUMBERS.toLocaleString()} per batch. Retell dials them only within the hours
            and days below, in Cayman time. Seven-digit numbers are treated as +1 345.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="batch-name">Batch name</label>
          <input id="batch-name" name="name" className="input" placeholder="West Bay sample, wave 1" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="batch-numbers">Numbers</label>
            <textarea id="batch-numbers" name="numbers" rows={5} className="input font-mono" placeholder={"345 555 1234\n+1 345 555 9876"} />
          </div>
          <div>
            <label className="label" htmlFor="batch-file">Or upload CSV / TXT</label>
            <input
              id="batch-file"
              name="file"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-lg file:border-0 file:bg-sand-warm file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
            />
          </div>
        </div>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="windowStart">Call from</label>
            <input id="windowStart" name="windowStart" type="time" className="input" defaultValue="09:00" required />
          </div>
          <div>
            <label className="label" htmlFor="windowEnd">Until</label>
            <input id="windowEnd" name="windowEnd" type="time" className="input" defaultValue="20:00" required />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="startsAt">Start (optional)</label>
            <input id="startsAt" name="startsAt" type="datetime-local" className="input" />
          </div>
        </div>
        <fieldset>
          <legend className="label">Days</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="days" value={d} defaultChecked={d !== "Sunday"} className="h-4 w-4 rounded border-ink/20" />
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
          <div className="mt-3 max-w-xs">
            <label className="label" htmlFor="reservedConcurrency">Lines kept free for other calls</label>
            <input id="reservedConcurrency" name="reservedConcurrency" type="number" min={0} className="input" placeholder="0" />
            <p className="mt-1 text-xs text-ink/50">
              Retell holds this many concurrent calls back from the batch, e.g. for callbacks.
            </p>
          </div>
        </details>
        <p className="text-xs text-ink/50">
          To reach +1 345 numbers, the caller number must be imported into Retell (SIP trunk).
          Numbers bought from Retell can only call US numbers.
        </p>
        <button className="btn-primary" type="submit" disabled={!active}>Send batch</button>
      </form>

      {batches.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Batches</h2>
          <div className="card p-0 divide-y divide-ink/5">
            {batches.map((b) => {
              const p = batchProgress.get(b.id) ?? { calls: 0, completed: 0 };
              const skipped = b.skippedDnc + b.skippedCalled + b.skippedInvalid;
              return (
                <div key={b.id} className="px-6 py-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      {b.status !== "SENT" && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                          {b.status === "FAILED" ? "failed" : "partly sent"}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-ink/40">{formatRelative(b.createdAt)}</span>
                  </div>
                  <p className="text-xs text-ink/60">
                    {b.submittedCount.toLocaleString()} sent
                    {skipped ? ` · ${skipped.toLocaleString()} skipped` : ""} ·{" "}
                    {minutesToTime(b.windowStart)}–{minutesToTime(b.windowEnd)}{" "}
                    {b.days.length ? b.days.map((d) => d.slice(0, 3)).join(", ") : "every day"}
                    {b.startsAt
                      ? ` · from ${b.startsAt.toLocaleString("en-GB", { timeZone: "America/Cayman", dateStyle: "medium", timeStyle: "short" })}`
                      : ""}
                  </p>
                  {b.submittedCount > 0 && (
                    <div>
                      <div className="h-1.5 rounded-full bg-sea-mist">
                        <div
                          className="h-1.5 rounded-full bg-sea"
                          style={{ width: `${Math.min(100, (p.calls / b.submittedCount) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink/50">
                        {p.calls.toLocaleString()} of {b.submittedCount.toLocaleString()} dialled ·{" "}
                        {p.completed.toLocaleString()} completed
                      </p>
                    </div>
                  )}
                  {b.error && <p className="text-xs text-accent-deep">{b.error}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <form key={searchParams.batch} action={placeCalls} className="card space-y-4">
        <input type="hidden" name="pollId" value={poll.id} />
        <div>
          <h2 className="text-lg font-semibold">Call now</h2>
          <p className="mt-1 text-sm text-ink/60">
            Dial straight away, ignoring calling hours. Useful for test calls. Up to{" "}
            {MAX_CALLS_PER_SUBMIT} numbers, one per line. Numbers on the do-not-call list are skipped.
          </p>
        </div>
        {active && (
          <>
            <textarea name="numbers" rows={3} className="input font-mono" placeholder={"345 555 1234"} required />
            <button className="btn-secondary" type="submit">Call these numbers</button>
          </>
        )}
      </form>

      <section>
        <h2 className="text-lg font-semibold mb-3">Callbacks requested</h2>
        <div className="card p-0 divide-y divide-ink/5">
          {callbacks.length === 0 ? (
            <p className="p-6 text-sm text-ink/60">None pending.</p>
          ) : (
            callbacks.map((cb) => (
              <div key={cb.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div>
                  <p className="font-medium">{cb.preferredTime}</p>
                  <p className="text-xs text-ink/50 font-mono">
                    {cb.phoneNumber} · asked {formatRelative(cb.createdAt)}
                  </p>
                </div>
                <form action={resolveCallback} className="flex gap-2">
                  <input type="hidden" name="callbackId" value={cb.id} />
                  <button name="action" value="call" className="btn-primary px-3 py-1.5" disabled={poll.status !== "ACTIVE"}>
                    Call now
                  </button>
                  <button name="action" value="cancel" className="btn-secondary px-3 py-1.5">
                    Dismiss
                  </button>
                </form>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent calls</h2>
        <div className="card p-0 divide-y divide-ink/5">
          {calls.length === 0 ? (
            <p className="p-6 text-sm text-ink/60">No calls yet.</p>
          ) : (
            calls.map((c) => {
              const a = (c.analysis ?? {}) as Record<string, unknown>;
              const flags = [
                a.interviewer_deviation === true && "agent deviated",
                a.respondent_understanding === "poor" && "poor understanding",
                a.respondent_understanding === "some_difficulty" && "some difficulty",
                typeof a.respondent_concerns === "string" && a.respondent_concerns && "concerns raised",
              ].filter(Boolean) as string[];
              const responses = [...c.responses].sort((x, y) => compareQuestionIds(x.questionId, y.questionId));
              return (
                <details key={c.id} className="group px-6 py-4">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <OutcomeBadge outcome={c.outcome} />
                      <span className="text-sm text-ink/70">
                        {c.responses.length} answer{c.responses.length === 1 ? "" : "s"}
                        {c.lastQuestionReached ? ` · reached ${c.lastQuestionReached}` : ""}
                      </span>
                      {flags.map((f) => (
                        <span key={f} className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent-deep">
                          {f}
                        </span>
                      ))}
                    </span>
                    <span className="text-xs text-ink/40">
                      {formatSeconds(c.durationMs != null ? Math.round(c.durationMs / 1000) : null)} ·{" "}
                      {formatRelative(c.startedAt ?? c.createdAt)}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3 text-sm">
                    {c.summary && <p className="text-ink/70">{c.summary}</p>}
                    {responses.length > 0 && (
                      <table className="w-full table-fixed text-left">
                        <tbody className="divide-y divide-ink/5">
                          {responses.map((r) => (
                            <tr key={r.id}>
                              <td className="w-12 py-1 pr-3 font-mono text-xs text-ink/50 align-top">{r.questionId}</td>
                              <td className="py-1">
                                {r.answer}
                                {r.verbatim && <span className="text-ink/50"> — “{r.verbatim}”</span>}
                                {r.source === "analysis" && (
                                  <span className="ml-2 text-[11px] text-ink/40">(from post-call analysis)</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {typeof a.deviation_notes === "string" && a.deviation_notes && (
                      <p><span className="font-medium">Deviation:</span> {a.deviation_notes}</p>
                    )}
                    {typeof a.respondent_concerns === "string" && a.respondent_concerns && (
                      <p><span className="font-medium">Concerns:</span> {a.respondent_concerns}</p>
                    )}
                    <p className="font-mono text-[11px] text-ink/40">
                      {c.retellCallId}
                      {c.disconnectionReason ? ` · ${c.disconnectionReason}` : ""}
                      {c.consentGiven === false ? " · no consent" : ""}
                    </p>
                  </div>
                </details>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

// --- Setup -------------------------------------------------------

const ENV_CHECKS = [
  ["RETELL_API_KEY", "Retell API key"],
  ["RETELL_AGENT_ID", "Default agent"],
  ["RETELL_FROM_NUMBER", "Default caller number"],
  ["PHONE_HASH_SECRET", "Phone hash secret"],
] as const;

function SetupTab({
  poll,
  saved,
  applied,
}: {
  poll: Poll;
  saved: boolean;
  applied?: string;
}): JSX.Element {
  const vars = (poll.variables ?? {}) as Record<string, string>;
  const missing = ENV_CHECKS.filter(([key]) => !process.env[key]);
  const nextStatuses = (["DRAFT", "ACTIVE", "CLOSED"] as const).filter((s) => s !== poll.status);
  const hasQuestions = Boolean(vars.survey_questions?.trim());

  return (
    <div className="space-y-6 max-w-3xl">
      {saved && <Banner tone="ok">Saved.</Banner>}
      {applied && <Banner tone="ok">Loaded &ldquo;{applied}&rdquo;. Edit the questions below, then save.</Banner>}
      {missing.length > 0 && (
        <Banner tone="error">
          Missing environment variables: {missing.map(([k]) => k).join(", ")}. Calls can&apos;t be
          placed until these are set.
        </Banner>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold">Start from a template</h2>
        <p className="mt-1 text-sm text-ink/60">
          Ready-made question sets with balanced scales, an explicit way to say &ldquo;don&rsquo;t
          know&rdquo;, and demographics that match the weighting presets. Each one explains which
          words are load-bearing — read that before editing.
        </p>
        {hasQuestions ? (
          <p className="mt-4 text-sm text-accent-deep">
            This poll already has survey questions, so templates are locked. Clear the survey
            questions field below and save if you want to start from one.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {POLL_TEMPLATES.map((t) => (
              <li key={t.key} className="rounded-xl border border-ink/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.name}</p>
                    <p className="mt-0.5 text-sm text-ink/60">{t.description}</p>
                    <p className="mt-1 text-xs text-ink/40">
                      About {t.estimatedMinutes} minutes ·{" "}
                      {t.survey.split("\n").length + t.screening.split("\n").length + t.demographics.split("\n").length}{" "}
                      questions
                    </p>
                  </div>
                  <form action={applyTemplate} className="shrink-0">
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="template" value={t.key} />
                    <button type="submit" className="btn-secondary px-4 py-2">
                      Use this
                    </button>
                  </form>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-sea-deep">
                    Why it&rsquo;s worded this way
                  </summary>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink/70">
                    {t.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Status</h2>
          <p className="text-sm text-ink/60">
            Only active polls can place calls. Closing a poll keeps its results.
          </p>
        </div>
        <form action={setPollStatus} className="flex gap-2">
          <input type="hidden" name="pollId" value={poll.id} />
          {nextStatuses.map((s) => (
            <button
              key={s}
              name="status"
              value={s}
              className={s === "ACTIVE" ? "btn-primary px-4 py-2" : "btn-secondary px-4 py-2"}
            >
              {s === "ACTIVE" ? "Activate" : s === "CLOSED" ? "Close" : "Back to draft"}
            </button>
          ))}
        </form>
      </div>

      <form action={updatePoll} className="card space-y-5">
        <input type="hidden" name="pollId" value={poll.id} />
        <h2 className="text-lg font-semibold">Poll settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Internal name</label>
            <input id="name" name="name" className="input" defaultValue={poll.name} />
          </div>
          <div>
            <label className="label" htmlFor="retellAgentId">Retell agent ID (optional)</label>
            <input
              id="retellAgentId"
              name="retellAgentId"
              className="input font-mono"
              defaultValue={poll.retellAgentId ?? ""}
              placeholder={process.env.RETELL_AGENT_ID ?? "agent_..."}
            />
          </div>
          <div>
            <label className="label" htmlFor="fromNumber">Caller number (optional)</label>
            <input
              id="fromNumber"
              name="fromNumber"
              className="input font-mono"
              defaultValue={poll.fromNumber ?? ""}
              placeholder={process.env.RETELL_FROM_NUMBER ?? "+1345..."}
            />
          </div>
        </div>

        <div className="space-y-4 border-t border-ink/5 pt-5">
          <div>
            <h3 className="font-semibold">Script</h3>
            <p className="text-sm text-ink/60">
              These fill the agent&apos;s prompt on every call. Start each question on its own line
              with its ID, then list the options, e.g.{" "}
              <code className="font-mono text-xs">Q1. How would you rate ...? (Excellent / Good / Fair / Poor)</code>.
              Add skip rules in brackets.
            </p>
          </div>
          {POLL_VARIABLES.map((v) => (
            <div key={v.key}>
              <label className="label" htmlFor={v.key}>{v.label}</label>
              {v.rows > 1 ? (
                <textarea
                  id={v.key}
                  name={v.key}
                  rows={v.rows}
                  className="input font-mono text-xs leading-relaxed"
                  defaultValue={vars[v.key] ?? ""}
                />
              ) : (
                <input id={v.key} name={v.key} className="input" defaultValue={vars[v.key] ?? ""} />
              )}
            </div>
          ))}
        </div>

        <button className="btn-primary" type="submit">Save</button>
      </form>

      <p className="text-xs text-ink/50 font-mono">Poll ID: {poll.id}</p>
    </div>
  );
}

// --- Bits --------------------------------------------------------

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-ink/60">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-ink/40">{hint}</p>}
    </div>
  );
}


const OUTCOME_TONE: Partial<Record<PollCallOutcome, string>> = {
  COMPLETED: "bg-sea-mist text-sea-deep",
  PARTIAL: "bg-sand-warm text-accent-deep",
  CALLBACK_REQUESTED: "bg-sand-warm text-accent-deep",
  DO_NOT_CALL: "bg-ink text-sand",
  HOSTILE: "bg-ink text-sand",
  DISTRESSED: "bg-ink text-sand",
};

function OutcomeBadge({ outcome }: { outcome: PollCallOutcome }): JSX.Element {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", OUTCOME_TONE[outcome] ?? "bg-ink/5 text-ink/60")}>
      {formatOutcome(outcome)}
    </span>
  );
}
