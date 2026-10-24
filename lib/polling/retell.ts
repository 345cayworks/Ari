import { createHmac, timingSafeEqual } from "node:crypto";

const RETELL_API = process.env.RETELL_BASE_URL ?? "https://api.retellai.com";
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

// Subset of Retell's call object that we use.
export interface RetellCall {
  call_id: string;
  agent_id: string;
  call_status: string;
  call_type?: string;
  direction?: "inbound" | "outbound";
  from_number?: string;
  to_number?: string;
  metadata?: Record<string, unknown> | null;
  retell_llm_dynamic_variables?: Record<string, string>;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  call_analysis?: {
    call_summary?: string;
    call_successful?: boolean;
    user_sentiment?: string;
    in_voicemail?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
}

export interface RetellWebhookEvent {
  event: string;
  call: RetellCall;
}

export interface RetellFunctionRequest {
  name: string;
  call: RetellCall;
  args: Record<string, unknown>;
}

// Same scheme as retell-sdk's `verify`: header is "v=<ms>,d=<hex>", where
// hex = HMAC-SHA256(apiKey, rawBody + ms). Rejects stale timestamps.
export function verifyRetellSignature(
  rawBody: string,
  signature: string | null,
  apiKey = process.env.RETELL_API_KEY
): boolean {
  if (!apiKey || !signature) return false;
  const match = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(signature);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) return false;

  const expected = createHmac("sha256", apiKey)
    .update(rawBody + match[1])
    .digest();
  const given = Buffer.from(match[2], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function retellApi<T = any>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("RETELL_API_KEY is not set");
  const res = await fetch(`${RETELL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Retell ${method} ${path} returned ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// The respondent's number: who we dialled, or who dialled us.
export function respondentNumber(call: RetellCall): string {
  return (call.direction === "inbound" ? call.from_number : call.to_number) ?? "";
}
