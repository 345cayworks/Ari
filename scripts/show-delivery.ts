/**
 * Prints what was actually stored for a campaign delivery.
 *
 * Run with:   npm run show:delivery            (the most recent)
 *             npm run show:delivery -- --all   (every one)
 *
 * Observations, not a verdict. The admin panel shows a delivery's status,
 * http code and detail, which is enough to see whether it landed — but not
 * what was *in* it. The one thing no check on either side can prove is that
 * `markAsTest` actually produced the test marking rather than merely being
 * passed: `scripts/check-delivery.ts` verifies what a payload carrying the
 * notice does, and the wiring from flag to blocker only runs through
 * `feed.ts`, which needs a database. So the stored payload is the evidence,
 * and this prints it rather than summarising it.
 *
 * Deliberately prints every blocker in full. A count or a boolean would hide
 * exactly the thing worth reading — whether the sentence that says "this is a
 * trial and not a measurement of opinion" is really there, in those words, on
 * a row somebody may read years from now.
 *
 * Imports `@prisma/client` directly with the pg adapter rather than
 * `lib/db.ts`: that module is the WASM client and does not run under Node at
 * all.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

interface StoredAnswer {
  answer?: unknown;
  n?: unknown;
  pct_all?: unknown;
  pct_with_a_view?: unknown;
  moe?: unknown;
}

interface StoredPayload {
  delivery_id?: unknown;
  sequence?: unknown;
  poll?: Record<string, unknown>;
  method?: Record<string, unknown>;
  publication?: { quotable?: unknown; blockers?: unknown };
  questions?: {
    id?: unknown;
    text?: unknown;
    base?: Record<string, unknown>;
    answers?: StoredAnswer[];
    publication?: { quotable?: unknown; blockers?: unknown };
  }[];
  breakdowns?: unknown[];
}

/** What a value actually is, not what it was meant to be. */
function shape(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "absent";
  if (Array.isArray(v)) return `array[${v.length}]`;
  return typeof v;
}

function gate(g: { quotable?: unknown; blockers?: unknown } | undefined, indent: string): void {
  if (g === undefined) {
    console.log(`${indent}publication: absent (inherits the delivery gate)`);
    return;
  }
  console.log(`${indent}quotable: ${JSON.stringify(g.quotable)} (${shape(g.quotable)})`);
  const blockers = Array.isArray(g.blockers) ? g.blockers : [];
  console.log(`${indent}blockers: ${shape(g.blockers)}`);
  for (const [i, b] of blockers.entries()) {
    console.log(`${indent}  [${i}] ${typeof b === "string" ? b : JSON.stringify(b)}`);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const all = process.argv.includes("--all");
  const rows = await prisma.pollDelivery.findMany({
    orderBy: { sequence: "desc" },
    take: all ? undefined : 1,
    select: {
      id: true,
      target: true,
      sequence: true,
      status: true,
      httpStatus: true,
      detail: true,
      missing: true,
      attempts: true,
      createdAt: true,
      sentAt: true,
      payload: true,
      poll: { select: { id: true, name: true } },
    },
  });

  if (rows.length === 0) {
    console.log("No deliveries stored.");
    console.log("");
    console.log("Expected until the first one is sent. When it has been, this prints");
    console.log("the stored row and every blocker in full — which is how to tell");
    console.log("whether the test marking actually arrived rather than whether the");
    console.log("delivery was merely accepted.");
    await prisma.$disconnect();
    return;
  }

  for (const row of rows) {
    const p = (row.payload ?? null) as StoredPayload | null;

    console.log("=".repeat(72));
    console.log(`delivery   ${row.id}`);
    console.log(`poll       ${row.poll.name} (${row.poll.id})`);
    console.log(`target     ${row.target}`);
    console.log(`sequence   ${row.sequence}`);
    console.log(`status     ${row.status}${row.httpStatus === null ? "" : `  HTTP ${row.httpStatus}`}`);
    console.log(`attempts   ${row.attempts}`);
    console.log(`created    ${row.createdAt.toISOString()}`);
    console.log(`sent       ${row.sentAt === null ? "—" : row.sentAt.toISOString()}`);
    console.log(`detail     ${row.detail === null ? "—" : row.detail}`);
    console.log(`missing    ${shape(row.missing)}${row.missing.length ? ` ${JSON.stringify(row.missing)}` : ""}`);

    if (p === null || typeof p !== "object") {
      console.log(`payload    ${shape(p)} — nothing to read`);
      continue;
    }

    // The two the row and the payload must agree on. If these have come
    // apart, replayDelivery refuses to send, so it is worth seeing.
    console.log("");
    console.log(`payload.delivery_id  ${JSON.stringify(p.delivery_id)}  ${p.delivery_id === row.id ? "matches row" : "DISAGREES WITH ROW"}`);
    console.log(`payload.sequence     ${JSON.stringify(p.sequence)}  ${p.sequence === row.sequence ? "matches row" : "DISAGREES WITH ROW"}`);

    console.log("");
    console.log("delivery gate");
    gate(p.publication, "  ");

    console.log("");
    console.log(`method  ${shape(p.method)}`);
    if (p.method !== undefined && p.method !== null) {
      for (const [k, v] of Object.entries(p.method)) {
        console.log(`  ${k}: ${JSON.stringify(v)} (${shape(v)})`);
      }
    }

    const questions = Array.isArray(p.questions) ? p.questions : [];
    console.log("");
    console.log(`questions  ${shape(p.questions)}`);
    for (const q of questions) {
      console.log(`  ${String(q.id)}`);
      console.log(`    base: all=${JSON.stringify(q.base?.all)} with_a_view=${JSON.stringify(q.base?.with_a_view)}`);
      console.log(`    answers: ${shape(q.answers)}`);
      for (const a of Array.isArray(q.answers) ? q.answers : []) {
        // pct_with_a_view is printed with its type because a null that came
        // back as the string "null" would read identically otherwise, and
        // would surface as a no-view answer holding a real share.
        console.log(
          `      ${JSON.stringify(a.answer)} n=${JSON.stringify(a.n)} ` +
            `pct_all=${JSON.stringify(a.pct_all)} ` +
            `pct_with_a_view=${JSON.stringify(a.pct_with_a_view)} (${shape(a.pct_with_a_view)}) ` +
            `moe=${JSON.stringify(a.moe)}`,
        );
      }
      gate(q.publication, "    ");
    }

    console.log("");
    console.log(`breakdowns  ${shape(p.breakdowns)}`);
  }

  console.log("=".repeat(72));
  await prisma.$disconnect();
}

void main();
