import { Link, Route, Routes } from 'react-router-dom';

import Landing from './pages/Landing';
import Questionnaire from './pages/Questionnaire';
import ReportPage from './pages/Report';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg"
      >
        Skip to content
      </a>

      <header className="no-print border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span aria-hidden="true">🛡️</span>
            Baseline
          </Link>
          <span className="hidden text-sm text-muted sm:inline">
            Cyber readiness for small business
          </span>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/check" element={<Questionnaire />} />
          <Route path="/r/:id" element={<ReportPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="no-print border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted">
          <p>
            Baseline scores your answers against the CIS Critical Security Controls v8,
            Implementation Group 1 — the baseline set of practices recommended for small
            organisations. Question wording is our own.
          </p>
          <p className="mt-2">
            We do not need your name or email. Reports are deleted automatically after 90 days.
          </p>
        </div>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-muted">That link does not go anywhere.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark"
      >
        Go to the start
      </Link>
    </div>
  );
}
