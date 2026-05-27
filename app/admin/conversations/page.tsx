import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConversationsPage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const messages = await prisma.message.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <p className="mt-1 text-ink/60">
          Most recent {messages.length} messages between you and Ari.
        </p>
      </div>
      <div className="card p-0 divide-y divide-ink/5">
        {messages.length === 0 ? (
          <p className="p-6 text-ink/60 text-sm">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="px-6 py-4">
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    m.role === "user"
                      ? "font-semibold text-sea-deep"
                      : "font-semibold text-accent-deep"
                  }
                >
                  {m.role === "user" ? "You" : "Ari"} · {m.channel}
                </span>
                <span className="text-ink/40">
                  {formatRelative(m.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink/80 whitespace-pre-wrap">
                {m.content}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
