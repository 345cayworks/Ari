import { createHmac } from "node:crypto";

// Strict E.164 for the numbers this platform actually dials: Cayman and the
// wider NANP. Returns null for anything else, because the lenient fallback
// below turns a typo into a real foreign number — an 11-digit "3345324 9000"
// became +33453249000, France, and was dialled. Area and exchange codes both
// start 2-9 in the NANP, which is what catches a stray leading digit.
export function tryNormalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // Local Cayman number.
  //
  // **Drop the exchange test and `0123456` is dialled as +1 345 012 3456.**
  // The 10- and 11-digit branches below have always applied `[2-9]` to the
  // exchange; this branch did not, so a seven-digit number with a leading 0
  // or 1 in the exchange reached Retell. One typo is rare, but a list from a
  // random-digit generator produces the whole class, which is what surfaced
  // this — see `numbers.ts`.
  if (digits.length === 7) return /^[2-9]\d{6}$/.test(digits) ? `+1345${digits}` : null;
  // NANP without the country code.
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  // NANP with it.
  if (digits.length === 11 && /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`;
  return null;
}

// Lenient normalise, for recording and hashing numbers that arrive from
// elsewhere (a Retell webhook, an existing do-not-call row). Never throws, so
// ingestion can't be broken by an odd number: only dialling is gated, by
// tryNormalizePhone at the two places calls are placed.
export function normalizePhone(input: string): string {
  return tryNormalizePhone(input) ?? `+${input.replace(/\D/g, "")}`;
}

// Keyed hash so the do-not-call list and call records can't be reversed
// by hashing every possible Cayman number.
export function hashPhone(input: string): string {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) throw new Error("PHONE_HASH_SECRET is not set");
  return createHmac("sha256", secret).update(normalizePhone(input)).digest("hex");
}
