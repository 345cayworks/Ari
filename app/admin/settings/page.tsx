import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<JSX.Element> {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId) return <p>No tenant.</p>;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, systemPromptOverride: true },
  });

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
    </div>
  );
}
