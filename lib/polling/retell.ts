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
/**
 * The key Retell signs webhooks with, which is not necessarily the one used to
 * call the API.
 *
 * A Retell account can hold several API keys and only the one carrying the
 * "webhook badge" in the dashboard signs webhooks — the others remain
 * perfectly valid for API requests. That asymmetry produces a failure with no
 * obvious cause: outbound calls succeed, so the credential looks right, while
 * every inbound webhook is rejected as forged.
 *
 * So verification reads `RETELL_WEBHOOK_KEY` first and falls back to
 * `RETELL_API_KEY`. Leaving it unset preserves today's behaviour exactly.
 */
function webhookSigningKey(): string | undefined {
  return process.env.RETELL_WEBHOOK_KEY ?? process.env.RETELL_API_KEY;
}

/**
 * Why a signature was rejected, or null when it is good.
 *
 * Separated from the boolean because the three failures mean entirely
 * different things and the caller could not tell them apart. A malformed
 * header is a sender that is not Retell. A stale timestamp is a replay or a
 * clock. A digest mismatch is the right sender and the wrong key — and that
 * one is indistinguishable from an attack unless somebody says so out loud,
 * which is why webhook ingestion was failing unnoticed for weeks: a 401 was
 * returned, nothing was logged, and the only visible symptom was calls
 * quietly not appearing.
 */
export function retellSignatureProblem(
  rawBody: string,
  signature: string | null,
  apiKey = webhookSigningKey()
): string | null {
  if (!apiKey) return "no signing key is configured (RETELL_WEBHOOK_KEY or RETELL_API_KEY)";
  if (!signature) return "no x-retell-signature header";
  const match = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(signature);
  if (!match) return "the x-retell-signature header is not v=<ms>,d=<64 hex>";
  const timestamp = Number(match[1]);
  const skew = Date.now() - timestamp;
  if (Math.abs(skew) > SIGNATURE_MAX_AGE_MS) {
    return `the signature timestamp is ${Math.round(skew / 1000)}s away, outside the ${
      SIGNATURE_MAX_AGE_MS / 1000
    }s window`;
  }

  const expected = createHmac("sha256", apiKey)
    .update(rawBody + match[1])
    .digest();
  const given = Buffer.from(match[2], "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    // Names the likely cause rather than only the symptom. No key material:
    // the digest of a signature we rejected is not a secret, and the body it
    // was computed over is the sender's, not ours.
    return (
      "the digest does not match. The body and timestamp parsed, so this is " +
      "the right shape signed with a different key — in Retell only the API " +
      "key carrying the webhook badge signs webhooks, and the others still " +
      "work for API calls. Set RETELL_WEBHOOK_KEY to the badged one."
    );
  }
  return null;
}

export function verifyRetellSignature(
  rawBody: string,
  signature: string | null,
  apiKey = webhookSigningKey()
): boolean {
  return retellSignatureProblem(rawBody, signature, apiKey) === null;
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
