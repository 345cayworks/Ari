/**
 * The published NXX allocations for +1 345, as OfReg lists them.
 *
 * Transcribed by hand from the page below on 2026-11-03, not scraped: there is
 * no refresh script, and this comment said there was one until the claim was
 * checked. To update it, re-read the page and edit this file. `check:numbers`
 * asserts the row count and the derived totals, so a table that has grown
 * since fails loudly rather than going quietly out of date — but only once
 * somebody runs it, which is the limit of the guard.
 *
 * This file holds **only what OfReg publishes**, verbatim. Every judgement —
 * whether a code can reach a respondent, whether it is a mobile, whether it
 * belongs in a sample — lives in `numbers.ts` and not here. That separation is
 * the point: a refresh overwrites facts, so if policy lived in this file a
 * routine refresh could silently widen what the platform is willing to dial.
 *
 * OfReg's own disclaimer on the page: the table "has no legal standing" and
 * individual licences govern. It is the best available source and it is not
 * authoritative, which is why `SOURCED_AT` is recorded and shown in the UI.
 */

export const SOURCED_AT = "2026-11-03";
export const SOURCE_URL = "https://www.ofreg.ky/ict/number-nxx-allocations";

/** `[nxx, holder, service, note]`, each exactly as published. */
export type OfregRow = readonly [string, string, string, string];

const CW = "Cable and Wireless (C.I.) Ltd (T/A FLOW)";
const DIGICEL = "Digicel Cayman Limited";
const INFINITY = "Infinity Broadband";
const PARADISE = "Paradise Mobile Ltd";
const WESTTEL = "WestTel Limited";

export const OFREG_345: readonly OfregRow[] = [
  ["222", CW, "Fixed", ""],
  ["232", INFINITY, "Fixed", ""],
  ["233", INFINITY, "Fixed", ""],
  ["244", CW, "Fixed", "Government Central Office Codes"],
  ["266", CW, "Fixed", ""],
  ["321", DIGICEL, "Mobile - GSM", ""],
  ["322", DIGICEL, "Mobile - GSM", ""],
  ["323", DIGICEL, "Mobile - GSM", ""],
  ["324", DIGICEL, "Mobile", ""],
  ["325", DIGICEL, "Mobile - GSM", ""],
  ["326", DIGICEL, "Mobile - GSM Post Paid", ""],
  ["327", DIGICEL, "Mobile - GSM Pre Paid", ""],
  ["328", DIGICEL, "Mobile - GSM", ""],
  ["329", DIGICEL, "Mobile - GSM", ""],
  ["333", INFINITY, "Fixed", ""],
  ["412", PARADISE, "Mobile", "Effective 9th March 2026"],
  ["413", PARADISE, "Mobile", "Effective 9th March 2026"],
  ["414", PARADISE, "Mobile", "Effective 9th March 2026"],
  ["415", PARADISE, "Mobile", "Effective 9th March 2026"],
  ["416", PARADISE, "Mobile", "Effective 9th March 2026"],
  ["420", DIGICEL, "Mobile - GSM", ""],
  ["421", DIGICEL, "Mobile - GSM", ""],
  ["422", DIGICEL, "Mobile - GSM", ""],
  ["423", DIGICEL, "Mobile - GSM", ""],
  ["424", DIGICEL, "Mobile - GSM", ""],
  ["444", CW, "Fixed", ""],
  ["516", DIGICEL, "Mobile - GSM", ""],
  ["517", DIGICEL, "Mobile - GSM", ""],
  ["525", DIGICEL, "Mobile - GSM", ""],
  ["526", DIGICEL, "Mobile - GSM", ""],
  ["527", DIGICEL, "Mobile - GSM", ""],
  ["546", DIGICEL, "Mobile - GSM", ""],
  ["547", DIGICEL, "Mobile - GSM", ""],
  ["548", DIGICEL, "Mobile - GSM", ""],
  ["549", DIGICEL, "Mobile - GSM", ""],
  ["550", DIGICEL, "Mobile - GSM", ""],
  ["623", DIGICEL, "Fixed", ""],
  ["638", CW, "", "*7873 and *4638 used for Internet Service"],
  ["640", DIGICEL, "Fixed", ""],
  ["649", DIGICEL, "Fixed", ""],
  ["730", CW, "Fixed", "Cable and Wireless internal use only"],
  ["743", WESTTEL, "Fixed", ""],
  ["745", WESTTEL, "Fixed", ""],
  ["746", WESTTEL, "Fixed", ""],
  ["747", CW, "Fixed", ""],
  ["749", WESTTEL, "Fixed", ""],
  ["766", WESTTEL, "Fixed", ""],
  ["767", "Reserved", "Blocked", "Reserved in connection with LNP"],
  ["768", WESTTEL, "Fixed", ""],
  ["769", WESTTEL, "Fixed", ""],
  ["777", CW, "Fixed", ""],
  ["800", CW, "Fixed", "National only"],
  ["814", CW, "Fixed", "Direct Inward Dial"],
  ["815", CW, "Fixed", "Direct Inward Dial"],
  ["825", WESTTEL, "Mobile", ""],
  ["826", WESTTEL, "Mobile", ""],
  ["848", CW, "Fixed", ""],
  ["849", CW, "Fixed", ""],
  ["888", CW, "Fixed", ""],
  ["914", CW, "Fixed", "Direct Inward Dial"],
  ["916", CW, "Mobile - Post Pd. TDMA", ""],
  ["917", CW, "Mobile - Pre Pd. TDMA", ""],
  ["919", CW, "Mobile", "Temp. Location Directory Number"],
  ["922", CW, "Mobile - Pre Pd.", ""],
  ["923", CW, "Mobile - Pre Pd.", ""],
  ["924", CW, "Mobile - Post Pd. GSM", ""],
  ["925", CW, "Mobile - Post Pd. GSM", ""],
  ["926", CW, "Mobile - Post Pd. TDMA", ""],
  ["927", CW, "Mobile - Pre Pd. TDMA", ""],
  ["928", CW, "Mobile - Pre Pd. TDMA", ""],
  ["929", CW, "Mobile - Pre Pd. GSM", ""],
  ["930", CW, "Mobile", ""],
  ["936", CW, "Mobile - Post Pd.", ""],
  ["937", CW, "Mobile - Post Pd.", ""],
  ["938", CW, "Mobile - Pre Pd. TDMA", ""],
  ["939", CW, "Mobile - Pre Pd. GSM", ""],
  ["940", CW, "Fixed", ""],
  ["943", CW, "Fixed", ""],
  ["945", CW, "Fixed", ""],
  ["946", CW, "Fixed", ""],
  ["947", CW, "Fixed", ""],
  ["948", CW, "Fixed", "Little Cayman and Cayman Brac Paging"],
  ["949", CW, "Fixed", ""],
  ["976", CW, "Premium", "*4638 (INET) Internet Access Open"],
  ["990", CW, "Mobile", ""],
  ["995", CW, "Non-Dialable", "National (Stop Line) Allocation"],
];
