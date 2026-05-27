import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

type AdsConfig = {
  enabled: boolean;
  webhookUrl: string;
};

async function loadConfig(): Promise<AdsConfig> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: "ads_cayworks" },
  });
  const value = (row?.value ?? {}) as Partial<AdsConfig>;
  return {
    enabled: Boolean(value.enabled),
    webhookUrl: String(value.webhookUrl ?? process.env.ADS_CAYWORKS_WEBHOOK_URL ?? ""),
  };
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier.toLowerCase().trim()).digest("hex");
}

export interface LeadTouchEvent {
  tenantId: string;
  channel: "email" | "sms" | "whatsapp";
  clientIdentifier: string; // email or phone — will be hashed
  eventType: "approval_sent" | "approval_drafted" | "client_replied";
}

export async function emitLeadTouch(event: LeadTouchEvent): Promise<void> {
  const config = await loadConfig();
  const payload = {
    tenant_id: event.tenantId,
    channel: event.channel,
    client_identifier_hash: hashIdentifier(event.clientIdentifier),
    event_type: event.eventType,
    timestamp: new Date().toISOString(),
  };

  const stored = await prisma.integrationEvent.create({
    data: {
      tenantId: event.tenantId,
      integration: "ads_cayworks",
      payload,
      status: "QUEUED",
    },
  });

  if (!config.enabled || !config.webhookUrl) {
    return;
  }

  try {
    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ADS_CAYWORKS_API_KEY
          ? { Authorization: `Bearer ${process.env.ADS_CAYWORKS_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Ads webhook returned ${res.status}`);
    }
    await prisma.integrationEvent.update({
      where: { id: stored.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (err) {
    await prisma.integrationEvent.update({
      where: { id: stored.id },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
