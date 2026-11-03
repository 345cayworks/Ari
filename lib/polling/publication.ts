import type { WeightingResult } from "./weighting";

/**
 * Whether a figure is fit to publish, and why not when it is not.
 *
 * This lived in `components/poll-charts.tsx`, next to the banner that renders
 * it. It moved here when results started being delivered to campaigns over
 * the API: the gate now travels with the numbers to another system, so it is
 * domain logic rather than presentation, and a lib module must not import from
 * components to get at it. `poll-charts.tsx` re-exports these so nothing that
 * already imported them has to change.
 */

/** Below this, a figure should not be published on its own. */
export const MIN_REPORTABLE_BASE = 100;
/** Between the two, a figure is indicative only. */
export const INDICATIVE_BASE = 50;

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
