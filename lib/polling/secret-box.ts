/**
 * Encrypting a third-party credential that has to be stored recoverably.
 *
 * `docs/poll-results-api.md` settled that the feed token lives in an
 * environment variable and not in a record, because a credential in a row is
 * one that eventually turns up in a dump, a log line or an export. That is
 * still the safest place for it. But an environment variable holds one value,
 * and a platform delivering to more than one campaign needs one token per
 * campaign — so the token has to become a row, and the reasoning against that
 * has to be answered rather than dropped.
 *
 * This answers it: what is stored is ciphertext, and the key is not in the
 * database. A dump of `FeedTarget` yields nothing usable on its own.
 *
 * The difference from how Politracker stores *its* copy is worth being clear
 * about, because the asymmetry looks like an inconsistency. They store
 * `token_sha256` and never the token, which is strictly better — but they only
 * ever need to *verify* a token somebody presents. This side has to *present*
 * it, so it must be recoverable, and a hash is not an option. Encryption is
 * the best available rather than the best imaginable.
 *
 * Pure: `crypto.subtle` is present on workerd and in Node, so nothing here
 * needs `lib/db.ts` and `scripts/check-delivery.ts` can exercise it.
 */

const SCHEME = "v1";
/** Domain separation, so this key cannot collide with phone hashing. */
const INFO = "poll-feed-token-encryption-v1";

// Returned over an explicit ArrayBuffer rather than whatever TextEncoder
// hands back: `crypto.subtle` takes BufferSource, which excludes the
// SharedArrayBuffer-backed variant TypeScript now infers.
function bytes(s: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  out.set(encoded);
  return out;
}

function toBase64(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += String.fromCharCode(x);
  return btoa(out);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob(s);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The encryption key, derived rather than stored.
 *
 * `PHONE_HASH_SECRET` is reused as the source because it already exists on
 * every deployment and is documented "never change once in use" — which is
 * exactly the property a key-encryption-key needs, and the reason not to add
 * a new secret that would have to be installed through the CLI this feature
 * exists to avoid.
 *
 * The consequence to know: rotating `PHONE_HASH_SECRET` makes every stored
 * token undecryptable. That is recoverable — paste the tokens again — but it
 * is not obvious, so it is written here and in the handover.
 */
async function key(): Promise<CryptoKey> {
  const source = process.env.PHONE_HASH_SECRET;
  if (!source) throw new Error("PHONE_HASH_SECRET is required to store a feed token.");

  // deriveBits then importKey, rather than deriveKey in one step.
  //
  // Both work. `deriveKey` with HKDF ran on workerd in production — the first
  // key was sealed by a build using it — and the two paths produce
  // byte-identical 256-bit keys, checked by exporting both and comparing. So
  // this is not a fix and nothing depended on it; it uses the pair the Workers
  // supported-algorithms table ticks for HKDF explicitly, where `deriveKey`
  // has to be inferred from it.
  //
  // Recorded because the honest history is useful: this was changed on a
  // suspicion that workerd would reject `deriveKey`, raised from an ambiguous
  // docs table while the first key was being saved. The suspicion was wrong.
  // A Node-versus-workerd divergence has broken three libraries here, which
  // makes the worry reasonable and still does not make it evidence — and the
  // checks for this file run under Node, so they could never have settled it
  // either way. The production save did.
  const material = await crypto.subtle.importKey("raw", bytes(source), "HKDF", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: bytes(""), info: bytes(INFO) },
    material,
    256,
  );
  return crypto.subtle.importKey("raw", derived, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** `v1.<iv>.<ciphertext>`, both base64. */
export async function seal(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), bytes(plaintext));
  return `${SCHEME}.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

/**
 * Null rather than a throw on anything that does not open.
 *
 * A token that cannot be decrypted is operationally the same as no token —
 * the delivery buttons stay disabled and say so — and that is a better
 * outcome than an exception on a page load. The usual cause is
 * `PHONE_HASH_SECRET` having changed.
 */
export async function open(stored: string): Promise<string | null> {
  const parts = stored.split(".");
  if (parts.length !== 3 || parts[0] !== SCHEME) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(parts[1]!) },
      await key(),
      fromBase64(parts[2]!),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/**
 * First eight hex of the token's SHA-256, for showing *which* key is installed
 * without showing the key.
 *
 * Enough to compare against what the other end reports for the key it issued,
 * which is the only question an operator actually has — and eight hex is too
 * short to help anybody brute-force the token it came from.
 */
/**
 * The full SHA-256 of a string, lowercase hex.
 *
 * Exported so the whole 64 characters can be asserted and not only the eight
 * the fingerprint shows. That distinction is the point: this digest call and
 * `bytes()` also feed the HKDF derivation in `key()`, and the first eight hex
 * of a digest is no constraint at all on a function producing key material. A
 * hash agreeing with SHA-256 on the first four bytes and diverging afterwards
 * would satisfy every fingerprint vector and still be the wrong hash.
 */
export async function digestHex(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes(plaintext));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprint(plaintext: string): Promise<string> {
  // Visibly a slice of the full digest rather than its own computation, so the
  // two cannot drift and the eight characters inherit whatever pins the 64.
  return (await digestHex(plaintext)).slice(0, 8);
}
