import Link from "next/link";

export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sand to-sand-warm">
      <header className="container-tight flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-ink text-sand grid place-items-center font-bold">
            A
          </div>
          <span className="font-semibold tracking-tight">Ari</span>
        </div>
        <Link href="/admin/login" className="text-sm text-ink/70 hover:text-ink">
          Sign in
        </Link>
      </header>

      <section className="container-tight pt-16 pb-24 sm:pt-24">
        <p className="text-xs uppercase tracking-[0.2em] text-sea-deep mb-6">
          Private beta · A Cayworks platform
        </p>
        <h1 className="text-4xl sm:text-6xl font-semibold leading-[1.05] tracking-tight max-w-3xl">
          Your AI chief of staff.
          <br />
          <span className="text-sea-deep">Never sends without your tap.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-ink/70">
          Ari triages your inbox, drafts client communications, tracks
          commitments, and waits for your approval before anything reaches a
          client. Talk to her from your phone.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/admin/login" className="btn-primary">
            Sign in to dashboard
          </Link>
          <a
            href="mailto:info@cayworks.com?subject=Ari%20waitlist"
            className="btn-secondary"
          >
            Join the waitlist
          </a>
        </div>

        <div className="mt-20 grid gap-6 sm:grid-cols-3">
          <Feature
            title="Voice or text"
            body="Send a voice note from Telegram. She transcribes, thinks, and replies."
          />
          <Feature
            title="Always asks first"
            body="Every client message lands in your approval queue. Tap to send, edit, or cancel."
          />
          <Feature
            title="Remembers everything"
            body="Client preferences, project context, deadlines — captured and recalled when relevant."
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
