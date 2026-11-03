import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { fingerprint, seal } from "@/lib/polling/secret-box";

export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const [tenant, feeds] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, systemPromptOverride: true },
    }),
    prisma.feedTarget.findMany({
      where: { tenantId },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
      // tokenSealed is deliberately not selected. The page has no reason to
      // hold the ciphertext, and a field that is never fetched cannot be
      // rendered into HTML by a later edit.
      select: {
        id: true,
        target: true,
        label: true,
        endpointUrl: true,
        tokenFingerprint: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  async function save(formData: FormData): Promise<void> {
    "use server";
    const s = await auth();
    if (!s?.user.tenantId) return;
    const override = String(formData.get("systemPromptOverride") ?? "").trim();
    await prisma.tenant.update({
      where: { id: s.user.tenantId },
      data: { systemPromptOverride: override.length > 0 ? override : null },
    });
    revalidatePath("/admin/settings");
  }

  /**
   * Store a campaign's feed token.
   *
   * Encrypted before it is written; the key is derived from
   * PHONE_HASH_SECRET and is not in the database, so a dump of FeedTarget
   * yields nothing usable. See lib/polling/secret-box.ts for why a token
   * that has to be *presented* cannot be hashed the way the receiving end
   * hashes its own copy.
   */
  async function saveFeed(formData: FormData): Promise<void> {
    "use server";
    const s = await auth();
    const tid = s?.user.tenantId;
    if (!tid) return;

    const target = String(formData.get("target") ?? "").trim() || "default";
    const label = String(formData.get("label") ?? "").trim();
    const endpointUrl = String(formData.get("endpointUrl") ?? "").trim();
    const token = String(formData.get("token") ?? "").trim();
    if (label === "" || endpointUrl === "" || token === "") return;

    const sealed = await seal(token);
    const fp = await fingerprint(token);
    await prisma.feedTarget.upsert({
      where: { tenantId_target: { tenantId: tid, target } },
      create: { tenantId: tid, target, label, endpointUrl, tokenSealed: sealed, tokenFingerprint: fp },
      // Replacing a token un-revokes the feed: pasting a new key is what an
      // operator does to rotate one, and leaving it revoked would silently
      // discard the thing they just did.
      update: { label, endpointUrl, tokenSealed: sealed, tokenFingerprint: fp, revokedAt: null },
    });
    revalidatePath("/admin/settings");
    revalidatePath("/admin/polls");
  }

  /** Switched off, not deleted, so it stays visible beside its deliveries. */
  async function revokeFeed(formData: FormData): Promise<void> {
    "use server";
    const s = await auth();
    const tid = s?.user.tenantId;
    if (!tid) return;
    const id = String(formData.get("id") ?? "");
    await prisma.feedTarget.updateMany({
      where: { id, tenantId: tid },
      data: { revokedAt: new Date() },
    });
    revalidatePath("/admin/settings");
    revalidatePath("/admin/polls");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-ink/60">Tenant: {tenant.name}</p>
      </div>

      <form action={save} className="card space-y-4">
        <div>
          <label className="label" htmlFor="systemPromptOverride">
            System prompt override
          </label>
          <textarea
            id="systemPromptOverride"
            name="systemPromptOverride"
            rows={12}
            className="input font-mono text-xs"
            placeholder="Leave blank to use the default Ari personality."
            defaultValue={tenant.systemPromptOverride ?? ""}
          />
          <p className="mt-2 text-xs text-ink/50">
            Custom instructions for Ari. Saved instantly; effective on her next message.
          </p>
        </div>
        <button className="btn-primary" type="submit">
          Save
        </button>
      </form>

      <div className="card space-y-5">
        <div>
          <h2 className="text-sm font-semibold">Campaign result feeds</h2>
          <p className="mt-2 text-sm text-ink/60">
            Where a poll&rsquo;s results are delivered. One feed per campaign:
            the key identifies the campaign at the other end, so a key issued
            for one cannot deliver into another.
          </p>
          <p className="mt-2 text-sm text-ink/50">
            The key is encrypted before it is stored, with a key derived from{" "}
            <code>PHONE_HASH_SECRET</code> and held outside the database. It is
            never shown again after you save it — only the first eight
            characters of its fingerprint, which is enough to check against the
            key the other end says it issued. Rotating{" "}
            <code>PHONE_HASH_SECRET</code> makes stored keys unreadable; paste
            them again if that ever happens.
          </p>
        </div>

        {feeds.length > 0 && (
          <ul className="space-y-3">
            {feeds.map((f) => (
              <li key={f.id} className="border-t border-ink/10 pt-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{f.label}</span>
                  <span className="text-ink/40">
                    target <code>{f.target}</code>
                  </span>
                  <span className="text-ink/40">
                    key <code>{f.tokenFingerprint}</code>…
                  </span>
                  {f.revokedAt !== null && (
                    <span style={{ color: "#8f2020" }}>revoked</span>
                  )}
                </div>
                <p className="mt-1 break-all text-ink/50">{f.endpointUrl}</p>
                {f.revokedAt === null && (
                  <form action={revokeFeed} className="mt-2">
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" className="btn-secondary">
                      Revoke
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        <form action={saveFeed} className="space-y-4 border-t border-ink/10 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="label">
                Campaign name
              </label>
              <input id="label" name="label" className="input" placeholder="STERLING" required />
            </div>
            <div>
              <label className="label" htmlFor="target">
                Feed key name
              </label>
              <input id="target" name="target" className="input" defaultValue="default" required />
              <p className="mt-2 text-xs text-ink/50">
                Scopes the delivery sequence. Leave as <code>default</code>
                {" "}unless this platform delivers to more than one campaign.
              </p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="endpointUrl">
              Endpoint
            </label>
            <input
              id="endpointUrl"
              name="endpointUrl"
              className="input font-mono text-xs"
              defaultValue="https://politracker.cayworks.net/v1/poll-results"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="token">
              Key
            </label>
            <input
              id="token"
              name="token"
              type="password"
              autoComplete="off"
              className="input font-mono text-xs"
              placeholder="ptk_…"
              required
            />
            <p className="mt-2 text-xs text-ink/50">
              Paste the key the campaign&rsquo;s platform issued. Saving over an
              existing feed replaces its key and un-revokes it, which is how to
              rotate one.
            </p>
          </div>
          <button className="btn-primary" type="submit">
            Save feed
          </button>
        </form>
      </div>
    </div>
  );
}
