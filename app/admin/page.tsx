import Link from "next/link";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminHome(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) {
    return <p className="text-ink/70">No tenant linked to this account.</p>;
  }

  const [messageCount, pendingCount, recent, costSum] = await Promise.all([
    prisma.message.count({ where: { tenantId } }),
    prisma.pendingApproval.count({ where: { tenantId, status: "PENDING" } }),
    prisma.message.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.apiUsage.aggregate({
      where: {
        tenantId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      _sum: { costUsd: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-ink/60">
          Welcome back, {session?.user.name ?? session?.user.email}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total messages" value={messageCount.toLocaleString()} />
        <Stat
          label="Pending approvals"
          value={pendingCount.toLocaleString()}
          href="/admin/approvals"
        />
        <Stat
          label="API cost (30d)"
          value={`$${(costSum._sum.costUsd ?? 0).toFixed(2)}`}
          href="/admin/usage"
        />
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent conversation</h2>
          <Link
            href="/admin/conversations"
            className="text-sm text-sea-deep hover:underline"
          >
            View all →
          </Link>
        </div>
        <div className="card divide-y divide-ink/5 p-0">
          {recent.length === 0 ? (
            <p className="p-6 text-ink/60 text-sm">
              No conversation yet. Send Ari a message from Telegram.
            </p>
          ) : (
            recent.map((m) => (
              <div key={m.id} className="px-6 py-4">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={
                      m.role === "user"
                        ? "font-semibold text-sea-deep"
                        : "font-semibold text-accent-deep"
                    }
                  >
                    {m.role === "user" ? "You" : "Ari"}
                  </span>
                  <span className="text-ink/40">
                    {formatRelative(m.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/80 whitespace-pre-wrap line-clamp-3">
                  {m.content}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}): JSX.Element {
  const inner = (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-ink/60">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
