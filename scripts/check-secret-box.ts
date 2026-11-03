/**
 * Checks the feed-token encryption.
 *
 * Run with:  npm run check:secret-box
 *
 * Worth its own script because the failure is silent and expensive: a token
 * that seals but will not open leaves a feed that looks configured and is
 * not, and the symptom appears at delivery time rather than at save time.
 *
 * Every assertion is paired with the thing that would make it pass by
 * accident. "It opens" is worthless without "it does not open under a
 * different key", and "the ciphertext differs each time" is worthless without
 * "both still open".
 */
import { fingerprint, open, seal } from "../lib/polling/secret-box";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  process.env.PHONE_HASH_SECRET = "a".repeat(64);
  const token = "ptk_live_0123456789abcdefghijklmnopqrstuvwxyz";

  console.log("Sealing and opening");
  const sealed = await seal(token);
  check("the token is not in the ciphertext", !sealed.includes(token), sealed.slice(0, 40));
  check("the scheme is tagged", sealed.startsWith("v1."));
  check("it opens to the original", (await open(sealed)) === token);

  // Without this, a seal() that returned a constant would pass everything above.
  const again = await seal(token);
  check("sealing twice gives different ciphertext", sealed !== again);
  check("and both still open", (await open(again)) === token);

  console.log("");
  console.log("Refusing what it should refuse");
  process.env.PHONE_HASH_SECRET = "b".repeat(64);
  check("a different PHONE_HASH_SECRET does not open it", (await open(sealed)) === null);
  process.env.PHONE_HASH_SECRET = "a".repeat(64);
  check("and the right one still does", (await open(sealed)) === token);

  const parts = sealed.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`;
  check("tampered ciphertext does not open", (await open(tampered)) === null);
  check("a wrong scheme does not open", (await open(`v2.${parts[1]}.${parts[2]}`)) === null);
  check("rubbish does not open", (await open("not-a-sealed-value")) === null);
  check("an empty string does not open", (await open("")) === null);

  console.log("");
  console.log("Fingerprint");
  const fp = await fingerprint(token);
  check("is eight hex characters", /^[0-9a-f]{8}$/.test(fp), fp);
  check("is stable", fp === (await fingerprint(token)));
  check("differs for a different token", fp !== (await fingerprint(token + "x")));
  check("does not contain the token", !token.includes(fp));
  // The fingerprint must not depend on the secret: an operator compares it
  // against what the far end reports, and the far end has no access to ours.
  process.env.PHONE_HASH_SECRET = "c".repeat(64);
  check("does not depend on PHONE_HASH_SECRET", fp === (await fingerprint(token)));

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
