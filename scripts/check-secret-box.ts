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

  console.log("");
  console.log("Fingerprint: known answers, not properties");
  // Everything above pins PROPERTIES — eight hex characters, stable, distinct,
  // independent of PHONE_HASH_SECRET — and not one pins the VALUE. SHA-1, a
  // different slice, or a pepper added to the digest would pass all five.
  //
  // That matters more here than it would almost anywhere else. This
  // fingerprint exists to be read aloud and compared against the issuing
  // platform's own display before a first delivery. If the two formulas ever
  // diverge, both suites stay green, both sides show eight plausible hex
  // characters, and the operator concludes they hold the wrong key — the exact
  // failure the comparison exists to catch, inverted.
  //
  // The other platform found this same hole in its own suite by adding a
  // pepper to every digest in the product: seven tests failed, 788 passed.
  // Every expectation had been computed WITH the function under test.
  const vectors: [string, string, string][] = [
    // Published values, not snapshots of today's output.
    ["abc", "ba7816bf", "FIPS vector ba7816bf8f01cfea…"],
    ["", "e3b0c442", "empty-string digest, where a pepper shows up most plainly"],
    // Digest opens 54 01 c5 00 — two bytes under 0x10 inside the eight-char
    // window, so dropping padStart(2, "0") yields 541c501c instead. "abc"
    // cannot catch that: its low byte is the sixth, outside the slice.
    ["pad-7", "5401c500", "per-byte zero padding"],
  ];
  for (const [input, expected, why] of vectors) {
    const got = await fingerprint(input);
    check(`${JSON.stringify(input)} -> ${expected}  (${why})`, got === expected, `got ${got}`);
  }

  // UTF-8 versus UTF-16, with the expectation built from the explicit bytes
  // rather than from the encoder under test — otherwise this asserts only that
  // the function agrees with itself, which is the mistake being corrected.
  const utf8 = new Uint8Array([0xc3, 0xa9]); // "é"
  const fromExplicitBytes = [...new Uint8Array(await crypto.subtle.digest("SHA-256", utf8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  check(
    `"é" hashes its UTF-8 bytes C3 A9, not UTF-16  (${fromExplicitBytes})`,
    (await fingerprint("é")) === fromExplicitBytes,
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
