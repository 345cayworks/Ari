import type { Poll } from "@prisma/client";
import { TARGET_PRESETS } from "@/lib/polling/census";
import { compareQuestionIds, parseQuestionText } from "@/lib/polling/results";
import { loadPollResults } from "@/lib/polling/weighted";
import { formatCategories, readWeightingConfig } from "@/lib/polling/weighting";
import { addWeightingTarget, removeWeightingTarget, saveWeighting } from "../actions";
import { Banner } from "../banner";

const pct = (v: number) => `${v.toFixed(1)}%`;

export async function WeightingTab({
  poll,
  searchParams,
}: {
  poll: Poll;
  searchParams: Record<string, string | undefined>;
}): Promise<JSX.Element> {
  const config = readWeightingConfig(poll.weighting);
  // Diagnostics always use the saved targets, even while weighting is off.
  const { weighting } = await loadPollResults(
    { ...poll, weighting: { ...config, enabled: true } as object },
    { includePartial: false, weighted: true }
  );
  const texts = parseQuestionText((poll.variables ?? {}) as Record<string, unknown>);
  const used = new Set(config.targets.map((t) => t.questionId));
  // Demographic questions first: they're what you'd normally weight on.
  const questionIds = [...texts.keys()]
    .filter((id) => !used.has(id))
    .sort((a, b) => Number(b.startsWith("D")) - Number(a.startsWith("D")) || compareQuestionIds(a, b));

  return (
    <div className="space-y-8 max-w-3xl">
      {searchParams.saved === "1" && <Banner tone="ok">Saved.</Banner>}

      <div className="text-sm text-ink/70 space-y-2">
        <p>
          Weighting adjusts completed interviews so the sample matches the population on the
          questions below, for example district or age. Weights are raked across all targets
          together and capped so no one respondent counts for too much.
        </p>
        <p>
          Enter each category as <code className="font-mono text-xs">Name | target | aliases</code>, one
          per line. Targets can be counts or percentages. Aliases are other ways respondents
          might answer, so they still match.
        </p>
      </div>

      {config.targets.length > 0 && (
        <form action={saveWeighting} className="card space-y-6">
          <input type="hidden" name="pollId" value={poll.id} />
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="enabled" defaultChecked={config.enabled} className="h-4 w-4 rounded border-ink/20" />
            Apply weighting to results and CSV export
          </label>

          {config.targets.map((t) => {
            const report = weighting?.margins.find((m) => m.questionId === t.questionId);
            const text = formatCategories(t.categories);
            // Room for long alias lists, which wrap.
            const rows = Math.max(4, t.categories.length + Math.ceil(text.length / 70) + 1);
            return (
              <div key={t.questionId} className="space-y-3 border-t border-ink/5 pt-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex-1 min-w-[12rem]">
                    <label className="label" htmlFor={`label:${t.questionId}`}>
                      Target for {t.questionId}
                      {texts.get(t.questionId) && (
                        <span className="ml-1 normal-case font-normal tracking-normal text-ink/50">
                          ({texts.get(t.questionId)})
                        </span>
                      )}
                    </label>
                    <input id={`label:${t.questionId}`} name={`label:${t.questionId}`} className="input" defaultValue={t.label} />
                  </div>
                  {/* Belongs to its own form below, so Enter in a field saves instead. */}
                  <button form={`remove-${t.questionId}`} type="submit" className="btn-secondary px-3 py-2">
                    Remove
                  </button>
                </div>
                <textarea
                  name={`categories:${t.questionId}`}
                  rows={rows}
                  className="input font-mono text-xs leading-relaxed"
                  defaultValue={text}
                  placeholder={"18-34 | 28 | 18 to 34\n35-54 | 38\n55+ | 34 | 55 and over, 55 or older"}
                />
                <div>
                  <label className="label" htmlFor={`source:${t.questionId}`}>Source</label>
                  <input
                    id={`source:${t.questionId}`}
                    name={`source:${t.questionId}`}
                    className="input text-xs"
                    defaultValue={t.source ?? ""}
                    placeholder="e.g. ESO 2021 Census, Table 4.1A, Caymanians aged 18+"
                  />
                </div>
                {report && <MarginTable report={report} />}
              </div>
            );
          })}

          <div className="grid gap-4 grid-cols-2 max-w-sm border-t border-ink/5 pt-5">
            <div>
              <label className="label" htmlFor="trimMin">Min weight</label>
              <input id="trimMin" name="trimMin" type="number" step="0.05" className="input" defaultValue={config.trimMin} />
            </div>
            <div>
              <label className="label" htmlFor="trimMax">Max weight</label>
              <input id="trimMax" name="trimMax" type="number" step="0.5" className="input" defaultValue={config.trimMax} />
            </div>
          </div>
          <button className="btn-primary" type="submit">Save weighting</button>
        </form>
      )}
      {config.targets.map((t) => (
        <form key={t.questionId} id={`remove-${t.questionId}`} action={removeWeightingTarget} hidden>
          <input type="hidden" name="pollId" value={poll.id} />
          <input type="hidden" name="questionId" value={t.questionId} />
        </form>
      ))}

      {weighting && (
        <div className="card">
          <h2 className="text-lg font-semibold">Effect on precision</h2>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            {(
              [
                ["Completed interviews", weighting.n.toLocaleString()],
                ["Effective sample", Math.round(weighting.effectiveN).toLocaleString()],
                ["Design effect", weighting.designEffect.toFixed(2)],
                ["Margin of error (95%)", `±${weighting.marginOfError.toFixed(1)} pts`],
                ["Smallest weight", weighting.minWeight.toFixed(2)],
                ["Largest weight", weighting.maxWeight.toFixed(2)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-ink/60">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {weighting.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-accent-deep">
              {weighting.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink/50">
            The margin of error allows for the design effect of weighting. It assumes a random
            sample; non-response and coverage bias aren&apos;t included.
          </p>
        </div>
      )}

      <form action={addWeightingTarget} className="card space-y-4">
        <input type="hidden" name="pollId" value={poll.id} />
        <h2 className="text-lg font-semibold">Add a target</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="questionId">Question</label>
            {questionIds.length > 0 ? (
              <select id="questionId" name="questionId" className="input">
                {questionIds.map((id) => (
                  <option key={id} value={id}>
                    {id} – {(texts.get(id) ?? "").slice(0, 60)}
                  </option>
                ))}
              </select>
            ) : (
              <input id="questionId" name="questionId" className="input font-mono" placeholder="D2" />
            )}
          </div>
          <div>
            <label className="label" htmlFor="preset">Start from</label>
            <select id="preset" name="preset" className="input">
              <option value="">Blank (enter my own figures)</option>
              {TARGET_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <ul className="space-y-2 text-xs text-ink/60">
          {TARGET_PRESETS.map((p) => (
            <li key={p.key}>
              <span className="font-medium text-ink/80">{p.label}:</span> {p.description}{" "}
              <span className="text-ink/40">Source: {p.source}.</span>
            </li>
          ))}
          <li>
            Age, sex and Caymanian status targets aren&apos;t preset. Enter them from the ESO 2021
            Census tables for the population you&apos;re polling (e.g. Caymanians aged 18+ for voter polls).
          </li>
        </ul>
        <button className="btn-primary" type="submit">Add target</button>
      </form>
    </div>
  );
}

function MarginTable({
  report,
}: {
  report: NonNullable<Awaited<ReturnType<typeof loadPollResults>>["weighting"]>["margins"][number];
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-ink/50">
              <th className="py-1 pr-3 font-medium">Category</th>
              <th className="py-1 pr-3 font-medium text-right">n</th>
              <th className="py-1 pr-3 font-medium text-right">Sample</th>
              <th className="py-1 pr-3 font-medium text-right">Weighted</th>
              <th className="py-1 font-medium text-right">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {report.rows.map((r) => (
              <tr key={r.name}>
                <td className="py-1 pr-3">{r.name}</td>
                <td className="py-1 pr-3 text-right text-ink/60">{r.n}</td>
                <td className="py-1 pr-3 text-right text-ink/60">{pct(r.samplePct)}</td>
                <td className="py-1 pr-3 text-right font-medium">{pct(r.weightedPct)}</td>
                <td className="py-1 text-right text-ink/60">{pct(r.targetPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(report.unmatched.length > 0 || report.missing > 0) && (
        <p className="text-xs text-accent-deep">
          {report.missing > 0 && `${report.missing} respondent(s) didn't answer this question. `}
          {report.unmatched.length > 0 && (
            <>
              Not matched to any category (add as aliases):{" "}
              {report.unmatched.slice(0, 10).map((u) => `“${u.answer}” (${u.count})`).join(", ")}
              {report.unmatched.length > 10 ? ", …" : ""}
            </>
          )}{" "}
          These respondents keep their weight from the other targets.
        </p>
      )}
    </div>
  );
}
