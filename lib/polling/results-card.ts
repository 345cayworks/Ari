/**
 * A poll result as a shareable graphic.
 *
 * SVG built as a string rather than rendered through `next/og`. That library
 * would be the obvious choice and it pulls a few hundred KB of WASM into a
 * Worker sitting at about 2.2 MB against a 3 MB ceiling — for a card that is
 * text, rectangles and a QR code, none of which needs a rasteriser. The
 * trade-off is that SVG has no automatic text wrapping, so there is a wrapper
 * below doing it by estimated width.
 *
 * Pure on purpose: no `lib/db.ts`, no React, so `scripts/check-results-card.ts`
 * exercises it under plain Node — including decoding the QR it draws.
 *
 * **The card must agree with the Results tab.** It takes percentages and the
 * margin already computed by the page rather than recomputing them, and it is
 * handed the same fills `components/poll-charts.tsx` uses. A graphic that
 * rounded differently from the screen it was exported from would be the worst
 * defect this product could ship: two numbers for one poll, both ours.
 */
import qr from "qrcode-generator";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Answers beyond this are summarised rather than drawn; the card has room for five. */
export const MAX_ROWS = 5;

export interface ResultsCardAnswer {
  answer: string;
  /** Share of those answering, 0–1. Already weighted if the poll is. */
  share: number;
  /** The same hex `poll-charts.tsx` gives this answer. */
  fill: string;
}

export interface ResultsCardInput {
  pollName: string;
  question: string;
  answers: ResultsCardAnswer[];
  /** Respondents answering this question. */
  base: number;
  /** ± percentage points at 95%, or null when there is no basis for one. */
  marginPoints: number | null;
  weighted: boolean;
  /** "2–5 November 2026", or empty when no calls have landed. */
  fieldwork: string;
  companyName: string;
  /** Exactly the URL the QR encodes. Never a different one. */
  url: string;
  /** Reasons this figure is not fit to publish. Empty means it is. */
  blockers: string[];
}

const INK = "#0B1220";
const SAND = "#F7F4EE";
const SEA_DEEP = "#0A4D63";
const MUTED = "#6B7280";
const WARN = "#8f2020";

/**
 * XML-escape. Every string from a poll goes through this.
 *
 * A question reading "Do you support X & Y?" produces a document that no
 * renderer will open, and the failure is total rather than cosmetic — so this
 * is applied at every interpolation and asserted in the checks, rather than
 * trusted to the caller remembering.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Break text into lines that fit a pixel width.
 *
 * By estimate, not measurement: there are no font metrics available while
 * building a string, and the card must render the same wherever it is opened.
 * 0.52em per character is a deliberately cautious average for a serif at these
 * sizes — it wraps a little early rather than letting a long question run off
 * the edge, which is the failure that matters.
 */
export function wrapText(text: string, maxWidthPx: number, fontSizePx: number, maxLines: number): string[] {
  const perChar = fontSizePx * 0.52;
  const maxChars = Math.max(8, Math.floor(maxWidthPx / perChar));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === 0) return [];
  // An ellipsis only when something was actually dropped.
  const used = lines.join(" ").split(/\s+/).length;
  if (used < words.length) lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  return lines;
}

/** The QR as one path, sized to `size` px square, at (x, y). */
function qrPath(data: string, x: number, y: number, size: number): string {
  // Type 0 = smallest version that fits; "M" tolerates ~15% damage, which is
  // what makes a printed card still scan after a fold or a thumb.
  const code = qr(0, "M");
  code.addData(data);
  code.make();
  const n = code.getModuleCount();
  const m = size / n;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code.isDark(r, c)) {
        d += `M${(x + c * m).toFixed(2)} ${(y + r * m).toFixed(2)}h${m.toFixed(2)}v${m.toFixed(2)}h-${m.toFixed(2)}z`;
      }
    }
  }
  return `<path d="${d}" fill="${INK}"/>`;
}

/** The module matrix, so a test can decode what was drawn rather than trust it. */
export function qrMatrix(data: string): boolean[][] {
  const code = qr(0, "M");
  code.addData(data);
  code.make();
  const n = code.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => code.isDark(r, c)));
}

export function resultsCardSvg(input: ResultsCardInput): string {
  const pad = 64;
  const rows = input.answers.slice(0, MAX_ROWS);
  const hidden = input.answers.length - rows.length;
  const unfit = input.blockers.length > 0;

  const questionLines = wrapText(input.question, CARD_WIDTH - pad * 2, 38, 2);
  const barTop = 196 + questionLines.length * 46;
  const rowH = Math.min(54, Math.floor((470 - barTop) / Math.max(rows.length, 1)));
  const labelW = 300;
  const trackX = pad + labelW + 24;
  const trackW = CARD_WIDTH - pad - trackX - 92;

  const bars = rows
    .map((a, i) => {
      const y = barTop + i * rowH;
      const pct = Math.round(a.share * 100);
      const w = Math.max(2, Math.round(trackW * Math.max(0, Math.min(1, a.share))));
      const label = wrapText(a.answer, labelW, 19, 1)[0] ?? "";
      return [
        `<text x="${pad}" y="${y + 20}" font-size="19" fill="${INK}">${esc(label)}</text>`,
        `<rect x="${trackX}" y="${y + 4}" width="${trackW}" height="20" rx="4" fill="${INK}" opacity="0.07"/>`,
        `<rect x="${trackX}" y="${y + 4}" width="${w}" height="20" rx="4" fill="${a.fill}"/>`,
        `<text x="${trackX + trackW + 14}" y="${y + 20}" font-size="20" font-weight="600" fill="${INK}">${pct}%</text>`,
      ].join("");
    })
    .join("");

  const facts = [
    `n = ${input.base.toLocaleString("en-GB")}`,
    input.marginPoints !== null ? `±${input.marginPoints.toFixed(1)} pts at 95%` : null,
    input.weighted ? "weighted" : "unweighted",
    input.fieldwork || null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  // An unfit figure is stamped, not quietly drawn. The publication gate exists
  // so a number that cannot carry a headline says so; a card that dropped that
  // on the way out would undo it at exactly the moment it matters — when the
  // figure leaves the building.
  const stamp = unfit
    ? [
        `<rect x="${pad}" y="106" width="${CARD_WIDTH - pad * 2}" height="34" rx="6" fill="${WARN}" opacity="0.1"/>`,
        `<text x="${pad + 12}" y="129" font-size="16" font-weight="700" fill="${WARN}">NOT FIT TO PUBLISH — ${esc(
          wrapText(input.blockers.join("; "), CARD_WIDTH - pad * 2 - 230, 16, 1)[0] ?? "",
        )}</text>`,
      ].join("")
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" font-family="Georgia, 'Times New Roman', serif" role="img" aria-label="${esc(
    `${input.question} — ${rows.map((a) => `${a.answer} ${Math.round(a.share * 100)}%`).join(", ")}`,
  )}">
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${SAND}"/>
<text x="${pad}" y="${pad + 6}" font-size="13" letter-spacing="3" fill="${SEA_DEEP}">POLIMETER</text>
<text x="${pad}" y="${pad + 30}" font-size="15" fill="${MUTED}">${esc(input.pollName)}</text>
${stamp}
${questionLines
    .map(
      (l, i) =>
        `<text x="${pad}" y="${168 + i * 46}" font-size="38" font-weight="600" fill="${INK}">${esc(l)}</text>`,
    )
    .join("\n")}
${bars}
${hidden > 0 ? `<text x="${pad}" y="${barTop + rows.length * rowH + 22}" font-size="15" fill="${MUTED}">+${hidden} further answer${hidden === 1 ? "" : "s"} not shown</text>` : ""}
<line x1="${pad}" y1="${CARD_HEIGHT - 118}" x2="${CARD_WIDTH - pad}" y2="${CARD_HEIGHT - 118}" stroke="${INK}" stroke-opacity="0.12"/>
<text x="${pad}" y="${CARD_HEIGHT - 88}" font-size="16" fill="${INK}" fill-opacity="0.75">${esc(facts)}</text>
<text x="${pad}" y="${CARD_HEIGHT - 60}" font-size="14" fill="${MUTED}">${esc(
    input.companyName ? `Fieldwork by ${input.companyName}. Automated telephone interviews, disclosed as automated.` : "Automated telephone interviews, disclosed as automated.",
  )}</text>
<text x="${pad}" y="${CARD_HEIGHT - 36}" font-size="14" fill="${SEA_DEEP}">${esc(input.url)}</text>
${qrPath(input.url, CARD_WIDTH - pad - 88, CARD_HEIGHT - 148, 88)}
</svg>`;
}

// --- The whole poll on one card ----------------------------------

/** Questions beyond this are counted rather than drawn, so the card stays a card. */
export const MAX_QUESTIONS = 10;

export interface ConsolidatedCardInput {
  pollName: string;
  questions: { question: string; answers: ResultsCardAnswer[]; base: number }[];
  /** Respondents overall, which is what the margin is computed over. */
  base: number;
  marginPoints: number | null;
  weighted: boolean;
  fieldwork: string;
  companyName: string;
  url: string;
  blockers: string[];
}

/**
 * Every question's full distribution on one sheet — a topline, not a headline.
 *
 * Height grows with the content rather than being fixed at 630: a three
 * question poll would otherwise be mostly whitespace and a ten question one
 * illegible. The width stays 1200 so the two cards sit together.
 *
 * It shows each question's whole distribution rather than only its leading
 * answer. A topline that prints "Dissatisfied 37%" and drops the other four
 * rows tells you the winner and hides the shape — whether the rest split
 * evenly or stacked behind one rival changes what the number means, and this
 * platform's whole argument is against figures that travel without their
 * context.
 */
export function consolidatedCardSvg(input: ConsolidatedCardInput): string {
  const pad = 64;
  const unfit = input.blockers.length > 0;
  const shown = input.questions.slice(0, MAX_QUESTIONS);
  const hiddenQs = input.questions.length - shown.length;

  const headerH = unfit ? 210 : 168;
  const rowH = 30;
  const qGap = 26;

  // Lay out first, measure, then draw — the height is not known until every
  // question has been wrapped.
  type Block = { lines: string[]; answers: ResultsCardAnswer[]; hidden: number; base: number; top: number };
  const blocks: Block[] = [];
  let y = headerH;
  for (const q of shown) {
    const lines = wrapText(q.question, CARD_WIDTH - pad * 2, 21, 2);
    const answers = q.answers.slice(0, MAX_ROWS);
    blocks.push({ lines, answers, hidden: q.answers.length - answers.length, base: q.base, top: y });
    y += lines.length * 27 + 10 + answers.length * rowH + (q.answers.length > answers.length ? 20 : 0) + qGap;
  }
  const footerTop = y + (hiddenQs > 0 ? 26 : 0);
  const height = footerTop + 150;

  const labelW = 270;
  const trackX = pad + labelW + 20;
  const trackW = CARD_WIDTH - pad - trackX - 82;

  const body = blocks
    .map((b) => {
      const qText = b.lines
        .map(
          (l, i) =>
            `<text x="${pad}" y="${b.top + 20 + i * 27}" font-size="21" font-weight="600" fill="${INK}">${esc(l)}</text>`,
        )
        .join("");
      const barsTop = b.top + b.lines.length * 27 + 10;
      const bars = b.answers
        .map((a, i) => {
          const ry = barsTop + i * rowH;
          const pct = Math.round(a.share * 100);
          const w = Math.max(2, Math.round(trackW * Math.max(0, Math.min(1, a.share))));
          const label = wrapText(a.answer, labelW, 16, 1)[0] ?? "";
          return [
            `<text x="${pad}" y="${ry + 15}" font-size="16" fill="${INK}" fill-opacity="0.85">${esc(label)}</text>`,
            `<rect x="${trackX}" y="${ry + 3}" width="${trackW}" height="15" rx="3" fill="${INK}" opacity="0.07"/>`,
            `<rect x="${trackX}" y="${ry + 3}" width="${w}" height="15" rx="3" fill="${a.fill}"/>`,
            `<text x="${trackX + trackW + 12}" y="${ry + 15}" font-size="16" font-weight="600" fill="${INK}">${pct}%</text>`,
          ].join("");
        })
        .join("");
      const more =
        b.hidden > 0
          ? `<text x="${pad}" y="${barsTop + b.answers.length * rowH + 14}" font-size="13" fill="${MUTED}">+${b.hidden} further answer${b.hidden === 1 ? "" : "s"} not shown</text>`
          : "";
      const baseNote = `<text x="${CARD_WIDTH - pad}" y="${b.top + 20}" font-size="13" text-anchor="end" fill="${MUTED}">n = ${b.base.toLocaleString("en-GB")}</text>`;
      return qText + baseNote + bars + more;
    })
    .join("\n");

  const facts = [
    `n = ${input.base.toLocaleString("en-GB")}`,
    input.marginPoints !== null ? `±${input.marginPoints.toFixed(1)} pts at 95%` : null,
    input.weighted ? "weighted" : "unweighted",
    input.fieldwork || null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const stamp = unfit
    ? [
        `<rect x="${pad}" y="126" width="${CARD_WIDTH - pad * 2}" height="34" rx="6" fill="${WARN}" opacity="0.1"/>`,
        `<text x="${pad + 12}" y="149" font-size="16" font-weight="700" fill="${WARN}">NOT FIT TO PUBLISH — ${esc(
          wrapText(input.blockers.join("; "), CARD_WIDTH - pad * 2 - 230, 16, 1)[0] ?? "",
        )}</text>`,
      ].join("")
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}" font-family="Georgia, 'Times New Roman', serif" role="img" aria-label="${esc(
    `Topline results, ${shown.length} question${shown.length === 1 ? "" : "s"}, ${input.pollName}`,
  )}">
<rect width="${CARD_WIDTH}" height="${height}" fill="${SAND}"/>
<text x="${pad}" y="${pad + 6}" font-size="13" letter-spacing="3" fill="${SEA_DEEP}">POLIMETER</text>
<text x="${pad}" y="${pad + 46}" font-size="32" font-weight="600" fill="${INK}">${esc(input.pollName)}</text>
<text x="${pad}" y="${pad + 72}" font-size="15" fill="${MUTED}">Topline results${
    input.fieldwork ? ` · ${esc(input.fieldwork)}` : ""
  }</text>
${stamp}
${body}
${hiddenQs > 0 ? `<text x="${pad}" y="${footerTop - 8}" font-size="14" fill="${MUTED}">+${hiddenQs} further question${hiddenQs === 1 ? "" : "s"} not shown</text>` : ""}
<line x1="${pad}" y1="${footerTop + 18}" x2="${CARD_WIDTH - pad}" y2="${footerTop + 18}" stroke="${INK}" stroke-opacity="0.12"/>
<text x="${pad}" y="${footerTop + 48}" font-size="16" fill="${INK}" fill-opacity="0.75">${esc(facts)}</text>
<text x="${pad}" y="${footerTop + 74}" font-size="14" fill="${MUTED}">${esc(
    input.companyName
      ? `Fieldwork by ${input.companyName}. Automated telephone interviews, disclosed as automated.`
      : "Automated telephone interviews, disclosed as automated.",
  )}</text>
<text x="${pad}" y="${footerTop + 98}" font-size="14" fill="${SEA_DEEP}">${esc(input.url)}</text>
${qrPath(input.url, CARD_WIDTH - pad - 88, footerTop + 26, 88)}
</svg>`;
}
