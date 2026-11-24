/**
 * Checks the shareable results card.
 *
 * Run with:  npm run check:card
 *
 * Two failures here are invisible until someone else finds them, which is why
 * this file exists rather than a glance at the output.
 *
 * A QR code that is drawn but does not scan looks perfectly fine in every
 * preview. So the matrix is rasterised and decoded with a real decoder, and
 * compared against the exact string it was asked to carry — a round trip, not
 * an eyeball. The standing rule is that a QR encodes the URL in the call to
 * action and never a different one, and that is a property worth asserting
 * rather than trusting.
 *
 * An unescaped `&` in a question produces a document no renderer will open.
 * The failure is total, and it depends on the wording of a poll nobody has
 * written yet, so every string is escaped at interpolation and checked here.
 */
import jsQR from "jsqr";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  MAX_ROWS,
  qrMatrix,
  resultsCardSvg,
  wrapText,
  type ResultsCardInput,
} from "../lib/polling/results-card";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

const BASE: ResultsCardInput = {
  pollName: "Cayman Pulse — November 2026",
  question: "How satisfied are you with the government's handling of the cost of living?",
  answers: [
    { answer: "Very satisfied", share: 0.08, fill: "#1c5cab" },
    { answer: "Satisfied", share: 0.24, fill: "#6da7ec" },
    { answer: "Dissatisfied", share: 0.37, fill: "#f09b7a" },
    { answer: "Very dissatisfied", share: 0.26, fill: "#c2362f" },
    { answer: "Don't know", share: 0.05, fill: "#b9b5ad" },
  ],
  base: 612,
  marginPoints: 4.3,
  weighted: true,
  fieldwork: "2–5 November 2026",
  companyName: "CayWorks",
  url: "https://polimeter.cayworks.net",
  blockers: [],
};

/** The matrix as RGBA pixels with a quiet zone, which is what a decoder needs. */
function rasterise(matrix: boolean[][], scale = 8, quiet = 4): { data: Uint8ClampedArray; size: number } {
  const n = matrix.length;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r]![c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (c + quiet) * scale + dx;
          const y = (r + quiet) * scale + dy;
          const i = (y * size + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

function main(): void {
  console.log("The QR carries exactly the URL it was given");
  for (const url of [
    "https://polimeter.cayworks.net",
    "https://polimeter.cayworks.net/admin/polls/cmvoe20gk00003su3190k0xhs?tab=results",
    "https://polling.cayworks.net",
  ]) {
    const { data, size } = rasterise(qrMatrix(url));
    const decoded = jsQR(data, size, size);
    check(
      `round trips: ${url.slice(0, 48)}${url.length > 48 ? "…" : ""}`,
      decoded?.data === url,
      decoded ? `decoded ${JSON.stringify(decoded.data)}` : "decoder found no code at all",
    );
  }
  // Paired with the above: a decoder that returned its input would pass them.
  const a = rasterise(qrMatrix("https://example.com/a"));
  check(
    "two different URLs do not decode the same",
    jsQR(a.data, a.size, a.size)?.data !== "https://polimeter.cayworks.net",
  );

  console.log("");
  console.log("The drawn card");
  const svg = resultsCardSvg(BASE);
  check("is an svg document", svg.startsWith("<svg ") && svg.trimEnd().endsWith("</svg>"));
  check("declares the share size", svg.includes(`width="${CARD_WIDTH}"`) && svg.includes(`height="${CARD_HEIGHT}"`));
  check("draws the QR as a path", /<path d="M[\d.]+ [\d.]+h/.test(svg));
  check("prints the url as text too", svg.includes(">https://polimeter.cayworks.net<"));
  for (const [answer, pct] of [["Very satisfied", "8%"], ["Dissatisfied", "37%"]] as const) {
    check(`${answer} is drawn at ${pct}`, svg.includes(`>${pct}</text>`));
  }
  check("the base and margin are stated", svg.includes("n = 612") && svg.includes("±4.3 pts at 95%"));
  check("says it is weighted", svg.includes("weighted"));

  console.log("");
  console.log("Escaping, because one ampersand breaks the whole document");
  const nasty = resultsCardSvg({
    ...BASE,
    question: 'Do you back "Plan A" & <Plan B> for roads?',
    pollName: "Tom & Jerry's poll",
    answers: [{ answer: 'Yes & "definitely"', share: 0.5, fill: "#1c5cab" }],
  });
  check("the ampersand is escaped", nasty.includes("&amp;") && !/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(nasty));
  check("angle brackets in content are escaped", nasty.includes("&lt;Plan B&gt;"));
  check("quotes inside an attribute are escaped", !/aria-label="[^"]*"[^>]*[A-Za-z]"/.test(nasty));

  console.log("");
  console.log("Wrapping");
  check("a short line is left alone", wrapText("Short question?", 600, 38, 2).length === 1);
  check(
    "a long question wraps rather than running off the card",
    wrapText("word ".repeat(60), 600, 38, 2).length === 2,
  );
  check(
    "truncation is marked",
    wrapText("word ".repeat(60), 600, 38, 2)[1]!.endsWith("…"),
  );
  // Paired: a wrapper that always appended an ellipsis would pass the above.
  check("text that fits is not marked", !wrapText("Short question?", 600, 38, 2)[0]!.endsWith("…"));
  check("empty text yields no lines", wrapText("   ", 600, 38, 2).length === 0);

  console.log("");
  console.log("The publication gate reaches the card");
  const blocked = resultsCardSvg({ ...BASE, base: 40, blockers: ["base below 100", "weights did not converge"] });
  check("an unfit figure is stamped", blocked.includes("NOT FIT TO PUBLISH"));
  check("and the reason travels with it", blocked.includes("base below 100"));
  check("a fit figure carries no stamp", !svg.includes("NOT FIT TO PUBLISH"));

  console.log("");
  console.log("Too many answers");
  const many = resultsCardSvg({
    ...BASE,
    answers: Array.from({ length: 8 }, (_, i) => ({ answer: `Option ${i + 1}`, share: 0.1, fill: "#1c5cab" })),
  });
  check(`only ${MAX_ROWS} rows are drawn`, (many.match(/<\/text><rect/g) ?? []).length <= MAX_ROWS);
  check("and the rest are declared, not dropped silently", many.includes("+3 further answers not shown"));

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
