// Reading "(Cost of living / Housing / Crime / Immigration)" in the same order
// on every call hands the first option a few points it has not earned. Primacy
// bias is one of the few measurement errors in telephone polling large enough
// to swamp a real movement, and it is invisible in the results: the number
// looks exactly like opinion. So each respondent hears their own order, and the
// order they heard is recorded on their call — rotating without recording would
// make the data less auditable, not more.
//
// Two treatments, because these are different kinds of list:
//   - An ordered scale (Very satisfied … Very dissatisfied) is never shuffled;
//     that would be nonsense to hear. It is reversed for a random half, which
//     is the standard remedy and cancels the same bias.
//   - An unordered list is permuted, except terminal options — Don't know,
//     Something else, Prefer not to say — which stay pinned at the end in their
//     original relative order. Rotating "Don't know" into the middle changes
//     what the question means.
//
// Only the survey block rotates. Screeners gate the interview and must read the
// same way every time; demographic lists are either ordinal (age bands) or read
// as a reference list rather than a choice (districts).

/** Answers meaning "no view". Excluded from a "those expressing a view" base. */
const NO_VIEW = [
  "don't know", "dont know", "do not know", "not sure", "unsure", "no opinion",
  "neither", "neither agree nor disagree", "refused", "prefer not to say", "no answer",
];

/** Options that must stay at the end of the list, whatever else moves. */
const ALSO_TERMINAL = [
  "something else", "other", "none of these", "none of the above", "all of these",
  "another way", "would not vote", "i could still change my mind",
];

const POSITIVE = [
  "very satisfied", "satisfied", "strongly agree", "agree", "right direction",
  "strongly approve", "approve", "support", "strongly support", "better", "improving",
  "very favourable", "somewhat favourable", "a great deal", "a fair amount",
  "a very serious problem", "a somewhat serious problem", "certain to vote", "very likely",
];
const NEGATIVE = [
  "very dissatisfied", "dissatisfied", "strongly disagree", "disagree", "wrong direction",
  "strongly disapprove", "disapprove", "oppose", "strongly oppose", "worse", "getting worse",
  "very unfavourable", "somewhat unfavourable", "not very much", "not at all",
  "not a very serious problem", "not a problem at all", "certain not to vote", "not very likely",
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, "");

export function isNoViewOption(option: string): boolean {
  return NO_VIEW.includes(norm(option));
}

export function isTerminalOption(option: string): boolean {
  const n = norm(option);
  return NO_VIEW.includes(n) || ALSO_TERMINAL.includes(n);
}

/** An ordered scale is reversed, never shuffled. */
export function isOrderedScale(options: string[]): boolean {
  const live = options.filter((o) => !isTerminalOption(o)).map(norm);
  if (live.length < 2 || live.length > 7) return false;
  return live.some((o) => POSITIVE.includes(o)) && live.some((o) => NEGATIVE.includes(o));
}

export interface ParsedQuestion {
  id: string;
  /** Everything before the option list, kept verbatim. */
  stem: string;
  options: string[];
  /** Anything after the option list on the same line. */
  tail: string;
}

// "Q1. How satisfied are you? (Very satisfied / Satisfied / Dissatisfied)" —
// the options are the last parenthesised group containing a slash, so a stem
// that itself contains brackets is safe.
export function parseQuestionLine(line: string): ParsedQuestion | null {
  const id = /^\s*([A-Za-z]+\d+)\s*[.):-]/.exec(line);
  if (!id) return null;

  let open = -1;
  let close = -1;
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] === ")") close = i;
    else if (line[i] === "(" && close > i) {
      const inner = line.slice(i + 1, close);
      if (inner.includes("/")) {
        open = i;
        break;
      }
      close = -1;
    }
  }
  if (open === -1) return null;

  const options = line
    .slice(open + 1, close)
    .split("/")
    .map((o) => o.trim())
    .filter(Boolean);
  if (options.length < 2) return null;

  return {
    id: id[1].toUpperCase(),
    stem: line.slice(0, open),
    options,
    tail: line.slice(close + 1),
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A plain yes/no pair is left alone: the question stem almost always names them
 * in order ("would you vote yes, or would you vote no?"), so reversing the list
 * puts the spoken question and the option list out of step.
 */
function isYesNo(options: string[]): boolean {
  const live = options.filter((o) => !isTerminalOption(o)).map(norm);
  return live.length === 2 && live.every((o) => o === "yes" || o === "no");
}

export function rotateOptions(options: string[], rng: () => number): string[] {
  if (isYesNo(options)) return options;
  if (isOrderedScale(options)) {
    // Reverse the scale for half of respondents, carrying the terminal options
    // along at the end rather than reversing them to the front.
    if (rng() < 0.5) return options;
    const live = options.filter((o) => !isTerminalOption(o));
    const terminal = options.filter((o) => isTerminalOption(o));
    return [...live.reverse(), ...terminal];
  }
  const live = options.filter((o) => !isTerminalOption(o));
  const terminal = options.filter((o) => isTerminalOption(o));
  return [...shuffle(live, rng), ...terminal];
}

export interface RotationResult {
  /** The survey block with each question's options reordered. */
  text: string;
  /** What this respondent actually heard, by question id. */
  order: Record<string, string[]>;
}

export function rotateSurveyQuestions(
  block: string,
  rng: () => number = Math.random
): RotationResult {
  const order: Record<string, string[]> = {};
  const text = block
    .split(/\r?\n/)
    .map((line) => {
      const parsed = parseQuestionLine(line);
      if (!parsed) return line;
      const rotated = rotateOptions(parsed.options, rng);
      // Only record where the order actually differs from the written one.
      if (rotated.join("|") !== parsed.options.join("|")) order[parsed.id] = rotated;
      return `${parsed.stem}(${rotated.join(" / ")})${parsed.tail}`;
    })
    .join("\n");
  return { text, order };
}
