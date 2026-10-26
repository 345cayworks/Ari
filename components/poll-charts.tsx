// Charts and publication guards for poll results. Server components, no client
// JS and no charting library — the Worker is at 2.2 MB gzipped against a 3 MB
// limit, and Recharts or Chart.js would eat most of the remaining headroom.
// Marks are plain HTML so text can never be clipped or scaled oddly.
//
// Palette validated with the data-visualisation validator against #ffffff, the
// card surface (not the usual #fcfcfb):
//   categorical, 8 slots  — worst adjacent CVD ΔE 9.1, normal-vision 19.6
//   diverging, 4 steps    — worst adjacent CVD ΔE 17.0, normal-vision 22.7
// The brand's own sea↔accent pair was tried first and failed: its two amber
// steps measure ΔE 10.4 to normal vision, under the floor of 15.
// Three categorical slots and both inner diverging steps fall under 3:1
// contrast on white, so the relief rule applies — every bar carries a direct
// value label and every chart ships a table view.

import type { PollCallOutcome } from "@prisma/client";
import type { Tally } from "@/lib/polling/results";
import type { WeightingResult } from "@/lib/polling/weighting";

const CATEGORICAL = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#6250d6", "#e34948",
] as const;

const DIVERGING = {
  posStrong: "#1c5cab",
  posMild: "#6da7ec",
  negMild: "#f09b7a",
  negStrong: "#c2362f",
} as const;

// Visible against white, plainly not a pole. The documented diverging midpoint
// (#f0efec) is near-invisible as a bar on a white card.
const NEUTRAL_FILL = "#c3c2b7";
const GRID = "#e1e0d9";

const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/** Below this, a figure should not be published on its own. */
export const MIN_REPORTABLE_BASE = 100;
/** Between the two, a figure is indicative only. */
export const INDICATIVE_BASE = 50;

const POSITIVE = [
  "very satisfied", "satisfied", "strongly agree", "agree", "right direction",
  "strongly approve", "approve", "support", "strongly support", "better", "improving",
];
const NEGATIVE = [
  "very dissatisfied", "dissatisfied", "strongly disagree", "disagree", "wrong direction",
  "strongly disapprove", "disapprove", "oppose", "strongly oppose", "worse", "getting worse",
];
const NEUTRAL = [
  "don't know", "dont know", "do not know", "not sure", "unsure", "no opinion",
  "neither", "neither agree nor disagree", "refused", "prefer not to say", "no answer",
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, "");

export function isNeutralAnswer(answer: string): boolean {
  return NEUTRAL.includes(norm(answer));
}

// An ordered scale gets the diverging ramp; anything else is identity and gets
// categorical hues in fixed order. Misreading this changes colour only, never a
// number, so the lexicon is deliberately small and literal.
function isOrderedScale(answers: string[]): boolean {
  const live = answers.filter((a) => !isNeutralAnswer(a)).map(norm);
  if (live.length < 2 || live.length > 7) return false;
  return live.some((a) => POSITIVE.includes(a)) && live.some((a) => NEGATIVE.includes(a));
}

// Diverging shades in option order: extremes dark, inner steps light, so the
// ramp reads as polarity rather than as eight unrelated colours.
function divergingFills(live: string[]): string[] {
  const half = Math.ceil(live.length / 2);
  return live.map((_, i) => {
    const fromPole = i < half ? i : live.length - 1 - i;
    const positive = i < half;
    if (fromPole === 0) return positive ? DIVERGING.posStrong : DIVERGING.negStrong;
    return positive ? DIVERGING.posMild : DIVERGING.negMild;
  });
}

function fillsFor(answers: string[]): Map<string, string> {
  const live = answers.filter((a) => !isNeutralAnswer(a));
  const shades = isOrderedScale(answers)
    ? divergingFills(live)
    : live.map((_, i) => CATEGORICAL[i % CATEGORICAL.length]);
  const map = new Map<string, string>();
  live.forEach((a, i) => map.set(a, shades[i]));
  for (const a of answers) if (!map.has(a)) map.set(a, NEUTRAL_FILL);
  return map;
}

/** 95% margin of error for a single proportion, in percentage points. */
export function marginFor(p: number, base: number): number {
  if (base <= 0) return 0;
  return 196 * Math.sqrt(Math.max(p * (1 - p), 0) / base);
}

const whole = (p: number) => `${Math.round(p * 100)}%`;

// White or ink on a fill, by its luminance — a label inside a light categorical
// hue is illegible in white.
function readableOn(hex: string): string {
  const v = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2);
  return L > 0.45 ? "#0b0b0b" : "#ffffff";
}

function Bar({
  pct,
  fill,
  moe,
  title,
  label,
}: {
  pct: number;
  fill: string;
  moe: number | null;
  title: string;
  label: string;
}): JSX.Element {
  const width = Math.max(0, Math.min(1, pct)) * 100;
  const span = moe !== null && moe > 0 ? moe : 0;
  const lo = Math.max(0, width - span);
  const hi = Math.min(100, width + span);
  // The label sits clear of the whisker's right cap, not on top of it — at the
  // bar tip it would be struck through by the whisker line. Once that position
  // runs out of track it moves inside the bar, anchored to the bar's own end
  // rather than the track's, or it lands on the surface and disappears.
  const inside = hi > 88;
  // 4px rounded data-end, square at the baseline; 16px thick, under the 24px cap.
  return (
    <div className="relative h-4" title={title}>
      <div
        className="absolute inset-y-0 left-0 rounded-r-[4px]"
        style={{ width: `${width}%`, backgroundColor: fill }}
      />
      {span > 0 && (
        // Whisker: ±MoE around the tip, hairline, with end caps.
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: `${lo}%`, width: `${hi - lo}%` }}
        >
          <div className="relative h-px w-full" style={{ backgroundColor: "#52514e" }}>
            <span className="absolute -top-[3px] left-0 h-[7px] w-px" style={{ backgroundColor: "#52514e" }} />
            <span className="absolute -top-[3px] right-0 h-[7px] w-px" style={{ backgroundColor: "#52514e" }} />
          </div>
        </div>
      )}
      {/* Value by the tip, which is where the eye already is. */}
      <span
        className="absolute top-1/2 text-[11px] font-medium tabular-nums"
        style={
          inside
            ? {
                left: `calc(${width}% - 6px)`,
                transform: "translate(-100%, -50%)",
                color: readableOn(fill),
              }
            : { left: `calc(${hi}% + 6px)`, transform: "translateY(-50%)", color: "#52514e" }
        }
      >
        {label}
      </span>
    </div>
  );
}

export function QuestionChart({
  tally,
  weighted,
  effectiveBase,
}: {
  tally: Tally;
  weighted: boolean;
  /** Effective sample for the margin of error — effectiveN when weighted. */
  effectiveBase: number;
}): JSX.Element {
  const answers = tally.answers.map((a) => a.answer);
  const fills = fillsFor(answers);
  const allBase = tally.totalWeight || 1;
  const viewBase =
    tally.answers.filter((a) => !isNeutralAnswer(a.answer)).reduce((s, a) => s + a.weight, 0) || 0;
  const hasNeutral = viewBase > 0 && viewBase < allBase - 0.000001;
  const shown = tally.answers.slice(0, 12);
  const thin = tally.total < INDICATIVE_BASE;
  const indicative = tally.total >= INDICATIVE_BASE && tally.total < MIN_REPORTABLE_BASE;

  return (
    <div className="card">
      <p className="text-sm">
        <span className="font-mono text-xs text-ink/50 mr-2">{tally.questionId}</span>
        <span className="font-medium">{tally.text ?? ""}</span>
      </p>
      <p className="mt-0.5 text-xs text-ink/50">
        Base: {tally.total.toLocaleString()} {tally.total === 1 ? "answer" : "answers"}
        {hasNeutral ? ", including those with no view" : ""} · percentages of all who answered
        {weighted ? " · weighted" : " · unweighted"}
      </p>
      {(thin || indicative) && (
        <p className={`mt-2 text-xs ${thin ? "text-[#d03b3b]" : "text-accent-deep"}`}>
          {thin
            ? `Base of ${tally.total} is too small to report — treat as a sanity check only.`
            : `Base of ${tally.total} is below ${MIN_REPORTABLE_BASE}; indicative only, do not publish as a standalone figure.`}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {shown.map((a) => {
          const p = a.weight / allBase;
          const moe = marginFor(p, effectiveBase);
          const neutral = isNeutralAnswer(a.answer);
          return (
            <li key={a.answer} className="text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    aria-hidden
                    className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: fills.get(a.answer) }}
                  />
                  <span className="truncate text-ink/80">{a.answer}</span>
                </span>
                <span className="shrink-0 tabular-nums text-ink/40">
                  n={a.count}
                  {!neutral && hasNeutral && (
                    <span> · {whole(a.weight / viewBase)} of those with a view</span>
                  )}
                </span>
              </div>
              <div className="mt-1">
                <Bar
                  pct={p}
                  fill={fills.get(a.answer) ?? NEUTRAL_FILL}
                  moe={moe}
                  label={whole(p)}
                  title={`${a.answer}: ${whole(p)} ±${moe.toFixed(1)} points (n=${a.count})`}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {tally.answers.length > 12 && (
        <p className="mt-2 text-xs text-ink/50">
          + {tally.answers.length - 12} other answers (see the CSV export)
        </p>
      )}
      <p className="mt-3 text-xs text-ink/40">
        Whiskers show the 95% margin of error for each figure
        {weighted ? ", from the effective sample" : ""}. Percentages are rounded and may not sum to 100.
      </p>
    </div>
  );
}

const DISPOSITION_BUCKETS = [
  { key: "completed", label: "Completed", fill: STATUS.good },
  { key: "partial", label: "Partial", fill: STATUS.warning },
  { key: "refused", label: "Refused or screened out", fill: STATUS.serious },
  { key: "notReached", label: "Not reached", fill: NEUTRAL_FILL },
  { key: "doNotCall", label: "Do not call", fill: STATUS.critical },
] as const;

export function DispositionChart({
  buckets,
}: {
  buckets: Record<(typeof DISPOSITION_BUCKETS)[number]["key"], number>;
}): JSX.Element {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const present = DISPOSITION_BUCKETS.filter((b) => buckets[b.key] > 0);

  return (
    <div className="card">
      <h2 className="text-sm font-semibold">What happened to the calls</h2>
      <p className="mt-0.5 text-xs text-ink/50">{total.toLocaleString()} dialled</p>
      {total === 0 ? (
        <p className="mt-3 text-sm text-ink/60">No calls yet.</p>
      ) : (
        <>
          {/* Stacked bar: 2px surface gaps do the separating, never a stroke. */}
          <div className="mt-3 flex h-4 w-full gap-[2px] overflow-hidden">
            {present.map((b) => (
              <div
                key={b.key}
                title={`${b.label}: ${buckets[b.key].toLocaleString()} (${whole(buckets[b.key] / total)})`}
                className="h-4 first:rounded-l-[4px] last:rounded-r-[4px]"
                style={{ width: `${(buckets[b.key] / total) * 100}%`, backgroundColor: b.fill }}
              />
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {DISPOSITION_BUCKETS.map((b) => (
              <div key={b.key} className="flex items-baseline justify-between gap-2">
                <dt className="flex items-baseline gap-2 text-ink/60">
                  <span
                    aria-hidden
                    className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: b.fill }}
                  />
                  {b.label}
                </dt>
                <dd className="tabular-nums font-medium">
                  {buckets[b.key].toLocaleString()}
                  <span className="ml-1 font-normal text-ink/40">{whole(buckets[b.key] / total)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

/** Reasons a result should not be published. Empty means it is safe to quote. */
export function publicationBlockers(
  n: number,
  weighting: WeightingResult | null
): string[] {
  const out: string[] = [];
  if (n < MIN_REPORTABLE_BASE) {
    out.push(
      `The sample is ${n.toLocaleString()}; ${MIN_REPORTABLE_BASE} is the usual floor for publishing a headline figure.`
    );
  }
  if (weighting) {
    if (!weighting.converged) {
      out.push("Weighting did not converge, so the weighted figures are unreliable.");
    }
    if (weighting.designEffect > 2) {
      out.push(
        `The design effect is ${weighting.designEffect.toFixed(2)}, so weighting has cut the effective sample to ${Math.round(weighting.effectiveN).toLocaleString()} — under half. Re-check the targets before quoting these numbers.`
      );
    }
    if (weighting.maxWeight > 5) {
      out.push(
        `One respondent carries a weight of ${weighting.maxWeight.toFixed(1)}, so a single interview is moving the result. Trim the weights or collect more of that group.`
      );
    }
  }
  return out;
}

export function PublicationGate({ blockers }: { blockers: string[] }): JSX.Element | null {
  if (blockers.length === 0) return null;
  return (
    <div
      className="rounded-2xl border px-5 py-4"
      style={{ borderColor: STATUS.critical, backgroundColor: "#fdf3f3" }}
    >
      <p className="flex items-baseline gap-2 text-sm font-semibold" style={{ color: "#8f2020" }}>
        <span aria-hidden>▲</span> Not ready to publish
      </p>
      <ul className="mt-2 space-y-1 text-sm" style={{ color: "#8f2020" }}>
        {blockers.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

export interface DisclosureFacts {
  pollName: string;
  companyName: string;
  sponsor: string;
  topic: string;
  firstCall: Date | null;
  lastCall: Date | null;
  dialled: number;
  completed: number;
  partial: number;
  refused: number;
  n: number;
  effectiveN: number | null;
  marginOfError: number | null;
  weightedTo: string;
  questions: { id: string; text: string }[];
}

// Everything a published figure should be accompanied by. Most of it comes
// straight out of the poll, which is the point: a disclosure block nobody has
// to assemble by hand is one that actually gets published.
export function DisclosureBlock({ facts }: { facts: DisclosureFacts }): JSX.Element {
  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";
  const fieldwork =
    facts.firstCall && facts.lastCall && fmt(facts.firstCall) !== fmt(facts.lastCall)
      ? `${fmt(facts.firstCall)} to ${fmt(facts.lastCall)}`
      : fmt(facts.firstCall);
  const cooperation = facts.completed + facts.partial + facts.refused;

  const rows: [string, string][] = [
    ["Survey", facts.pollName],
    ["Conducted by", facts.companyName || "—"],
    ["Commissioned by", facts.sponsor.trim() || "Conducted independently; no sponsor"],
    ["Subject", facts.topic || "—"],
    ["Fieldwork", fieldwork],
    ["Population", "Adults aged 18 and over resident in the Cayman Islands"],
    ["Method", "Automated telephone interview conducted by an AI interviewer, disclosed as automated at the start of every call"],
    [
      "Sample",
      `${facts.n.toLocaleString()} ${facts.n === 1 ? "interview" : "interviews"} from ${facts.dialled.toLocaleString()} ${facts.dialled === 1 ? "number" : "numbers"} dialled`,
    ],
    [
      "Cooperation rate",
      cooperation ? `${Math.round((facts.completed / cooperation) * 100)}% (completed ÷ completed + partial + refused)` : "—",
    ],
    ["Weighting", facts.weightedTo || "Unweighted"],
    [
      "Margin of error",
      facts.marginOfError !== null && facts.effectiveN !== null
        ? `±${facts.marginOfError.toFixed(1)} points at 95% confidence, from an effective sample of ${Math.round(facts.effectiveN).toLocaleString()}`
        : "Not applicable to unweighted counts",
    ],
  ];

  return (
    <div className="card">
      <h2 className="text-sm font-semibold">Disclosure</h2>
      <p className="mt-0.5 text-xs text-ink/50">
        Publish this alongside any figure from this survey. Copy it as it stands.
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="sm:flex sm:gap-4">
            <dt className="shrink-0 text-ink/50 sm:w-44">{k}</dt>
            <dd className="text-ink/80">{v}</dd>
          </div>
        ))}
      </dl>
      {facts.questions.length > 0 && (
        <>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-ink/70">
            Questions as asked, in order
          </p>
          <ol className="mt-2 space-y-1 text-sm text-ink/80">
            {facts.questions.map((q) => (
              <li key={q.id}>
                <span className="font-mono text-xs text-ink/50 mr-2">{q.id}</span>
                {q.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
