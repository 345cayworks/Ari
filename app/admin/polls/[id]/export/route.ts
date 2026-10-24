import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { compareQuestionIds } from "@/lib/polling/results";
import { loadPollResults } from "@/lib/polling/weighted";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote everything that needs it, and defuse spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// One row per call, one column per question. No phone numbers.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth();
  const role = session?.user.role;
  const tenantId = session?.user.tenantId;
  if (!tenantId || (role !== Role.SUPER_ADMIN && role !== Role.ADMIN)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const poll = await prisma.poll.findFirst({ where: { id: params.id, tenantId } });
  if (!poll) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Weights cover completed interviews, the base the Results tab uses.
  const { weighting } = await loadPollResults(poll, { includePartial: false, weighted: true });

  const calls = await prisma.pollCall.findMany({
    where: { pollId: poll.id },
    orderBy: { createdAt: "asc" },
    include: { responses: true },
  });

  const questionIds = [
    ...new Set(calls.flatMap((c) => c.responses.map((r) => r.questionId))),
  ].sort(compareQuestionIds);
  const analysisKeys = ["respondent_understanding", "interviewer_deviation"];

  const header = [
    "call_id",
    "started_at",
    "outcome",
    "completed",
    "consent_given",
    "duration_seconds",
    "last_question_reached",
    ...(weighting ? ["weight"] : []),
    ...analysisKeys,
    ...questionIds,
  ];
  const rows = calls.map((c) => {
    const answers = new Map(c.responses.map((r) => [r.questionId, r.answer]));
    const analysis = (c.analysis ?? {}) as Record<string, unknown>;
    return [
      c.retellCallId,
      (c.startedAt ?? c.createdAt).toISOString(),
      c.outcome,
      c.completed,
      c.consentGiven,
      c.durationMs != null ? Math.round(c.durationMs / 1000) : null,
      c.lastQuestionReached,
      ...(weighting ? [weighting.weights.get(c.id)?.toFixed(4) ?? ""] : []),
      ...analysisKeys.map((k) => analysis[k]),
      ...questionIds.map((q) => answers.get(q)),
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const filename = `${poll.name.replace(/[^\w-]+/g, "_").slice(0, 60) || "poll"}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
