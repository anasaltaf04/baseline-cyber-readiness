import type { Action } from '../types';

const EFFORT_COPY: Record<Action['effort'], string> = {
  low: 'Quick win',
  medium: 'An afternoon',
  high: 'A project',
};

const EFFORT_TONE: Record<Action['effort'], string> = {
  low: 'bg-green-50 text-good ring-green-200',
  medium: 'bg-amber-50 text-ok ring-amber-200',
  high: 'bg-orange-50 text-warn ring-orange-200',
};

export default function ActionCard({ action, index }: { action: Action; index: number }) {
  return (
    <article className="print-block print-tight rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand-dark"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-snug text-ink">{action.title}</h3>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${EFFORT_TONE[action.effort]}`}
            >
              {EFFORT_COPY[action.effort]}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-ink-soft ring-1 ring-inset ring-slate-200">
              {action.estimated_cost}
            </span>
          </div>

          <p className="mt-3 text-ink-soft">{action.why_it_matters}</p>

          <h4 className="mt-4 text-sm font-semibold text-ink">What to do</h4>
          <ol className="mt-2 space-y-2 text-ink-soft">
            {action.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span aria-hidden="true" className="select-none text-muted">
                  {i + 1}.
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  );
}
