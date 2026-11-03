import Link from "next/link";

/**
 * The Polimeter landing page.
 *
 * Two decisions worth stating, because both are load-bearing and both look
 * like restraint rather than work.
 *
 * **No client JavaScript and no web font.** The Worker runs at about 2.14 MB
 * gzipped against a 3 MB ceiling and this page is the cheapest thing in it;
 * the serif is a system stack (see `tailwind.config.ts`). Nothing here needs
 * hydrating, so nothing is.
 *
 * **The persuasion is specifics, not adjectives.** The two strongest assets
 * are the verbatim line every respondent hears and the disclosure table a
 * published figure travels with — both are real artefacts of the product, and
 * both are reproduced here rather than described. A polling brand whose
 * product is credibility cannot claim rigour; it can only exhibit it.
 */

// Quoted exactly as the agent says it. Paraphrasing it here would be the one
// unforgivable edit on this page: a poller that discloses its calls are
// automated should be willing to show the wording, unaltered.
const OPENING_LINE =
  "Hello, my name is Nina. I'm an automated assistant calling on behalf of " +
  "CayWorks, an independent research company in the Cayman Islands. We are " +
  "conducting a short public opinion survey. This call is recorded, and your " +
  "answers are anonymous. Is it all right to continue?";

const DISCLOSURE: [string, string][] = [
  ["Fieldwork", "2 to 5 November 2026"],
  ["Population", "Adults aged 18 and over resident in the Cayman Islands"],
  [
    "Method",
    "Automated telephone interview conducted by an AI interviewer, disclosed as automated at the start of every call",
  ],
  ["Sample", "612 interviews from 4,120 numbers dialled"],
  ["Cooperation rate", "41%"],
  ["Weighting", "Raked to registered electors by district"],
  ["Effective sample", "528 after a design effect of 1.16"],
  ["Margin of error", "±4.3 points at 95% confidence"],
  ["Answer order", "Rotated; the order each respondent heard is recorded"],
];

const REFUSALS: [string, string][] = [
  [
    "Fewer than a hundred respondents",
    "A headline figure needs a base that can carry it. Below the floor the number is marked unfit to quote and the reason is printed beside it.",
  ],
  [
    "Weights that will not converge",
    "If raking cannot reconcile the sample with the population targets, the weighted figures are unreliable and are not presented as results.",
  ],
  [
    "One interview moving the answer",
    "Where a single respondent carries enough weight to shift the finding, the figure is withheld until the group is better represented.",
  ],
  [
    "A subgroup too small to report",
    "District and demographic breakdowns carry their own base and their own verdict. A subgroup that cannot be published arrives marked, not quietly charted.",
  ],
];

export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen bg-sand">
      <header className="border-b border-ink/[0.07]">
        <div className="container-tight flex items-center justify-between py-5">
          <Link href="/" className="group flex items-baseline gap-2.5">
            <span className="font-serif text-xl font-semibold tracking-tight text-ink">
              Polimeter
            </span>
            <span className="hidden text-[0.7rem] uppercase tracking-[0.18em] text-ink/40 sm:inline">
              A Cayworks platform
            </span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#method" className="hidden text-ink/60 transition hover:text-ink sm:inline">
              Method
            </a>
            <a href="#standards" className="hidden text-ink/60 transition hover:text-ink sm:inline">
              Standards
            </a>
            <Link href="/admin/login" className="text-ink/60 transition hover:text-ink">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero. One claim, stated plainly, with the qualifier inside it rather
          than in a disclaimer underneath — which is the whole posture of the
          product compressed into a sentence. */}
      <section className="container-tight pt-20 pb-16 sm:pt-28 sm:pb-20">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-sea-deep">
          Cayman Islands · Public opinion research
        </p>
        <h1 className="mt-7 max-w-3xl font-serif text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-ink sm:text-6xl">
          Public opinion, properly measured.
          <span className="mt-2 block text-ink/55">And the error shown beside it.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink/70">
          Polimeter calls a sample across all nineteen districts on a Cayman
          line, reads your questions exactly as written, and records each
          answer as it is given. Results come back weighted, with the margin of
          error taken from the effective sample — and with a plain warning when
          a figure is not fit to publish.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href="mailto:info@cayworks.com?subject=Commission%20a%20poll"
            className="btn-primary"
          >
            Commission a poll
          </a>
          <a href="#method" className="btn-secondary">
            Read the method
          </a>
        </div>

        <dl className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-ink/[0.07] bg-ink/[0.07] sm:grid-cols-3">
          {(
            [
              ["Nineteen", "districts covered on every national sample"],
              ["During the call", "when each answer is written down"],
              ["Effective sample", "what the margin of error is taken from"],
            ] as const
          ).map(([figure, label]) => (
            <div key={figure} className="bg-sand px-6 py-7">
              <dt className="font-serif text-2xl font-semibold tracking-tight text-ink">
                {figure}
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-ink/60">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The verbatim opening. The single most persuasive element available,
          because it is the thing a respondent actually hears and it is
          reproduced without softening. */}
      <section className="border-y border-ink/[0.07] bg-white">
        <div className="container-tight py-16 sm:py-20">
          <h2 className="text-[0.7rem] uppercase tracking-[0.2em] text-sea-deep">
            Every call opens like this
          </h2>
          <blockquote className="mt-7 max-w-3xl font-serif text-xl leading-[1.6] text-ink sm:text-2xl">
            &ldquo;{OPENING_LINE}&rdquo;
          </blockquote>
          <p className="mt-7 max-w-2xl text-sm leading-relaxed text-ink/60">
            No respondent is left guessing whether they are speaking to a
            person. Anyone who asks to be taken off the list is removed
            immediately and permanently, calls are placed only within Cayman
            calling hours, and no answer is ever stored against a telephone
            number.
          </p>
        </div>
      </section>

      {/* Method, as the disclosure table itself. A research buyer recognises
          this format; a marketing page describing it would not land. */}
      <section id="method" className="container-tight scroll-mt-20 py-16 sm:py-24">
        <div className="max-w-2xl">
          <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            The method, published with the number
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink/70">
            Every figure leaves Polimeter with the block below attached,
            assembled from the poll itself rather than written afterwards. It
            is what makes a number quotable, and it is ready to print beside
            it.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-ink/[0.07] bg-white shadow-card">
          <dl className="divide-y divide-ink/[0.07]">
            {DISCLOSURE.map(([term, value]) => (
              <div key={term} className="grid gap-1 px-6 py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
                <dt className="text-xs font-semibold uppercase tracking-wider text-ink/50">
                  {term}
                </dt>
                <dd className="text-sm leading-relaxed text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-4 text-xs text-ink/40">
          Illustrative figures, shown in the format every Polimeter release
          carries.
        </p>
      </section>

      {/* The differentiator. A competitor can copy any feature on this page
          except this one, because copying it means surrendering publishable
          numbers. */}
      <section id="standards" className="scroll-mt-20 border-y border-ink/[0.07] bg-white">
        <div className="container-tight py-16 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              What Polimeter will not publish
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink/70">
              Most of what a pollster is worth is in the figures it declines to
              stand behind. Polimeter refuses them in the product, in writing,
              with the reason attached — so a commissioned poll can tell you
              what it does not know.
            </p>
          </div>

          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {REFUSALS.map(([title, body]) => (
              <div key={title} className="border-t border-ink/10 pt-5">
                <h3 className="text-sm font-semibold text-ink">{title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ink/65">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Remaining capabilities, kept brief and after the standards section —
          they are reasons to choose Polimeter once credibility is settled, not
          before. */}
      <section className="container-tight py-16 sm:py-24">
        <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Built for results that have to survive scrutiny
        </h2>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {(
            [
              [
                "Answers, not impressions",
                "Each answer is written down during the call, question by question — not inferred afterwards from a summary of what the interviewer thought they heard.",
              ],
              [
                "Order does not decide",
                "Answer options are read in a different order to each respondent and the order they heard is recorded against the call. Read a list the same way every time and the first option gains points it never earned.",
              ],
              [
                "Weighted, and honest about it",
                "Raked to population targets, with the margin of error taken from the effective sample rather than the raw count, so weighting cannot quietly flatter a result.",
              ],
              [
                "Questions worth asking",
                "Question sets with balanced scales, an explicit way to say “don’t know”, and the reasoning for the wording kept beside it, so a tracker stays comparable between waves.",
              ],
              [
                "Delivered to the campaign",
                "Toplines, breakdowns and the disclosure block can be delivered straight into a campaign’s own dashboard — aggregates only, with the publication verdict travelling beside every figure.",
              ],
              [
                "Nothing held against a number",
                "Telephone numbers are stored only as a one-way hash. Answers are recorded against the call, never against the person, and the anonymity promised on every call is enforced by the schema rather than by policy.",
              ],
            ] as const
          ).map(([title, body]) => (
            <div key={title} className="border-t border-ink/10 pt-5">
              <h3 className="text-sm font-semibold text-ink">{title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-ink/65">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/[0.07] bg-ink">
        <div className="container-tight py-16 sm:py-20">
          <h2 className="max-w-2xl font-serif text-3xl font-semibold leading-tight tracking-tight text-sand sm:text-4xl">
            Commission a poll that tells you what it does not know.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-sand/70">
            Fieldwork across the nineteen districts, weighted results with the
            margin shown, and a disclosure block ready to publish.
          </p>
          <div className="mt-9">
            <a
              href="mailto:info@cayworks.com?subject=Commission%20a%20poll"
              className="inline-flex items-center justify-center rounded-xl bg-sand px-5 py-3 text-sm font-medium text-ink transition hover:bg-sand-warm"
            >
              Start a conversation
            </a>
          </div>
        </div>
      </section>

      <footer className="container-tight py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm text-ink/45">
          <p>
            Polimeter is a Cayworks platform. © {new Date().getFullYear()}{" "}
            Cayworks, Cayman Islands.
          </p>
          <a href="mailto:info@cayworks.com" className="transition hover:text-ink/70">
            info@cayworks.com
          </a>
        </div>
      </footer>
    </main>
  );
}
