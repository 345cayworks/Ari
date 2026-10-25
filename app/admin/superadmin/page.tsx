import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

type AdsCfg = { enabled?: boolean; webhookUrl?: string };
type FeatureFlags = Record<string, boolean>;

export default async function SuperAdminPage(): Promise<JSX.Element> {
  const session = await auth();
  if (!session?.user || session.user.role !== Role.SUPER_ADMIN) {
    redirect("/admin");
  }

  const [adsRow, flagsRow] = await Promise.all([
    prisma.platformSetting.findUnique({ where: { key: "ads_cayworks" } }),
    prisma.platformSetting.findUnique({ where: { key: "feature_flags" } }),
  ]);

  const ads = (adsRow?.value ?? {}) as AdsCfg;
  const flags = (flagsRow?.value ?? {}) as FeatureFlags;

  async function saveAds(formData: FormData): Promise<void> {
    "use server";
    const s = await auth();
    if (s?.user.role !== Role.SUPER_ADMIN) return;
    const enabled = formData.get("enabled") === "on";
    const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
    await prisma.platformSetting.upsert({
      where: { key: "ads_cayworks" },
      update: { value: { enabled, webhookUrl } },
      create: { key: "ads_cayworks", value: { enabled, webhookUrl } },
    });
    revalidatePath("/admin/superadmin");
  }

  async function saveFlags(formData: FormData): Promise<void> {
    "use server";
    const s = await auth();
    if (s?.user.role !== Role.SUPER_ADMIN) return;
    const next: FeatureFlags = {
      gmail: formData.get("gmail") === "on",
      calendar: formData.get("calendar") === "on",
      sms: formData.get("sms") === "on",
      whatsapp: formData.get("whatsapp") === "on",
      stripe: formData.get("stripe") === "on",
    };
    await prisma.platformSetting.upsert({
      where: { key: "feature_flags" },
      update: { value: next },
      create: { key: "feature_flags", value: next },
    });
    revalidatePath("/admin/superadmin");
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SuperAdmin</h1>
        <p className="mt-1 text-ink/60">
          Platform-level controls. Visible only to SuperAdmin.
        </p>
      </div>

      <form action={saveAds} className="card space-y-4">
        <h2 className="text-lg font-semibold">ads.cayworks.com integration</h2>
        <p className="text-sm text-ink/60">
          Posts hashed lead-touch events to your ads engine whenever Ari sends
          an approved client message. No PII leaves the system.
        </p>
        <div>
          <label className="label" htmlFor="webhookUrl">Webhook URL</label>
          <input
            id="webhookUrl"
            name="webhookUrl"
            type="url"
            className="input"
            defaultValue={ads.webhookUrl ?? "https://ads.cayworks.com/api/events"}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={Boolean(ads.enabled)}
            className="h-4 w-4 rounded border-ink/20"
          />
          Enabled
        </label>
        <button className="btn-primary" type="submit">Save</button>
      </form>

      <form action={saveFlags} className="card space-y-4">
        <h2 className="text-lg font-semibold">Feature flags</h2>
        <p className="text-sm text-ink/60">
          Toggle Ari's capabilities as we ship subsequent phases.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["gmail", "Gmail (Phase 2)"],
              ["calendar", "Calendar (Phase 3)"],
              ["sms", "SMS (Phase 4)"],
              ["whatsapp", "WhatsApp (Phase 5)"],
              ["stripe", "Stripe billing (Phase 8)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={key}
                defaultChecked={Boolean(flags[key])}
                className="h-4 w-4 rounded border-ink/20"
              />
              {label}
            </label>
          ))}
        </div>
        <button className="btn-primary" type="submit">Save</button>
      </form>

      <div className="card">
        <h2 className="text-lg font-semibold">Environment</h2>
        <dl className="mt-3 text-sm divide-y divide-ink/5">
          {(
            [
              ["Model (smart)", process.env.ARI_MODEL ?? "claude-sonnet-5-5"],
              ["Model (fast)", process.env.ARI_FAST_MODEL ?? "claude-haiku-5-5"],
              ["Telegram bot", process.env.TELEGRAM_BOT_TOKEN ? "configured" : "missing"],
              ["Groq STT", process.env.GROQ_API_KEY ? "configured" : "missing"],
              ["GA4", process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ? "active" : "off"],
              ["Meta Pixel", process.env.NEXT_PUBLIC_META_PIXEL_ID ? "active" : "off"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between py-2">
              <dt className="text-ink/60">{k}</dt>
              <dd className="font-mono text-xs">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
