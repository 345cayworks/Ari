import { cn } from "@/lib/utils";

export function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 text-sm",
        tone === "ok" ? "bg-sea-mist text-sea-deep" : "bg-accent/15 text-accent-deep"
      )}
    >
      {children}
    </div>
  );
}
