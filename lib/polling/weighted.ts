import type { Poll, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseQuestionText, tallyResponses, type Tally } from "./results";
import { rake, readWeightingConfig, type WeightingConfig, type WeightingResult } from "./weighting";

export interface PollResults {
  config: WeightingConfig;
  weighting: WeightingResult | null; // null when weighting is off or has no targets
  tallies: Tally[];
}

// Completed interviews by default; with includePartial, every call that has
// ended (in-progress calls wait for their analysis).
export function respondentFilter(pollId: string, includePartial: boolean): Prisma.PollCallWhereInput {
  return {
    pollId,
    outcome: includePartial ? { not: "IN_PROGRESS" } : { equals: "COMPLETED" },
  };
}

export async function loadPollResults(
  poll: Poll,
  opts: { includePartial: boolean; weighted: boolean }
): Promise<PollResults> {
  const config = readWeightingConfig(poll.weighting);
  const where = respondentFilter(poll.id, opts.includePartial);
  const [calls, responses] = await Promise.all([
    prisma.pollCall.findMany({ where, select: { id: true } }),
    prisma.pollResponse.findMany({
      where: { pollCall: where },
      select: { pollCallId: true, questionId: true, answer: true },
    }),
  ]);

  let weighting: WeightingResult | null = null;
  const usable = { ...config, targets: config.targets.filter((t) => t.categories.length >= 2) };
  if (opts.weighted && config.enabled && usable.targets.length > 0) {
    const answers = new Map(calls.map((c) => [c.id, new Map<string, string>()]));
    for (const r of responses) answers.get(r.pollCallId)?.set(r.questionId, r.answer);
    weighting = rake(
      calls.map((c) => ({ id: c.id, answers: answers.get(c.id)! })),
      usable
    );
  }

  const texts = parseQuestionText((poll.variables ?? {}) as Record<string, unknown>);
  return {
    config,
    weighting,
    tallies: tallyResponses(responses, texts, weighting?.weights),
  };
}
