import { NextResponse } from "next/server";
import { handleWebhookEvent } from "@/lib/polling/calls";
import { verifyRetellSignature, type RetellWebhookEvent } from "@/lib/polling/retell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retell call events: call_started, call_ended, call_analyzed.
export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.text();
  if (!verifyRetellSignature(raw, req.headers.get("x-retell-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const { event, call } = JSON.parse(raw) as RetellWebhookEvent;
  if (!call?.call_id) {
    return NextResponse.json({ ok: true });
  }

  try {
    await handleWebhookEvent(event, call);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Retell webhook ${event} for ${call.call_id} failed:`, err);
    // Non-2xx makes Retell retry; ingestion is idempotent.
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
