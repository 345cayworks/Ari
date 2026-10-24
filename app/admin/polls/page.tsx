import Link from "next/link";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { createPoll } from "./actions";
import { StatusBadge } from "./status-badge";

export const dynamic = "force-dynamic";

export default async function PollsPage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const [polls, outcomes] = await Promise.all([
    prisma.poll.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
    prisma.pollCall.groupBy({
      by: ["pollId", "outcome"],
      where: { tenantId },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, { dialled: number; completed: number }>();
  for (const row of outcomes) {
    const c = counts.get(row.pollId) ?? { dialled: 0, completed: 0 };
    c.dialled += row._count._all;
    if (row.outcome === "COMPLETED") c.completed += row._count._all;
    counts.set(row.pollId, c);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Polls</h1>
        <p className="mt-1 text-ink/60">
          Phone polls run by your Retell interviewer agent.
        </p>
      </div>

      <div className="card p-0 divide-y divide-ink/5">
        {polls.length === 0 ? (
          <p className="p-6 text-ink/60 text-sm">No polls yet. Create your first one below.</p>
        ) : (
          polls.map((p) => {
            const c = counts.get(p.id) ?? { dialled: 0, completed: 0 };
            return (
              <Link
                key={p.id}
                href={`/admin/polls/${p.id}`}
                className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-sand/60"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-ink/50">
                    Created {formatRelative(p.createdAt)}
                  </p>
                </div>
                <div className="flex gap-6 text-right text-sm shrink-0">
                  <div>
                    <p className="font-semibold">{c.completed.toLocaleString()}</p>
                    <p className="text-xs text-ink/50">completed</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="font-semibold">{c.dialled.toLocaleString()}</p>
                    <p className="text-xs text-ink/50">dialled</p>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      <form action={createPoll} className="card space-y-4 max-w-xl">
        <h2 className="text-lg font-semibold">New poll</h2>
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" className="input" required placeholder="Cost of Living Survey – Nov 2026" />
        </div>
        <div>
          <label className="label" htmlFor="topic">Topic (as the agent says it)</label>
          <input id="topic" name="topic" className="input" placeholder="the cost of living in Cayman" />
        </div>
        <button className="btn-primary" type="submit">Create and add questions</button>
      </form>
    </div>
  );
}
