/**
 * Checks the Cayman number screener.
 *
 * Run with:  npm run check:numbers
 *
 * The expected counts below were derived by reading OfReg's published table,
 * not by running this code and recording what it said. That distinction is the
 * whole value of the file: a count taken from the function under test asserts
 * only that the function agrees with itself, and would survive any change to
 * the classification rules.
 *
 * Each assertion is paired with what would let it pass by accident. "949 is
 * reachable" is worth little without "919 is not", because 919 is published as
 * a Mobile and is excluded only by its note — so the pair proves the note
 * overrides the service type rather than merely coexisting with it.
 */
import {
  DIALABLE_NXX,
  FIXED_NXX,
  MOBILE_NXX,
  NOTE_RULES,
  NXX_345,
  NXX_BY_CODE,
  screen,
} from "../lib/polling/numbers";
import { tryNormalizePhone } from "../lib/polling/phone";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

function sameSet(got: readonly string[], want: readonly string[]): boolean {
  return [...got].sort().join(",") === [...want].sort().join(",");
}

function main(): void {
  console.log("The allocation table");
  check("has the 86 rows OfReg publishes", NXX_345.length === 86, `${NXX_345.length}`);
  check(
    "has no duplicate code",
    new Set(NXX_345.map((r) => r.nxx)).size === NXX_345.length
  );
  check(
    "every code is a structurally valid NXX",
    NXX_345.every((r) => /^[2-9]\d{2}$/.test(r.nxx)),
    NXX_345.filter((r) => !/^[2-9]\d{2}$/.test(r.nxx)).map((r) => r.nxx).join(",")
  );
  // The announce-itself check. A refresh that introduces a service or note no
  // rule covers must fail here rather than quietly classifying the row — and
  // because an unrecognised row is forced unreachable, the silent direction is
  // lost reach rather than unwanted calls.
  const unrecognised = NXX_345.filter((r) => r.unrecognised);
  check(
    "no row has an OfReg service or note without a rule",
    unrecognised.length === 0,
    unrecognised.map((r) => `${r.nxx}: ${r.service} / ${r.note}`).join(" | ")
  );

  console.log("");
  console.log("Counts, derived from the published table by hand");
  check("74 ordinary dialable codes", DIALABLE_NXX.length === 74, `${DIALABLE_NXX.length}`);
  check("47 of them mobile", MOBILE_NXX.length === 47, `${MOBILE_NXX.length}`);
  check("27 of them fixed", FIXED_NXX.length === 27, `${FIXED_NXX.length}`);
  check(
    "mobile and fixed account for all of them",
    MOBILE_NXX.length + FIXED_NXX.length === DIALABLE_NXX.length
  );

  const institutional = NXX_345.filter((r) => r.institutional).map((r) => r.nxx);
  check(
    "the institutional codes are 244, 814, 815, 914",
    sameSet(institutional, ["244", "814", "815", "914"]),
    institutional.join(",")
  );
  const unreachable = NXX_345.filter((r) => !r.reachable).map((r) => r.nxx);
  check(
    "the unreachable codes are 638, 730, 767, 800, 919, 948, 976, 995",
    sameSet(unreachable, ["638", "730", "767", "800", "919", "948", "976", "995"]),
    unreachable.join(",")
  );
  check(
    "78 codes are reachable at all, institutional included",
    NXX_345.filter((r) => r.reachable).length === 78
  );

  console.log("");
  console.log("Classification: known answers, and their near misses");
  const info = (nxx: string) => NXX_BY_CODE.get(nxx)!;
  check("949 is a reachable FLOW landline", info("949").reachable && info("949").line === "fixed");
  check("321 is a reachable Digicel mobile", info("321").reachable && info("321").line === "mobile");
  check(
    "412 is reachable although its note is a future date",
    info("412").reachable && info("412").holder.includes("Paradise")
  );
  // 919 and 948 are the discriminating pair: both are published with a service
  // type that is ordinarily dialable, and both are excluded by their note
  // alone. Without them, dropping the note rules entirely would still pass.
  check("919 is excluded despite being published Mobile", !info("919").reachable);
  check("948 is excluded despite being published Fixed", !info("948").reachable);
  check("730 is excluded as carrier-internal", !info("730").reachable);
  check("800 is excluded as national-only", !info("800").reachable);
  check("767 is excluded, reserved for portability", !info("767").reachable);
  check("976 is excluded as premium", !info("976").reachable);
  check("995 is excluded as non-dialable", !info("995").reachable);
  check("638 is excluded, with no service type published", !info("638").reachable);
  check("244 is reachable but flagged government", info("244").reachable && info("244").institutional);
  check("814 is reachable but flagged business DID", info("814").reachable && info("814").institutional);
  check("an unallocated code is simply absent", NXX_BY_CODE.get("999") === undefined);

  // The comment on NOTE_RULES claims the order is not load-bearing today.
  // Asserted rather than trusted, because it is the kind of claim that stops
  // being true when somebody adds a rule.
  const overlapping = NXX_345.filter(
    (r) => NOTE_RULES.filter((rule) => rule.match.test(r.note)).length > 1
  );
  check(
    "no published note matches two rules",
    overlapping.length === 0,
    overlapping.map((r) => `${r.nxx}: ${r.note}`).join(" | ")
  );

  console.log("");
  console.log("Screening verdicts");
  const verdict = (input: string) => screen([input]).rows[0]!.verdict;
  check("a seven-digit landline screens ok", verdict("9491234") === "ok");
  check("a spaced mobile screens ok", verdict("345 321 0000") === "ok");
  check("an unallocated exchange is unallocated", verdict("+13459991234") === "unallocated");
  check("a US number is out of area", verdict("+12125551234") === "out-of-area");
  check("a government range is not dialable by default", verdict("+13452440000") === "not-dialable");
  check("a paging range is not dialable", verdict("+13459480000") === "not-dialable");
  // The seven-digit exchange gap this work closed in phone.ts. Before the fix
  // this normalised to +13450123456 and was dialled.
  check("a leading-zero exchange is invalid, not unallocated", verdict("0123456") === "invalid");
  check("a leading-one exchange is invalid", verdict("1234567") === "invalid");
  check("tryNormalizePhone now refuses it outright", tryNormalizePhone("0123456") === null);
  check("and still accepts a real local number", tryNormalizePhone("9491234") === "+13459491234");

  console.log("");
  console.log("Screening a list");
  const list = ["9491234", "+1 345 949 1234", "345-321-0000", "0123456", "+13459991234", "+13459981234", "+13452440000"];
  const r = screen(list);
  check("the duplicate is caught across formats", r.counts.duplicate === 1, JSON.stringify(r.counts));
  check("the clean list drops it", r.clean.length === 2, r.clean.join(","));
  check("the clean list is E.164", r.clean.every((n) => /^\+1345[2-9]\d{6}$/.test(n)), r.clean.join(","));
  check("the clean list keeps input order", r.clean[0] === "+13459491234" && r.clean[1] === "+13453210000");
  check("one mobile and one landline", r.counts.mobile === 1 && r.counts.fixed === 1);
  // Without this the counts could each be right and still not describe the
  // list — every input must land in exactly one bucket.
  const c = r.counts;
  check(
    "every input is accounted for exactly once",
    c.ok + c.invalid + c.outOfArea + c.unallocated + c.notDialable + c.duplicate === r.total,
    `${JSON.stringify(c)} vs total ${r.total}`
  );
  check(
    "unallocated exchanges are reported by code",
    sameSet(r.unallocatedByNxx.map(([n]) => n), ["998", "999"]),
    JSON.stringify(r.unallocatedByNxx)
  );

  console.log("");
  console.log("Screening options");
  check(
    "government ranges are kept when asked for",
    screen(["+13452440000"], { includeInstitutional: true }).counts.ok === 1
  );
  check(
    "mobile-only excludes a landline",
    screen(["9491234"], { line: "mobile" }).counts.ok === 0
  );
  check(
    "mobile-only keeps a mobile",
    screen(["345 321 0000"], { line: "mobile" }).counts.ok === 1
  );
  check(
    "screening an empty list is empty, not an error",
    screen([]).total === 0 && screen([]).clean.length === 0
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
