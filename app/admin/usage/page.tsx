import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UsagePage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.apiUsage.findMany({
    where: { tenantId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const totals = await prisma.apiUsage.aggregate({
    where: { tenantId, createdAt: { gte: since } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      costUsd: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="mt-1 text-ink/60">Last 30 days.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Input tokens" value={(totals._sum.inputTokens ?? 0).toLocaleString()} />
        <Stat label="Output tokens" value={(totals._sum.outputTokens ?? 0).toLocaleString()} />
        <Stat label="Cache read" value={(totals._sum.cacheReadTokens ?? 0).toLocaleString()} />
        <Stat label="Cost" value={`$${(totals._sum.costUsd ?? 0).toFixed(2)}`} />
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-sand-warm text-xs uppercase tracking-wider text-ink/60">
            <tr>
              <th className="px-4 py-3 text-left">When</th>
              <th className="px-4 py-3 text-left">Model</th>
              <th className="px-4 py-3 text-right">In</th>
              <th className="px-4 py-3 text-right">Out</th>
              <th className="px-4 py-3 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/60">
                  No usage yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-ink/70">
                    {r.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-ink/70 font-mono text-xs">
                    {r.model}
                  </td>
                  <td className="px-4 py-2 text-right">{r.inputTokens}</td>
                  <td className="px-4 py-2 text-right">{r.outputTokens}</td>
                  <td className="px-4 py-2 text-right">${r.costUsd.toFixed(4)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-ink/60">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
