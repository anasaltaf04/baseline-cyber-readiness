import { Link } from 'react-router-dom';

import bank from '../questions.generated.json';

const POINTS = [
  {
    title: 'Plain English, start to finish',
    body: 'No jargon. Every question asks about something you already do or do not do, and explains why it is being asked.',
  },
  {
    title: 'A score you can show someone',
    body: 'Your answers are scored against the baseline practices recommended for small organisations — the same list insurers and larger clients ask about.',
  },
  {
    title: 'A plan for the next 30 days',
    body: 'Not a list of problems. A short, ordered set of things to do, with what each one costs and roughly how long it takes.',
  },
];

export default function Landing() {
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">
              Free · No account needed
            </p>
            <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
              Find out where your business actually stands on cyber security.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-soft">
              {bank.questions.length} plain-English questions, about ten minutes, and you get a
              readiness score and a 30-day action plan written for a business owner — not an IT
              department.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to="/check"
                className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                Start the free check
              </Link>
              <span className="text-sm text-muted">
                No name or email required to get your results.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-8 sm:grid-cols-3">
          {POINTS.map((point) => (
            <div key={point.title}>
              <h2 className="text-lg font-semibold text-ink">{point.title}</h2>
              <p className="mt-2 leading-relaxed text-ink-soft">{point.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-2xl font-semibold text-ink">What it covers</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Six areas, {bank.questions.length} questions. Each one maps to a specific recommended
            practice, so your score means something concrete.
          </p>
          <dl className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {bank.sections.map((section) => (
              <div key={section.id} className="rounded-xl border border-line bg-canvas p-5">
                <dt className="font-semibold text-ink">{section.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-ink-soft">{section.blurb}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 rounded-xl border border-line bg-canvas p-5 text-sm leading-relaxed text-ink-soft">
            <p>
              <span className="font-semibold text-ink">Who this is for:</span> businesses with
              roughly 5 to 50 staff and no dedicated IT or security person — a dental office, an
              accounting firm, an auto shop, a small nonprofit.
            </p>
            <p className="mt-2">
              <span className="font-semibold text-ink">A note on honesty:</span> answer as things
              actually are, not as you would like them to be. The plan is only useful if the score
              is real, and nobody else sees it.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
