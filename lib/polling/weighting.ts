// Raking (iterative proportional fitting) of poll respondents to population
// targets on one or more demographic questions, with weight trimming.

export interface WeightCategory {
  name: string;
  target: number; // count or percentage; only the proportions matter
  aliases: string[];
}

export interface WeightTarget {
  questionId: string;
  label: string;
  source?: string;
  categories: WeightCategory[];
}

export interface WeightingConfig {
  enabled: boolean;
  targets: WeightTarget[];
  trimMin: number; // relative to the mean weight of 1
  trimMax: number;
}

export const DEFAULT_WEIGHTING: WeightingConfig = {
  enabled: false,
  targets: [],
  trimMin: 0.3,
  trimMax: 3,
};

export function readWeightingConfig(value: unknown): WeightingConfig {
  const v = (value ?? {}) as Partial<WeightingConfig>;
  return {
    enabled: Boolean(v.enabled),
    targets: Array.isArray(v.targets) ? v.targets : [],
    trimMin: typeof v.trimMin === "number" ? v.trimMin : DEFAULT_WEIGHTING.trimMin,
    trimMax: typeof v.trimMax === "number" ? v.trimMax : DEFAULT_WEIGHTING.trimMax,
  };
}

// --- Editing categories as text ----------------------------------

// One category per line: "Name | target | alias, alias".
export function formatCategories(categories: WeightCategory[]): string {
  return categories
    .map((c) => [c.name, String(c.target), c.aliases.join(", ")].filter(Boolean).join(" | "))
    .join("\n");
}

export function parseCategories(text: string): { categories: WeightCategory[]; error?: string } {
  const categories: WeightCategory[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const [name, target, aliases = ""] = line.split("|").map((p) => p.trim());
    const value = Number((target ?? "").replace(/[,%\s]/g, ""));
    if (!name || !(value > 0)) {
      return { categories, error: `Line ${i + 1} ("${line}") needs a name and a target above 0, e.g. "George Town | 49.3".` };
    }
    categories.push({
      name,
      target: value,
      aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
    });
  }
  if (categories.length < 2) {
    return { categories, error: "Add at least two categories." };
  }
  return { categories };
}

// --- Matching answers to categories ------------------------------

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+to\s+/g, "-")
    .replace(/[^a-z0-9+\-]/g, "");
}

export function categoryMatcher(target: WeightTarget): (answer: string | undefined) => number {
  const lookup = new Map<string, number>();
  target.categories.forEach((c, i) => {
    for (const key of [c.name, ...c.aliases]) {
      const k = normalizeAnswer(key);
      if (k && !lookup.has(k)) lookup.set(k, i);
    }
  });
  return (answer) => (answer === undefined ? -1 : lookup.get(normalizeAnswer(answer)) ?? -1);
}

// --- Raking ------------------------------------------------------

export interface Respondent {
  id: string;
  answers: Map<string, string>; // questionId -> answer
}

export interface MarginReport {
  questionId: string;
  label: string;
  matched: number;
  missing: number; // respondents with no answer for this question
  unmatched: { answer: string; count: number }[]; // answers matching no category
  rows: {
    name: string;
    n: number;
    samplePct: number;
    weightedPct: number;
    targetPct: number;
  }[];
}

export interface WeightingResult {
  weights: Map<string, number>;
  n: number;
  effectiveN: number;
  designEffect: number;
  marginOfError: number; // 95%, percentage points, at p = 0.5
  minWeight: number;
  maxWeight: number;
  converged: boolean;
  margins: MarginReport[];
  warnings: string[];
}

const MAX_ITERATIONS = 200;
const TOLERANCE = 1e-6;
const TRIM_ROUNDS = 10;

export function rake(respondents: Respondent[], config: WeightingConfig): WeightingResult {
  const n = respondents.length;
  const w = new Float64Array(n).fill(1);
  const warnings: string[] = [];

  // Per target: each respondent's category index (-1 = can't be placed) and
  // target shares among the categories that have at least one respondent.
  const margins = config.targets.map((t) => {
    const match = categoryMatcher(t);
    const cat = respondents.map((r) => match(r.answers.get(t.questionId)));
    const present = t.categories.map((_, i) => cat.includes(i));
    const presentTotal = t.categories.reduce((s, c, i) => s + (present[i] ? c.target : 0), 0);
    t.categories.forEach((c, i) => {
      if (!present[i] && n > 0) {
        warnings.push(`${t.label}: no respondents in "${c.name}", so its share is spread over the other categories.`);
      }
    });
    const share = t.categories.map((c, i) => (present[i] && presentTotal > 0 ? c.target / presentTotal : 0));
    return { target: t, cat, share };
  });

  const rakeOnce = (): boolean => {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let maxChange = 0;
      for (const m of margins) {
        const k = m.target.categories.length;
        const sums = new Float64Array(k);
        let total = 0;
        m.cat.forEach((c, i) => {
          if (c >= 0) {
            sums[c] += w[i];
            total += w[i];
          }
        });
        if (total === 0) continue;
        const factor = Array.from(sums, (s, c) => (s > 0 ? (total * m.share[c]) / s : 1));
        factor.forEach((f) => (maxChange = Math.max(maxChange, Math.abs(f - 1))));
        m.cat.forEach((c, i) => {
          if (c >= 0) w[i] *= factor[c];
        });
      }
      if (maxChange < TOLERANCE) return true;
    }
    return false;
  };

  const normalize = () => {
    const mean = w.reduce((a, b) => a + b, 0) / (n || 1);
    if (mean > 0) for (let i = 0; i < n; i++) w[i] /= mean;
  };

  let converged = true;
  if (n > 0 && margins.length > 0) {
    for (let round = 0; round < TRIM_ROUNDS; round++) {
      converged = rakeOnce();
      normalize();
      let clipped = false;
      for (let i = 0; i < n; i++) {
        const v = Math.min(config.trimMax, Math.max(config.trimMin, w[i]));
        if (v !== w[i]) {
          w[i] = v;
          clipped = true;
        }
      }
      normalize();
      if (!clipped) break;
    }
    if (!converged) warnings.push("Weights did not fully converge; check for conflicting or very small targets.");
  }

  const sumW = w.reduce((a, b) => a + b, 0);
  const sumW2 = w.reduce((a, b) => a + b * b, 0);
  const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;

  const reports: MarginReport[] = margins.map((m) => {
    const t = m.target;
    const counts = new Array(t.categories.length).fill(0);
    const sums = new Array(t.categories.length).fill(0);
    const unmatched = new Map<string, number>();
    let missing = 0;
    m.cat.forEach((c, i) => {
      if (c >= 0) {
        counts[c] += 1;
        sums[c] += w[i];
        return;
      }
      const answer = respondents[i].answers.get(t.questionId);
      if (answer === undefined) missing += 1;
      else unmatched.set(answer, (unmatched.get(answer) ?? 0) + 1);
    });
    const matched = counts.reduce((a, b) => a + b, 0);
    const matchedW = sums.reduce((a, b) => a + b, 0);
    const targetTotal = t.categories.reduce((s, c) => s + c.target, 0);
    return {
      questionId: t.questionId,
      label: t.label,
      matched,
      missing,
      unmatched: [...unmatched.entries()]
        .map(([answer, count]) => ({ answer, count }))
        .sort((a, b) => b.count - a.count),
      rows: t.categories.map((c, i) => ({
        name: c.name,
        n: counts[i],
        samplePct: matched ? (counts[i] / matched) * 100 : 0,
        weightedPct: matchedW ? (sums[i] / matchedW) * 100 : 0,
        targetPct: targetTotal ? (c.target / targetTotal) * 100 : 0,
      })),
    };
  });

  // Trimming trades accuracy for stability; say when it costs more than a point.
  reports.forEach((r, mi) => {
    const off = r.rows.some((row, i) => r.matched && Math.abs(row.weightedPct - margins[mi].share[i] * 100) > 1);
    if (off) warnings.push(`${r.label}: weight caps keep it more than 1 point off target. Widen the caps or accept the gap.`);
  });

  return {
    weights: new Map(respondents.map((r, i) => [r.id, w[i]])),
    n,
    effectiveN,
    designEffect: effectiveN > 0 ? n / effectiveN : 1,
    marginOfError: effectiveN > 0 ? 196 * Math.sqrt(0.25 / effectiveN) : 0,
    minWeight: n ? Math.min(...w) : 0,
    maxWeight: n ? Math.max(...w) : 0,
    converged,
    margins: reports,
    warnings,
  };
}
