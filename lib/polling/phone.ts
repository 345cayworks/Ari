import { createHmac } from "node:crypto";

// Normalise to E.164. Bare 7-digit numbers are assumed to be Cayman (+1 345).
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 7) return `+1345${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

// Keyed hash so the do-not-call list and call records can't be reversed
// by hashing every possible Cayman number.
export function hashPhone(input: string): string {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) throw new Error("PHONE_HASH_SECRET is not set");
  return createHmac("sha256", secret).update(normalizePhone(input)).digest("hex");
}
