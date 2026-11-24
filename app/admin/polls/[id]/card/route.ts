import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fillsFor } from "@/components/poll-charts";
import { publicationBlockers } from "@/lib/polling/publication";
import { compareQuestionIds } from "@/lib/polling/results";
import { resultsCardSvg } from "@/lib/polling/results-card";
import { loadPollResults } from "@/lib/polling/weighted";

export const dynamic = "force-dynamic";

/**
 * One question's result as a shareable SVG card.
 *
 * Everything on it is taken from the same computation the Results tab renders
 * rather than worked out again here: `loadPollResults` for the tallies,
 * `publicationBlockers` for the gate, `weighting.marginOfError` for the single
 * margin the disclosure block quotes, and `fillsFor` for the colours. A card
 * that disagreed with the screen it was exported from would be two numbers for
 * one poll, both of them ours, and the operator would have no way to know
 * which had left the building.
 *
 * No respondent-level anything leaves in it: the card carries shares, a base,
 * a margin and the method. That is the same line `docs/rdd-sampling-frame.md`
 * draws for the frame write-back, for the same reason.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  const tenantId = session?.user.tenantId;
  if (!tenantId || (role !== Role.SUPER_ADMIN && role !== Role.ADMIN)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const poll = await prisma.poll.findFirst({ where: { id, tenantId } });
  if (!poll) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { weighting, tallies } = await loadPollResults(poll, {
    includePartial: false,
    weighted: true,
  });
  if (tallies.length === 0) {
    return NextResponse.json({ error: "this poll has no answers yet" }, { status: 409 });
  }

  // `?q=` picks the question; without it, the first in canonical order, which
  // is the one the Results tab shows first.
  const wanted = new URL(req.url).searchParams.get("q");
  const ordered = [...tallies].sort((a, b) => compareQuestionIds(a.questionId, b.questionId));
  const tally = (wanted && ordered.find((t) => t.questionId === wanted)) || ordered[0]!;

  const answered = weighting ? weighting.n : tallies[0]?.total ?? 0;
  const effectiveBase = weighting ? weighting.effectiveN : answered;
  const fills = fillsFor(tally.answers.map((a) => a.answer));

  // Weighted shares when the poll is weighted, raw counts when it is not —
  // the same switch the chart makes, so the bars agree.
  const denominator = weighting ? tally.totalWeight : tally.total;
  const answers = tally.answers.map((a) => ({
    answer: a.answer,
    share: denominator > 0 ? (weighting ? a.weight : a.count) / denominator : 0,
    fill: fills.get(a.answer) ?? "#b9b5ad",
  }));

  const started = await prisma.pollCall.findMany({
    where: { pollId: poll.id, startedAt: { not: null } },
    select: { startedAt: true },
    orderBy: { startedAt: "asc" },
  });
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Cayman" });
  const first = started[0]?.startedAt ?? null;
  const last = started[started.length - 1]?.startedAt ?? null;
  const fieldwork =
    first && last ? (fmt(first) === fmt(last) ? fmt(first) : `${fmt(first)} to ${fmt(last)}`) : "";

  const vars = (poll.variables ?? {}) as Record<string, string>;
  const svg = resultsCardSvg({
    pollName: vars.poll_name || poll.name,
    question: tally.text ?? tally.questionId,
    answers,
    base: tally.total,
    // The single figure the disclosure block quotes, null when unweighted —
    // matched rather than recomputed, so the two can never diverge. The chart
    // keeps showing its own per-answer margins via marginFor.
    marginPoints: weighting ? weighting.marginOfError : null,
    weighted: Boolean(weighting),
    fieldwork,
    companyName: vars.company_name ?? "",
    url: "https://polimeter.cayworks.net",
    blockers: publicationBlockers(answered, weighting),
  });

  const slug = `${poll.name.replace(/[^\w-]+/g, "_").slice(0, 40) || "poll"}-${tally.questionId}`;
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.svg"`,
      "cache-control": "no-store",
    },
  });
}
