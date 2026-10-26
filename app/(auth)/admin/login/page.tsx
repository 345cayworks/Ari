import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<JSX.Element> {
  const { error } = await searchParams;
  const session = await auth();
  if (session?.user) redirect("/admin");

  return (
    <main className="min-h-screen grid place-items-center bg-sand">
      <div className="w-full max-w-md card">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink/60">
          Use your SuperAdmin email and master key.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Sign-in failed. Check email and master key.
          </div>
        ) : null}

        <form
          action={async (formData: FormData) => {
            "use server";
            // signIn throws on a bad credential instead of redirecting, and an
            // uncaught AuthError in a server action renders Next's generic
            // "server-side exception" page — so a mistyped key looked like a
            // broken deployment. Send it to the error banner above instead.
            // A successful sign-in throws NEXT_REDIRECT, which is not an
            // AuthError, so it still falls through and redirects.
            try {
              await signIn("credentials", {
                email: formData.get("email"),
                masterKey: formData.get("masterKey"),
                redirectTo: "/admin",
              });
            } catch (err) {
              // Only a rejected credential becomes the banner. Anything else —
              // including an error thrown inside authorize(), which Auth.js
              // wraps as CallbackRouteError — is a real fault and must not be
              // disguised as a mistyped key.
              if (err instanceof AuthError && err.type === "CredentialsSignin") {
                redirect("/admin/login?error=CredentialsSignin");
              }
              throw err;
            }
          }}
          className="mt-6 space-y-4"
        >
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              placeholder="you@cayworks.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="masterKey">
              Master key
            </label>
            <input
              id="masterKey"
              name="masterKey"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••••••"
            />
          </div>
          <button type="submit" className="btn-primary w-full">
            Sign in
          </button>
        </form>

        <p className="mt-6 text-xs text-ink/50 leading-relaxed">
          The master key is set in <code>SUPERADMIN_MASTER_KEY</code>. Magic-link
          login coming in Phase 1.
        </p>
      </div>
    </main>
  );
}
