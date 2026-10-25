import type { PollCall, PollCallOutcome, PollResponse } from "@prisma/client";

// "Call now" places calls one by one inside a server action; it's meant for
// test calls, and anything bigger should go through Retell batch calling.
export const MAX_CALLS_PER_SUBMIT = 20;
// Numbers per batch submission. Each 1,000 becomes one Retell batch request,
// sent in parallel, which keeps the server action well inside its time limit.
export const MAX_BATCH_NUMBERS = 5000;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Dynamic variables an admin edits per poll, in the order the prompt uses them.
export const POLL_VARIABLES = [
  { key: "poll_name", label: "Poll name (read to respondents)", rows: 1 },
  { key: "poll_topic", label: "Topic, e.g. \"the cost of living\"", rows: 1 },
  { key: "estimated_minutes", label: "Estimated minutes", rows: 1 },
  { key: "agent_name", label: "Agent name", rows: 1 },
  { key: "sponsor_disclosure", label: "Sponsor disclosure (blank = independent)", rows: 2 },
  { key: "incentive_text", label: "Incentive (usually blank)", rows: 1 },
  { key: "screening_questions", label: "Screening questions (S1, S2, ...)", rows: 4 },
  { key: "survey_questions", label: "Survey questions (Q1, Q2, ...)", rows: 12 },
  { key: "demographic_questions", label: "Demographic questions (D1, D2, ...)", rows: 6 },
] as const;

const PREFIX_ORDER = ["S", "Q", "D"];

function questionSortKey(id: string): [number, number, string] {
  const m = /^([A-Z]+)(\d+)/.exec(id);
  if (!m) return [PREFIX_ORDER.length, 0, id];
  const prefix = PREFIX_ORDER.indexOf(m[1]);
  return [prefix === -1 ? PREFIX_ORDER.length : prefix, Number(m[2]), id];
}

export function compareQuestionIds(a: string, b: string): number {
  const [pa, na, ia] = questionSortKey(a);
  const [pb, nb, ib] = questionSortKey(b);
  return pa - pb || na - nb || ia.localeCompare(ib);
}

// Pull "Q1. How satisfied are you..." lines out of the question variables
// so results can show the wording next to each ID.
export function parseQuestionText(variables: Record<string, unknown>): Map<string, string> {
  const texts = new Map<string, string>();
  for (const key of ["screening_questions", "survey_questions", "demographic_questions"]) {
    const block = String(variables[key] ?? "");
    for (const line of block.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z]+\d+)\s*[.):-]\s*(.+)$/.exec(line);
      if (m && !texts.has(m[1].toUpperCase())) texts.set(m[1].toUpperCase(), m[2].trim());
    }
  }
  return texts;
}

// Options listed in the last bracket of a question, e.g. "(Yes / No)".
function parseOptions(text?: string): string[] {
  const m = text ? /\(([^()]*\/[^()]*)\)\s*$/.exec(text) : null;
  if (!m) return [];
  return m[1].split("/").map((o) => o.split(/\s[–-]\s/)[0].trim().toLowerCase()).filter(Boolean);
}

export interface Tally {
  questionId: string;
  text?: string;
  total: number; // respondents (unweighted)
  totalWeight: number; // equals total when unweighted
  answers: { answer: string; count: number; weight: number }[];
}

// Count answers per question. Answers are grouped case-insensitively and
// shown with their most common spelling, in the question's option order
// when it lists one, otherwise by count. With `weights` (by pollCallId),
// each answer also carries its weighted total.
export function tallyResponses(
  responses: Pick<PollResponse, "pollCallId" | "questionId" | "answer">[],
  texts: Map<string, string>,
  weights?: Map<string, number>
): Tally[] {
  const byQuestion = new Map<
    string,
    Map<string, { count: number; weight: number; spellings: Map<string, number> }>
  >();
  for (const r of responses) {
    const answers = byQuestion.get(r.questionId) ?? new Map();
    byQuestion.set(r.questionId, answers);
    const key = r.answer.trim().toLowerCase();
    const entry = answers.get(key) ?? { count: 0, weight: 0, spellings: new Map<string, number>() };
    entry.count += 1;
    entry.weight += weights ? weights.get(r.pollCallId) ?? 0 : 1;
    entry.spellings.set(r.answer.trim(), (entry.spellings.get(r.answer.trim()) ?? 0) + 1);
    answers.set(key, entry);
  }

  return [...byQuestion.entries()]
    .sort(([a], [b]) => compareQuestionIds(a, b))
    .map(([questionId, answers]) => {
      const options = parseOptions(texts.get(questionId));
      const rank = (key: string) => {
        const i = options.indexOf(key);
        return i === -1 ? options.length : i;
      };
      const list = [...answers.entries()]
        .map(([key, e]) => ({
          key,
          answer: [...e.spellings.entries()].sort((x, y) => y[1] - x[1])[0][0],
          count: e.count,
          weight: e.weight,
        }))
        .sort((a, b) => rank(a.key) - rank(b.key) || b.weight - a.weight)
        .map(({ answer, count, weight }) => ({ answer, count, weight }));
      return {
        questionId,
        text: texts.get(questionId),
        total: list.reduce((n, a) => n + a.count, 0),
        totalWeight: list.reduce((n, a) => n + a.weight, 0),
        answers: list,
      };
    });
}

export interface PollStats {
  dialled: number;
  reached: number;
  completed: number;
  partial: number;
  refused: number;
  screenedOut: number;
  doNotCall: number;
  callbacks: number;
  noAnswer: number;
  inProgress: number;
  avgCompletedSeconds: number | null;
  deviations: number;
  poorUnderstanding: number;
}

export function computeStats(
  calls: Pick<PollCall, "outcome" | "durationMs" | "analysis">[]
): PollStats {
  const count = (...o: PollCallOutcome[]) => calls.filter((c) => o.includes(c.outcome)).length;
  const completed = calls.filter((c) => c.outcome === "COMPLETED");
  const durations = completed.map((c) => c.durationMs).filter((d): d is number => d != null);
  const analysis = (c: { analysis: unknown }) => (c.analysis ?? {}) as Record<string, unknown>;

  return {
    dialled: calls.length,
    reached: calls.length - count("NO_ANSWER", "VOICEMAIL", "IN_PROGRESS", "NO_CONVERSATION"),
    completed: completed.length,
    partial: count("PARTIAL"),
    refused: count("REFUSED", "HOSTILE"),
    screenedOut: count("SCREENED_OUT"),
    doNotCall: count("DO_NOT_CALL"),
    callbacks: count("CALLBACK_REQUESTED"),
    noAnswer: count("NO_ANSWER", "VOICEMAIL", "NO_CONVERSATION"),
    inProgress: count("IN_PROGRESS"),
    avgCompletedSeconds: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
      : null,
    deviations: calls.filter((c) => analysis(c).interviewer_deviation === true).length,
    poorUnderstanding: calls.filter((c) => analysis(c).respondent_understanding === "poor").length,
  };
}

export function formatOutcome(outcome: PollCallOutcome): string {
  return outcome.toLowerCase().replace(/_/g, " ");
}

export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
