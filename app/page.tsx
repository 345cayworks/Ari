import Link from "next/link";

// What every respondent actually hears, taken verbatim from the agent's
// opening line. Quoting it rather than paraphrasing is the point: a poller
// that discloses the call is automated should be willing to show the wording.
const OPENING_LINE =
  "Hello, my name is Nina. I'm an automated assistant calling on behalf of " +
  "CayWorks, an independent research company in the Cayman Islands. We are " +
  "conducting a short public opinion survey. This call is recorded, and your " +
  "answers are anonymous. Is it all right to continue?";

export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sand to-sand-warm">
      <header className="container-tight flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-ink text-sand grid place-items-center font-bold">
            C
          </div>
          <span className="font-semibold tracking-tight">Cayworks Polling</span>
        </div>
        <Link href="/admin/login" className="text-sm text-ink/70 hover:text-ink">
          Sign in
        </Link>
      </header>

      <section className="container-tight pt-16 pb-20 sm:pt-24">
        <p className="text-xs uppercase tracking-[0.2em] text-sea-deep mb-6">
          Cayman Islands · A Cayworks platform
        </p>
        <h1 className="text-4xl sm:text-6xl font-semibold leading-[1.05] tracking-tight max-w-3xl">
          Public opinion, properly measured.
          <br />
          <span className="text-sea-deep">By phone, at speed, with the error shown.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-ink/70">
          Automated interviewers call a sample across the nineteen districts on a
          Cayman line, read your questions exactly as written, and record each
          answer as it is given. Results come back weighted, with their margin of
          error — and with a plain warning when a figure is not fit to publish.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href="mailto:info@cayworks.com?subject=Commission%20a%20poll"
            className="btn-primary"
          >
            Commission a poll
          </a>
          <Link href="/admin/login" className="btn-secondary">
            Sign in to dashboard
          </Link>
        </div>
      </section>

      <section className="container-tight pb-20">
        <div className="card max-w-3xl">
          <h2 className="text-sm font-semibold tracking-wider uppercase text-sea-deep">
            Every call opens like this
          </h2>
          <blockquote className="mt-4 text-lg leading-relaxed text-ink/80">
            &ldquo;{OPENING_LINE}&rdquo;
          </blockquote>
          <p className="mt-4 text-sm text-ink/60">
            No respondent is left guessing whether they are speaking to a person.
            Anyone who asks to be taken off the list is removed immediately and
            permanently, and calls are placed only within Cayman calling hours.
          </p>
        </div>
      </section>

      <section className="container-tight pb-24">
        <h2 className="text-2xl font-semibold tracking-tight">
          Where polls usually go wrong, and what this does instead
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <Feature
            title="Answers, not impressions"
            body="Each answer is written down during the call, question by question — not inferred afterwards from a summary of what the interviewer thought they heard."
          />
          <Feature
            title="Order does not decide"
            body="Answer options are read in a different order to each respondent, and the order they heard is recorded against their call. Read a list the same way every time and the first option gains points it never earned."
          />
          <Feature
            title="Weighted, and honest about it"
            body="Raked to population targets, with the margin of error taken from the effective sample rather than the raw count — so weighting cannot quietly flatter a result."
          />
          <Feature
            title="It says when not to publish"
            body="Fewer than a hundred respondents, weights that will not converge, or a single interview moving the figure: the result is marked unfit to quote, with the reason written out."
          />
          <Feature
            title="A disclosure you can print"
            body="Fieldwork dates, population, method, sample, response rate, weighting and margin of error — assembled from the poll itself, ready to publish beside the number."
          />
          <Feature
            title="Questions worth asking"
            body="Templates with balanced scales, an explicit way to say “don’t know”, and the reasoning for the wording kept beside it, so a tracker stays comparable between waves."
          />
        </div>
      </section>

      <footer className="container-tight pb-10 text-sm text-ink/50">
        © {new Date().getFullYear()} Cayworks · Cayman Islands
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold tracking-wider uppercase text-sea-deep">
        {title}
      </h3>
      <p className="mt-3 text-ink/80 leading-relaxed">{body}</p>
    </div>
  );
}
