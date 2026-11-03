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
import { digestHex, fingerprint, open, seal } from "../lib/polling/secret-box";

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
  // The whole digest first, not the window the fingerprint shows.
  //
  // Every vector below asserts eight hex characters. A hash agreeing with
  // SHA-256 on those first four bytes and diverging afterwards satisfies all
  // of them — and `bytes()` and this digest call also feed the HKDF
  // derivation in `key()`, where four bytes of agreement are worth nothing.
  // Truncation, a re-encoding or a second round applied after byte four is
  // not an exotic mutation, and the eight-character window cannot see it.
  //
  // Only published digests can go here, which is the constraint that keeps the
  // window vectors below. "pad-7" has no published digest, and an expectation
  // computed with the function under test asserts nothing — so it stays eight
  // characters rather than becoming a snapshot of today's output.
  const published: [string, string][] = [
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ];
  for (const [input, expected] of published) {
    const got = await digestHex(input);
    check(`${JSON.stringify(input)} -> all 64 characters of the published digest`, got === expected, `got ${got}`);
  }

  const vectors: [string, string, string][] = [
    // Published values, not snapshots of today's output.
    ["abc", "ba7816bf", "FIPS vector ba7816bf8f01cfea…"],
    ["", "e3b0c442", "empty-string digest, where a pepper shows up most plainly"],
    // Digest opens 54 01 c5 00 — two bytes under 0x10 inside the eight-char
    // window, so dropping padStart(2, "0") yields 541c501c instead.
    //
    // Checked, not assumed: with the full digests asserted above, dropping
    // padStart fails "abc" as well, because its sixth byte is 0x01 — inside
    // the 64 characters even though it is outside the eight. So this is the
    // second witness to padding rather than the only one, and it is kept
    // because it is the one that survives at window level: if the published
    // digests above were ever dropped, padding coverage would not go with
    // them. An earlier version of this comment claimed "abc" could not catch
    // it, which was true of the slice and false of the digest.
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
