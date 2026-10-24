"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Role } from "@prisma/client";
import { cn } from "@/lib/utils";

const baseLinks = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/conversations", label: "Conversations" },
  { href: "/admin/polls", label: "Polls" },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/usage", label: "Usage" },
];

export function AdminNav({ role }: { role: Role }): JSX.Element {
  const pathname = usePathname();
  const links = [...baseLinks];
  if (role === Role.SUPER_ADMIN) {
    links.push({ href: "/admin/superadmin", label: "SuperAdmin" });
  }

  return (
    <nav className="container-tight flex gap-1 overflow-x-auto pb-2">
      {links.map((l) => {
        const active =
          pathname === l.href ||
          (l.href !== "/admin" && pathname.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition",
              active
                ? "bg-ink text-sand"
                : "text-ink/70 hover:bg-ink/5 hover:text-ink"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
