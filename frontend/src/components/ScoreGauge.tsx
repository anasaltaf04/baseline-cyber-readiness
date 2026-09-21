interface Props {
  score: number;
  label: string;
}

/** Colour bands match the scoring bands in the backend. */
function toneFor(score: number): { stroke: string; text: string } {
  if (score >= 80) return { stroke: 'var(--color-good)', text: 'text-good' };
  if (score >= 60) return { stroke: 'var(--color-ok)', text: 'text-ok' };
  if (score >= 40) return { stroke: 'var(--color-warn)', text: 'text-warn' };
  return { stroke: 'var(--color-bad)', text: 'text-bad' };
}

export default function ScoreGauge({ score, label }: Props) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  // Three-quarter dial, rotated so it opens at the bottom.
  const sweep = 0.75;
  const tone = toneFor(score);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      role="img"
      aria-label={`Readiness score ${score} out of 100: ${label}`}
    >
      <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true">
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${circumference * sweep} ${circumference}`}
          transform="rotate(135 90 90)"
        />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${circumference * sweep * (score / 100)} ${circumference}`}
          transform="rotate(135 90 90)"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-5xl font-bold tabular-nums ${tone.text}`}>{score}</span>
        <span className="text-sm text-muted">out of 100</span>
      </div>
    </div>
  );
}
