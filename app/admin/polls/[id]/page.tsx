import Link from "next/link";
import { notFound } from "next/navigation";
import type { Poll, PollCallOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cn, formatRelative } from "@/lib/utils";
import {
  compareQuestionIds,
  computeStats,
  formatOutcome,
  formatSeconds,
  MAX_CALLS_PER_SUBMIT,
  parseQuestionText,
  POLL_VARIABLES,
  tallyResponses,
} from "@/lib/polling/results";
import { placeCalls, resolveCallback, setPollStatus, updatePoll } from "../actions";
import { StatusBadge } from "../status-badge";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | undefined>;
const TABS = [
  ["results", "Results"],
  ["calls", "Calls"],
  ["setup", "Setup"],
] as const;

export default async function PollPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: SearchParams;
}): Promise<JSX.Element> {
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

      {tab === "results" && <ResultsTab poll={poll} includePartial={searchParams.include === "partial"} />}
      {tab === "calls" && <CallsTab poll={poll} searchParams={searchParams} />}
      {tab === "setup" && <SetupTab poll={poll} saved={searchParams.saved === "1"} />}
    </div>
  );
}

// --- Results -----------------------------------------------------

async function ResultsTab({
  poll,
  includePartial,
}: {
  poll: Poll;
  includePartial: boolean;
}): Promise<JSX.Element> {
  const calls = await prisma.pollCall.findMany({
    where: { pollId: poll.id },
    select: { outcome: true, durationMs: true, analysis: true },
  });
  const stats = computeStats(calls);
  // Calls still in progress are left out until their analysis arrives.
  const outcome = includePartial ? { not: "IN_PROGRESS" as const } : { equals: "COMPLETED" as const };
  const responses = await prisma.pollResponse.findMany({
    where: { pollCall: { pollId: poll.id, outcome } },
    select: { questionId: true, answer: true },
  });
  const tallies = tallyResponses(
    responses,
    parseQuestionText((poll.variables ?? {}) as Record<string, unknown>)
  );
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <div className="space-y-8">
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
          <Link
            href={`/admin/polls/${poll.id}?tab=results${includePartial ? "" : "&include=partial"}`}
            className="text-sea-deep hover:underline"
          >
            {includePartial ? "Completed interviews only" : "Include partial interviews"}
          </Link>
          <a href={`/admin/polls/${poll.id}/export`} className="btn-secondary px-3 py-1.5">
            Export CSV
          </a>
        </div>
      </div>
      <p className="-mt-6 text-xs text-ink/50">
        Unweighted counts from {includePartial ? "all interviews with answers" : "completed interviews"}.
      </p>

      {tallies.length === 0 ? (
        <div className="card text-sm text-ink/60">No answers yet.</div>
      ) : (
        <div className="space-y-4">
          {tallies.map((t) => (
            <div key={t.questionId} className="card">
              <p className="text-sm">
                <span className="font-mono text-xs text-ink/50 mr-2">{t.questionId}</span>
                <span className="font-medium">{t.text ?? ""}</span>
              </p>
              <p className="mt-0.5 text-xs text-ink/50">{t.total.toLocaleString()} answer{t.total === 1 ? "" : "s"}</p>
              <ul className="mt-3 space-y-2">
                {t.answers.slice(0, 12).map((a) => (
                  <li key={a.answer} className="text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-ink/80">{a.answer}</span>
                      <span className="shrink-0 tabular-nums text-ink/60">
                        {a.count} · {pct(a.count, t.total)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-sea-mist">
                      <div
                        className="h-1.5 rounded-full bg-sea"
                        style={{ width: `${(a.count / t.total) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {t.answers.length > 12 && (
                <p className="mt-2 text-xs text-ink/50">
                  + {t.answers.length - 12} other answers (see CSV export)
                </p>
              )}
            </div>
          ))}
        </div>
      )}
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
  const [callbacks, calls] = await Promise.all([
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
  ]);
  const placed = searchParams.placed !== undefined;

  return (
    <div className="space-y-8">
      {placed && (
        <Banner tone={Number(searchParams.failed) ? "error" : "ok"}>
          {searchParams.placed} call(s) placed
          {Number(searchParams.blocked) ? `, ${searchParams.blocked} skipped (do not call)` : ""}
          {Number(searchParams.failed) ? `, ${searchParams.failed} failed` : ""}
          {Number(searchParams.skipped)
            ? `, ${searchParams.skipped} not sent (limit is ${MAX_CALLS_PER_SUBMIT} per batch)`
            : ""}
          .
        </Banner>
      )}

      <form key={searchParams.batch} action={placeCalls} className="card space-y-4">
        <input type="hidden" name="pollId" value={poll.id} />
        <div>
          <h2 className="text-lg font-semibold">Place calls</h2>
          <p className="mt-1 text-sm text-ink/60">
            One number per line, up to {MAX_CALLS_PER_SUBMIT} at a time. Seven-digit numbers are
            treated as +1 345. Numbers on the do-not-call list are skipped automatically.
          </p>
        </div>
        {poll.status !== "ACTIVE" ? (
          <p className="text-sm text-accent-deep">
            Activate this poll on the Setup tab before placing calls.
          </p>
        ) : (
          <>
            <textarea name="numbers" rows={5} className="input font-mono" placeholder={"345 555 1234\n+1 345 555 9876"} required />
            <button className="btn-primary" type="submit">Call these numbers</button>
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

function SetupTab({ poll, saved }: { poll: Poll; saved: boolean }): JSX.Element {
  const vars = (poll.variables ?? {}) as Record<string, string>;
  const missing = ENV_CHECKS.filter(([key]) => !process.env[key]);
  const nextStatuses = (["DRAFT", "ACTIVE", "CLOSED"] as const).filter((s) => s !== poll.status);

  return (
    <div className="space-y-6 max-w-3xl">
      {saved && <Banner tone="ok">Saved.</Banner>}
      {missing.length > 0 && (
        <Banner tone="error">
          Missing environment variables: {missing.map(([k]) => k).join(", ")}. Calls can&apos;t be
          placed until these are set.
        </Banner>
      )}

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

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 text-sm",
        tone === "ok" ? "bg-sea-mist text-sea-deep" : "bg-accent/15 text-accent-deep"
      )}
    >
      {children}
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
