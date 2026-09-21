import type { SectionScore } from '../types';

function barTone(score: number): string {
  if (score >= 80) return 'bg-good';
  if (score >= 60) return 'bg-ok';
  if (score >= 40) return 'bg-warn';
  return 'bg-bad';
}

export default function SectionBars({ sections }: { sections: SectionScore[] }) {
  return (
    <ul className="space-y-4">
      {sections.map((section) => (
        <li key={section.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-ink">{section.title}</span>
            <span className="text-sm tabular-nums text-muted">
              {section.answered_well} of {section.question_count} in place
              <span className="ml-2 font-semibold text-ink-soft">{section.score}%</span>
            </span>
          </div>
          <div
            className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-line"
            role="meter"
            aria-valuenow={section.score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${section.title}: ${section.score} percent`}
          >
            <div
              className={`h-full rounded-full ${barTone(section.score)}`}
              style={{ width: `${Math.max(section.score, 1.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
