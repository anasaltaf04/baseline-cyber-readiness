import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import { ApiError, fetchAssessment } from '../api';
import ActionCard from '../components/ActionCard';
import ScoreGauge from '../components/ScoreGauge';
import SectionBars from '../components/SectionBars';
import type { Report } from '../types';

const WEEK_BLURB: Record<number, string> = {
  1: 'Start here. These give you the most protection for the least effort.',
  2: 'Next, once week one is done.',
  3: 'These take a little more setting up.',
  4: 'Finish the month with these.',
};

export default function ReportPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  // Coming straight from the questionnaire, the report is already in hand —
  // no need to re-fetch what we were just given.
  const handedOver = (location.state as { report?: Report } | null)?.report;

  const [report, setReport] = useState<Report | null>(handedOver ?? null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!handedOver);

  useEffect(() => {
    if (handedOver || !id) return;
    let cancelled = false;
    setLoading(true);
    fetchAssessment(id)
      .then((result) => !cancelled && setReport(result))
      .catch((err) => !cancelled && setError(err as ApiError))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, handedOver]);

  if (loading) return <Centered title="Loading your report…" />;

  if (error || !report) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold text-ink">We could not open that report</h1>
        <p className="mt-2 text-ink-soft">
          {error?.message ?? 'That report does not exist.'}
        </p>
        <Link
          to="/check"
          className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark"
        >
          Run a new check
        </Link>
      </div>
    );
  }

  const weeks = [1, 2, 3, 4].filter((week) =>
    report.plan.top_actions.some((action) => action.week === week),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <ReportToolbar id={report.id} />

      <section className="print-block rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
          <ScoreGauge score={report.score} label={report.band.label} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">
              Your readiness
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
              {report.band.label}
            </h1>
            <p className="mt-2 leading-relaxed text-ink-soft">{report.band.blurb}</p>
            <p className="mt-4 text-sm text-muted">
              Checked {new Date(report.created_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              {report.profile.headcount ? ` · about ${report.profile.headcount} people` : ''}
            </p>
          </div>
        </div>

        <p className="mt-8 border-t border-line pt-6 text-lg leading-relaxed text-ink-soft">
          {report.plan.summary}
        </p>
      </section>

      <section className="print-block mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold text-ink">How each area scored</h2>
        <p className="mt-1 text-sm text-muted">
          A low score here is not a failing grade — it is just where the work is.
        </p>
        <div className="mt-6">
          <SectionBars sections={report.sections} />
        </div>
      </section>

      {report.plan.top_actions.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Your next 30 days</h2>
          <p className="mt-1 text-ink-soft">
            {report.plan.top_actions.length} things to do, in the order that gets you the most
            protection soonest.
          </p>

          <div className="mt-8 space-y-10">
            {weeks.map((week) => (
              <div key={week}>
                <div className="flex items-baseline gap-3">
                  <h3 className="text-lg font-semibold text-ink">Week {week}</h3>
                  <p className="text-sm text-muted">{WEEK_BLURB[week]}</p>
                </div>
                <div className="mt-4 space-y-4">
                  {report.plan.top_actions
                    .filter((action) => action.week === week)
                    .map((action) => (
                      <ActionCard
                        key={action.title}
                        action={action}
                        index={report.plan.top_actions.indexOf(action)}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="print-block mt-8 rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <h2 className="text-xl font-semibold text-good">Nothing outstanding</h2>
          <p className="mt-2 text-ink-soft">
            You answered yes to every question. Run this check again in six months, or whenever
            you add staff or change systems.
          </p>
        </section>
      )}

      <section className="mt-10 rounded-xl border border-line bg-canvas p-5 text-sm leading-relaxed text-muted">
        <p>
          Scored against the CIS Critical Security Controls v8, Implementation Group 1. The score
          is calculated from your answers; the wording of the plan was drafted by a language model
          and checked against a fixed set of recommended actions.
        </p>
        <p className="mt-2">
          This report is not a certification, an audit, or legal advice. Keep the link private —
          anyone who has it can read this page. It is deleted automatically after 90 days.
        </p>
      </section>
    </div>
  );
}

function ReportToolbar({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const url = `${window.location.origin}/r/${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access can be refused; a prompt still lets them copy it.
      window.prompt('Copy this link:', url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="no-print mb-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-line bg-surface px-4 py-2.5 font-medium text-ink shadow-sm transition hover:bg-slate-50"
      >
        Print or save as PDF
      </button>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="rounded-lg border border-line bg-surface px-4 py-2.5 font-medium text-ink shadow-sm transition hover:bg-slate-50"
      >
        {copied ? 'Link copied' : 'Copy shareable link'}
      </button>
      <Link
        to="/check"
        className="rounded-lg px-4 py-2.5 font-medium text-brand transition hover:bg-brand-tint"
      >
        Run it again
      </Link>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
    </div>
  );
}

function Centered({ title }: { title: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-brand"
        role="status"
        aria-label={title}
      />
      <p className="mt-5 text-lg text-ink-soft">{title}</p>
    </div>
  );
}
