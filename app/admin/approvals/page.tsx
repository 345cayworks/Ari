import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const pending = await prisma.pendingApproval.findMany({
    where: { tenantId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pending approvals</h1>
        <p className="mt-1 text-ink/60">
          Outbound client messages drafted by Ari, waiting for your approval.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-ink/60">Nothing waiting.</p>
          <p className="text-xs text-ink/40 mt-1">
            Approvals will appear here in Phase 2 once Gmail / SMS / WhatsApp tools are wired up.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((a) => (
            <div key={a.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-sea-deep">
                  {a.kind}
                </span>
                <span className="text-xs text-ink/40">
                  {formatRelative(a.createdAt)}
                </span>
              </div>
              <pre className="text-xs bg-sand-warm p-3 rounded-lg overflow-auto">
                {JSON.stringify(a.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
