import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { screenForPoll } from "@/lib/polling/calls";
import { extractNumbers, NXX_SOURCED_AT } from "@/lib/polling/numbers";
import { MAX_BATCH_NUMBERS } from "@/lib/polling/results";
import { csvCell } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The per-number result of screening a list, as a CSV download.
 *
 * **This file contains telephone numbers, and `../export/route.ts`
 * deliberately does not.** The difference is not an oversight in either. The
 * call export is derived from stored records, where the schema keeps numbers
 * only as an HMAC precisely so a respondent cannot be identified from it. This
 * download is the operator's own list handed straight back to them with a
 * verdict beside each line, which is the entire point — a screening report
 * that withheld the numbers could not tell them which lines to drop. Nothing
 * here is written to the database: `screenForPoll` hashes for two lookups and
 * discards them.
 *
 * A POST rather than a GET because the list is the input, and a list of
 * thousands of numbers does not belong in a URL — or in a server log.
 *
 * Both of the form's buttons post here, told apart by `mode`: "csv" returns
 * the file, anything else redirects back to the Calls tab with the counts in
 * the query string. One endpoint and one plain HTML form rather than a server
 * action plus a route, so a list is pasted once and the two buttons cannot
 * disagree about what was screened.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const session = await auth();
  const role = session?.user.role;
  const tenantId = session?.user.tenantId;
  if (!tenantId || (role !== Role.SUPER_ADMIN && role !== Role.ADMIN)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const poll = await prisma.poll.findFirst({ where: { id, tenantId } });
  if (!poll) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  let text = String(form.get("numbers") ?? "");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) text += "\n" + (await file.text());
  const mode = String(form.get("mode") ?? "summary");
  const back = (params: Record<string, string>): NextResponse =>
    // 303 so the browser follows with a GET; a 307 would repost the list.
    NextResponse.redirect(
      new URL(
        `/admin/polls/${poll.id}?${new URLSearchParams({ tab: "calls", ...params })}`,
        req.url
      ),
      303
    );

  const numbers = extractNumbers(text);
  if (numbers.length === 0) return back({ error: "No phone numbers found to screen." });
  if (numbers.length > MAX_BATCH_NUMBERS) {
    return back({
      error: `${numbers.length.toLocaleString()} numbers found; the limit is ${MAX_BATCH_NUMBERS.toLocaleString()} at a time. Split the list.`,
    });
  }

  const report = await screenForPoll(poll.id, numbers, {
    includeInstitutional: form.get("includeInstitutional") === "on",
    line: form.get("line") === "mobile" ? "mobile" : "any",
    skipAlreadyCalled: form.get("skipAlreadyCalled") === "on",
  });

  const onDnc = new Set(report.onDoNotCall);
  const called = new Set(report.alreadyCalled);
  const c = report.counts;

  if (mode !== "csv") {
    return back({
      screened: "1",
      sTotal: String(report.total),
      sCallable: String(report.callable.length),
      sMobile: String(c.mobile),
      sFixed: String(c.fixed),
      sDuplicate: String(c.duplicate),
      sInvalid: String(c.invalid),
      sOutOfArea: String(c.outOfArea),
      sUnallocated: String(c.unallocated),
      sNotDialable: String(c.notDialable),
      sDnc: String(report.onDoNotCall.length),
      sCalled: String(report.alreadyCalled.length),
      // The commonest dead exchanges describe the generator rather than the
      // list. Capped so the URL stays a URL.
      sTopUnallocated: report.unallocatedByNxx
        .slice(0, 8)
        .map(([nxx, n]) => `${nxx}:${n}`)
        .join(","),
      sSourced: NXX_SOURCED_AT,
      batch: String(Date.now()),
    });
  }

  const lines: string[] = [
    ["Polimeter number screening"].map(csvCell).join(","),
    ["Poll", poll.name].map(csvCell).join(","),
    ["Screened", new Date().toISOString()].map(csvCell).join(","),
    ["OfReg allocations sourced", NXX_SOURCED_AT].map(csvCell).join(","),
    "",
    ["Submitted", report.total].map(csvCell).join(","),
    ["Callable", report.callable.length].map(csvCell).join(","),
    ["Mobile", c.mobile].map(csvCell).join(","),
    ["Landline", c.fixed].map(csvCell).join(","),
    ["Duplicate", c.duplicate].map(csvCell).join(","),
    ["Malformed", c.invalid].map(csvCell).join(","),
    ["Outside +1 345", c.outOfArea].map(csvCell).join(","),
    ["Exchange not allocated", c.unallocated].map(csvCell).join(","),
    ["Allocated but not dialable", c.notDialable].map(csvCell).join(","),
    ["On do-not-call", report.onDoNotCall.length].map(csvCell).join(","),
    ["Already called for this poll", report.alreadyCalled.length].map(csvCell).join(","),
    "",
    ["Unallocated exchanges drawn", "count"].map(csvCell).join(","),
    ...report.unallocatedByNxx.map(([nxx, n]) => [`345-${nxx}`, n].map(csvCell).join(",")),
    "",
    ["input", "verdict", "number", "exchange", "line", "carrier", "reason"]
      .map(csvCell)
      .join(","),
  ];

  for (const row of report.rows) {
    // An "ok" row from the pure screener still has two database verdicts ahead
    // of it, so it is refined here rather than reported as callable outright.
    const verdict =
      row.verdict !== "ok"
        ? row.verdict
        : onDnc.has(row.e164)
          ? "do-not-call"
          : called.has(row.e164)
            ? "already-called"
            : "callable";
    lines.push(
      [
        row.input,
        verdict,
        "e164" in row ? row.e164 : "",
        "nxx" in row ? `345-${row.nxx}` : "",
        row.verdict === "ok" ? row.line : "",
        row.verdict === "ok" ? row.holder : "",
        row.verdict === "not-dialable"
          ? row.reason
          : verdict === "do-not-call"
            ? "on the do-not-call list"
            : verdict === "already-called"
              ? "already called for this poll"
              : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="screening-${stamp}.csv"`,
      // The list came from the operator and goes straight back; no store.
      "cache-control": "no-store",
    },
  });
}
