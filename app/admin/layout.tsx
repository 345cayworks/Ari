import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { Role } from "@prisma/client";
import { AdminNav } from "@/components/admin/nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const session = await auth();
  if (!session?.user) {
    redirect("/admin/login");
  }
  if (
    session.user.role !== Role.SUPER_ADMIN &&
    session.user.role !== Role.ADMIN
  ) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-sand">
      <header className="border-b border-ink/5 bg-white">
        <div className="container-tight flex items-center justify-between py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-ink text-sand grid place-items-center text-sm font-bold">
              A
            </div>
            <span className="font-semibold tracking-tight">Ari · Admin</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-ink/60 hidden sm:inline">
              {session.user.email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="text-ink/70 hover:text-ink" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <AdminNav role={session.user.role} />
      </header>
      <main className="container-tight py-8">{children}</main>
    </div>
  );
}
