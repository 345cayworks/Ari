import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { fingerprint, seal } from "@/lib/polling/secret-box";
import {
  DISPOSITION_UNASSIGNED,
  isLiveDisposition,
  LIVE_DISPOSITIONS,
} from "@/lib/polling/rdd";

export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const [tenant, feeds, rdd] = await Promise.all([
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
    prisma.rddSource.findUnique({
      where: { tenantId },
      // tokenSealed is deliberately not selected, for the same reason as
      // above: a field that is never fetched cannot be rendered into HTML by
      // a later edit.
      select: {
        id: true,
        label: true,
        baseUrl: true,
        tokenFingerprint: true,
        liveDisposition: true,
        revokedAt: true,
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

  /**
   * Store the sampling frame's base URL and bearer key.
   *
   * Same sealing as a campaign feed key, for the same reasons — see
   * lib/polling/secret-box.ts. The key is encrypted with a key derived from
   * PHONE_HASH_SECRET and held outside the database, and only its fingerprint
   * is ever shown again. RDD_BASE_URL and RDD_API_TOKEN remain a fallback for
   * a deployment that would rather keep them as Worker secrets, which is how
   * the Retell credentials are held.
   */
  async function saveRdd(formData: FormData): Promise<void> {
    "use server";
    const s = await auth();
    const tid = s?.user.tenantId;
    if (!tid) return;

    const label = String(formData.get("rddLabel") ?? "").trim();
    const baseUrl = String(formData.get("rddBaseUrl") ?? "").trim().replace(/\/+$/, "");
    const token = String(formData.get("rddToken") ?? "").trim();
    if (label === "" || baseUrl === "") return;

    // A blank key means "keep the one already stored", not "discard this
    // edit". The field is always rendered empty, because a stored key is
    // never shown again, so an operator fixing a label or a URL has nothing
    // to re-paste. Returning early on a blank key — as this did — dropped
    // their change with no error and no sign that anything had happened.
    const existing = await prisma.rddSource.findUnique({
      where: { tenantId: tid },
      select: { id: true },
    });
    if (token === "" && existing === null) return;

    // Constrained to the allowlist in lib/polling/rdd.ts, not stored as typed.
    // A free-text disposition is how the write-back contract would be widened
    // without anyone editing the file that states it, so a value outside the
    // list is dropped rather than saved.
    const typed = String(formData.get("rddLiveDisposition") ?? "").trim().toLowerCase();
    const liveDisposition = isLiveDisposition(typed) ? typed : LIVE_DISPOSITIONS[0];

    if (existing === null) {
      await prisma.rddSource.create({
        data: {
          tenantId: tid,
          label,
          baseUrl,
          tokenSealed: await seal(token),
          tokenFingerprint: await fingerprint(token),
          liveDisposition,
        },
      });
    } else {
      await prisma.rddSource.update({
        where: { tenantId: tid },
        data: {
          label,
          baseUrl,
          liveDisposition,
          // Only a new key rotates and un-revokes. A save that changes just
          // the name or the URL leaves a revoked frame revoked, which is what
          // revoking it meant.
          ...(token === ""
            ? {}
            : {
                tokenSealed: await seal(token),
                tokenFingerprint: await fingerprint(token),
                revokedAt: null,
              }),
        },
      });
    }
    revalidatePath("/admin/settings");
    revalidatePath("/admin/polls");
  }

  /** Switched off, not deleted, so it stays visible beside the batches it drew. */
  async function revokeRdd(): Promise<void> {
    "use server";
    const s = await auth();
    const tid = s?.user.tenantId;
    if (!tid) return;
    await prisma.rddSource.updateMany({
      where: { tenantId: tid },
      data: { revokedAt: new Date() },
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
          <h2 className="text-sm font-semibold">Random-digit-dial sampling frame</h2>
          <p className="mt-2 text-sm text-ink/60">
            The external service that holds the Cayman mobile sampling frame —
            470,000 numbers across 47 regulator-confirmed mobile blocks. A poll
            drawn from it has known selection probabilities, which is what a
            published margin of error depends on. Without it, polls can still
            be run against an uploaded list; the statistics computed over one
            simply do not mean what they appear to.
          </p>
          <p className="mt-2 text-sm text-ink/50">
            The key is sealed exactly as a campaign key is: encrypted with a key
            derived from <code>PHONE_HASH_SECRET</code> and held outside the
            database, never shown again after you save it. Alternatively set{" "}
            <code>RDD_BASE_URL</code> and <code>RDD_API_TOKEN</code> as Worker
            secrets, which is how the Retell credentials are held; a key saved
            here takes precedence over those.
          </p>
        </div>

        {rdd !== null && (
          <div className="border-t border-ink/10 pt-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{rdd.label}</span>
              <span className="text-ink/40">
                key <code>{rdd.tokenFingerprint}</code>…
              </span>
              <span className="text-ink/40">
                live numbers reported as <code>{rdd.liveDisposition}</code>
              </span>
              {rdd.revokedAt !== null && <span style={{ color: "#8f2020" }}>revoked</span>}
            </div>
            <p className="mt-1 break-all text-ink/50">{rdd.baseUrl}</p>
            {rdd.revokedAt === null && (
              <form action={revokeRdd} className="mt-2">
                <button type="submit" className="btn-secondary">
                  Revoke
                </button>
              </form>
            )}
          </div>
        )}

        <form action={saveRdd} className="space-y-4 border-t border-ink/10 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rddLabel">
                Frame name
              </label>
              <input
                id="rddLabel"
                name="rddLabel"
                className="input"
                defaultValue={rdd?.label ?? "Cayman mobile RDD"}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="rddLiveDisposition">
                Value reported for a number that exists
              </label>
              <select
                id="rddLiveDisposition"
                name="rddLiveDisposition"
                className="input"
                defaultValue={rdd?.liveDisposition ?? LIVE_DISPOSITIONS[0]}
              >
                {LIVE_DISPOSITIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {/* A list, not a text field, and the reason is the whole privacy
                  design rather than tidiness. Every option here asserts that
                  the number exists and nothing else; a free-text box is where
                  somebody eventually types "completed" and the frame starts
                  learning who answered. */}
              <p className="mt-2 text-xs text-ink/50">
                A number that turns out not to exist is reported as{" "}
                <code>{DISPOSITION_UNASSIGNED}</code>. Every number that does is
                reported with this one value, whatever happened on the call — a
                refusal and a completed interview are indistinguishable to the
                frame, deliberately. Pick whichever spelling the frame accepts.
              </p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="rddBaseUrl">
              Base URL
            </label>
            <input
              id="rddBaseUrl"
              name="rddBaseUrl"
              className="input font-mono text-xs"
              defaultValue={rdd?.baseUrl ?? "https://cayman-rdd.delicate-wood-499a.workers.dev"}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rddToken">
              Bearer key
            </label>
            {/* Required only when there is nothing stored to fall back on, so
                the markup says what the action does: blank keeps the key. */}
            <input
              id="rddToken"
              name="rddToken"
              type="password"
              autoComplete="off"
              className="input font-mono text-xs"
              required={rdd === null}
            />
            <p className="mt-2 text-xs text-ink/50">
              {rdd === null
                ? "Paste the key the frame issued."
                : "Leave blank to keep the key already stored. "}
              Saving a key over an existing frame replaces it and un-revokes it,
              which is how to rotate one.
            </p>
          </div>
          <button className="btn-primary" type="submit">
            Save sampling frame
          </button>
        </form>
      </div>

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
