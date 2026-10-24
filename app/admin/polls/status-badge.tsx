import type { PollStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

const styles: Record<PollStatus, string> = {
  DRAFT: "bg-ink/5 text-ink/60",
  ACTIVE: "bg-sea-mist text-sea-deep",
  CLOSED: "bg-sand-warm text-accent-deep",
};

export function StatusBadge({ status }: { status: PollStatus }): JSX.Element {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider", styles[status])}>
      {status.toLowerCase()}
    </span>
  );
}
