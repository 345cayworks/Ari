import Link from "next/link";

/**
 * The Polimeter landing page.
 *
 * Three decisions worth stating, because each looks like restraint and is
 * actually the load-bearing choice.
 *
 * **No client JavaScript and no web font.** The Worker runs at about 2.08 MB
 * gzipped against a 3 MB ceiling and this page is the cheapest thing in it;
 * the serif is a system stack (see `tailwind.config.ts`). Nothing here needs
 * hydrating, so nothing is.
 *
 * **The persuasion is specifics, not adjectives.** The strongest assets are
 * the verbatim line every respondent hears, the sampling frame's arithmetic,
 * and the disclosure block a published figure travels with. All three are real
 * artefacts of the product and are reproduced here rather than described. A
 * polling brand whose product is credibility cannot claim rigour; it can only
 * exhibit it.
 *
 * **Nothing is claimed that the platform does not do.** An earlier version of
 * this page promised calls "across all nineteen districts" and counted that as
 * a headline figure. The platform does not do it and cannot: the frame is
 * mobile numbers, which carry no geography — number portability makes any
 * inference from a prefix worse, not better — and `lib/polling/census.ts`
 * rakes to the registered electorate across six areas, with the respondent's
 * own district established by asking. For a pollster selling the refusal to
 * overclaim, that sentence was the one unaffordable error on the page.
 */

// Quoted exactly as the agent says it. Paraphrasing it here would be the one
// unforgivable edit: a poller that discloses its calls are automated should be
// willing to show the wording, unaltered.
const OPENING_LINE =
  "Hello, my name is Nina. I'm an automated assistant calling on behalf of " +
  "CayWorks, an independent research company in the Cayman Islands. We are " +
  "conducting a short public opinion survey. This call is recorded, and your " +
  "answers are anonymous. Is it all right to continue?";

const DISCLOSURE: [string, string][] = [
  ["Fieldwork", "2 to 5 November 2026"],
  ["Population", "Adults aged 18 and over resident in the Cayman Islands"],
  ["Frame", "Random digit dial across 47 regulator-confirmed Cayman mobile exchanges"],
  [
    "Method",
    "Automated telephone interview conducted by an AI interviewer, disclosed as automated at the start of every call",
  ],
  ["Sample", "612 interviews from 4,120 numbers dialled"],
  ["Cooperation rate", "41%"],
  ["Weighting", "Raked to registered electors across the six areas"],
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
    "Area and demographic breakdowns carry their own base and their own verdict. A subgroup that cannot be published arrives marked, not quietly charted.",
  ],
];

/**
 * A hundred numbers drawn from the frame: filled ones reach a subscriber.
 *
 * Twenty-eight filled, because that is the frame's own starting estimate of
 * the share of Cayman mobile numbers that are assigned. The picture is here to
 * make an uncomfortable fact concrete rather than to decorate: most of what a
 * random-digit sample dials is nothing at all, and a competitor quoting a
 * cheaper price is either not dialling a probability sample or not telling you
 * about the seventy-two.
 */
function FrameDots(): JSX.Element {
  const dots = Array.from({ length: 100 }, (_, i) => ({
    x: (i % 20) * 16 + 8,
    y: Math.floor(i / 20) * 16 + 8,
    // 37 is coprime with 100, so this is a permutation of 0..99 and exactly
    // 28 fall under the threshold. Deterministic, but scattered: the obvious
    // `i % 25 < 7` also gives 28 and lays them in visible diagonal stripes,
    // which is a poor advertisement for a random draw.
    live: (i * 37 + 11) % 100 < 28,
  }));
  return (
    <svg
      viewBox="0 0 328 88"
      role="img"
      aria-label="A hundred numbers drawn at random: twenty-eight reach a subscriber, seventy-two do not."
      className="h-auto w-full max-w-md"
    >
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.live ? 4 : 3}
          fill={d.live ? "#0F6E8A" : "#0B1220"}
          opacity={d.live ? 1 : 0.14}
        />
      ))}
    </svg>
  );
}

export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen bg-sand">
      <header className="border-b border-ink/[0.07]">
        <div className="container-tight flex items-center justify-between py-5">
          <Link href="/" className="flex items-baseline gap-2.5">
            <span className="font-serif text-xl font-semibold tracking-tight text-ink">
              Polimeter
            </span>
            <span className="hidden text-[0.7rem] uppercase tracking-[0.18em] text-ink/40 sm:inline">
              A Cayworks platform
            </span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#frame" className="hidden text-ink/60 transition hover:text-ink sm:inline">
              Sampling
            </a>
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

      {/* Hero. One claim, with its qualifier inside the sentence rather than
          in a disclaimer underneath — the posture of the product compressed. */}
      <section className="container-tight pt-20 pb-16 sm:pt-28 sm:pb-20">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-sea-deep">
          Cayman Islands · Public opinion research
        </p>
        <h1 className="mt-7 max-w-3xl font-serif text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-ink sm:text-6xl">
          A poll you can show your working for.
          <span className="mt-2 block text-ink/55">Starting with how the sample was drawn.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink/70">
          Polimeter draws numbers at random from 470,000 Cayman mobile numbers,
          where every number has the same chance of being called. That is what
          a margin of error is defined over. Answers are recorded during the
          call, results are weighted to the registered electorate, and a figure
          that will not bear publication arrives marked, with the reason
          printed beside it.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <a href="mailto:info@cayworks.com?subject=Commission%20a%20poll" className="btn-primary">
            Commission a poll
          </a>
          <a href="#frame" className="btn-secondary">
            How the sample is drawn
          </a>
        </div>

        <dl className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-ink/[0.07] bg-ink/[0.07] sm:grid-cols-3">
          {(
            [
              ["470,000", "numbers in the frame, each equally likely to be drawn"],
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

      {/* The sampling frame. The one section a competitor cannot copy without
          building the same thing, and the reason the statistics are defined. */}
      <section id="frame" className="scroll-mt-20 border-y border-ink/[0.07] bg-sea-mist/40">
        <div className="container-tight py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-start">
            <div className="max-w-2xl">
              <h2 className="text-[0.7rem] uppercase tracking-[0.2em] text-sea-deep">
                The sampling frame
              </h2>
              <p className="mt-6 font-serif text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
                Every number has the same chance of being called.
              </p>
              <p className="mt-6 text-lg leading-relaxed text-ink/70">
                The frame is built from the 47 mobile exchanges the
                telecommunications regulator publishes as allocated, which comes
                to a universe of 470,000 possible numbers. A sample is drawn
                from it at random. Nothing is bought from a list broker, nobody
                volunteers, and no panel decides who gets asked.
              </p>
              <p className="mt-5 text-base leading-relaxed text-ink/65">
                It matters because a margin of error is only defined over a
                sample with known selection probabilities. Computed over a
                purchased list or a self-selecting panel, the same figure is
                decoration — it describes the arithmetic, not the country.
              </p>
            </div>

            <div className="rounded-2xl border border-ink/[0.07] bg-white p-7 shadow-card">
              <FrameDots />
              <p className="mt-6 text-sm font-semibold text-ink">
                Seventy-two of every hundred are nobody.
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-ink/65">
                Most numbers in the universe have no subscriber behind them, and
                no service can tell you which in advance — both paid screening
                providers were tested against this frame and both answer per
                block rather than per number. Dialling is the only test, so the
                dial is the screening step and a draw is sized accordingly.
              </p>
              <p className="mt-4 text-xs leading-relaxed text-ink/45">
                Illustrative at the frame&rsquo;s current estimate. The rate is
                remeasured from fieldwork as numbers resolve.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The verbatim opening. The most persuasive element available, because
          it is what a respondent hears and it is reproduced unsoftened. */}
      <section className="border-b border-ink/[0.07] bg-white">
        <div className="container-tight py-16 sm:py-20">
          <h2 className="text-[0.7rem] uppercase tracking-[0.2em] text-sea-deep">
            Every call opens like this
          </h2>
          <blockquote className="mt-7 max-w-3xl border-l-2 border-accent pl-6 font-serif text-xl leading-[1.6] text-ink sm:text-2xl">
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
          this format; a page describing it would not land. */}
      <section id="method" className="container-tight scroll-mt-20 py-16 sm:py-24">
        <div className="max-w-2xl">
          <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            The method, published with the number
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink/70">
            Every figure leaves Polimeter with the block below attached,
            assembled from the poll itself rather than written afterwards. It is
            what makes a number quotable, and it is ready to print beside it.
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
          Illustrative figures, shown in the format every Polimeter release carries.
        </p>
      </section>

      {/* The differentiator. A competitor can copy any feature on this page
          except this one, because copying it means surrendering numbers. */}
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

      {/* Remaining capabilities, after the standards section — they are reasons
          to choose Polimeter once credibility is settled, not before. */}
      <section className="container-tight py-16 sm:py-24">
        <h2 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Built for results that have to survive scrutiny
        </h2>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {(
            [
              [
                "A sample, not a list",
                "Numbers are drawn at random from the regulator-confirmed frame, and the draw is seeded and recorded so the selection can be reproduced after publication.",
              ],
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
                "Raked to population targets across the six areas, with the margin of error taken from the effective sample rather than the raw count, so weighting cannot quietly flatter a result.",
              ],
              [
                "Questions worth asking",
                "Question sets with balanced scales, an explicit way to say “don’t know”, and the reasoning for the wording kept beside it, so a tracker stays comparable between waves.",
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
            A probability sample of Cayman mobile numbers, weighted results with
            the margin shown, and a disclosure block ready to publish.
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
            Polimeter is a Cayworks platform. © {new Date().getFullYear()} Cayworks, Cayman
            Islands.
          </p>
          <a href="mailto:info@cayworks.com" className="transition hover:text-ink/70">
            info@cayworks.com
          </a>
        </div>
      </footer>
    </main>
  );
}
