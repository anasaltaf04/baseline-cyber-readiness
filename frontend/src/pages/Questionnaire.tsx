import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, createAssessment } from '../api';
import bank from '../questions.generated.json';
import type { Answer, Profile, Question, QuestionBank } from '../types';

const BANK = bank as QuestionBank;

const OPTIONS: { value: Answer; label: string; hint: string }[] = [
  { value: 'yes', label: 'Yes', hint: 'This is fully in place today' },
  { value: 'partly', label: 'Partly', hint: 'Some of it, or only for some people' },
  { value: 'no', label: 'No', hint: 'This is not in place' },
  { value: 'not_sure', label: 'Not sure', hint: 'Scored the same as No' },
];

const INDUSTRIES = [
  { value: '', label: 'Prefer not to say' },
  { value: 'dental_or_medical', label: 'Dental, medical, or health' },
  { value: 'accounting_or_legal', label: 'Accounting, legal, or financial' },
  { value: 'auto_or_trades', label: 'Auto, trades, or services' },
  { value: 'retail_or_hospitality', label: 'Retail or hospitality' },
  { value: 'nonprofit', label: 'Nonprofit' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'construction', label: 'Construction' },
  { value: 'other', label: 'Something else' },
];

/** Step 0 is the optional profile; the rest are one step per section. */
const PROFILE_STEP = 0;

export default function Questionnaire() {
  const navigate = useNavigate();
  const [step, setStep] = useState(PROFILE_STEP);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [industry, setIndustry] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const bySection = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const question of BANK.questions) {
      const list = map.get(question.section) ?? [];
      list.push(question);
      map.set(question.section, list);
    }
    return map;
  }, []);

  const totalSteps = BANK.sections.length + 1;
  const section = step > PROFILE_STEP ? BANK.sections[step - 1] : null;
  const questions = section ? (bySection.get(section.id) ?? []) : [];
  const answeredCount = Object.keys(answers).length;
  const progress = Math.round((answeredCount / BANK.questions.length) * 100);

  const missing = questions.filter((q) => !answers[q.id]);
  const isLastStep = step === totalSteps - 1;

  // Moving between steps must move focus, or a screen reader user is left
  // reading the previous step.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  function choose(questionId: string, value: Answer) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setShowMissing(false);
  }

  function next() {
    if (missing.length) {
      setShowMissing(true);
      document
        .getElementById(`question-${missing[0].id}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setShowMissing(false);
    if (isLastStep) void submit();
    else setStep((s) => s + 1);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const profile: Profile = {};
    if (industry) profile.industry = industry;
    const staff = Number.parseInt(headcount, 10);
    if (Number.isFinite(staff) && staff >= 1 && staff <= 500) profile.headcount = staff;

    try {
      const report = await createAssessment(answers, profile);
      navigate(`/r/${report.id}`, { state: { report } });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Something went wrong.', 0));
      setSubmitting(false);
    }
  }

  if (submitting) return <Generating />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <ProgressHeader
        step={step}
        totalSteps={totalSteps}
        progress={progress}
        answeredCount={answeredCount}
        total={BANK.questions.length}
      />

      {error && <ErrorNotice error={error} onRetry={() => void submit()} />}

      {section === null ? (
        <ProfileStep
          industry={industry}
          headcount={headcount}
          onIndustry={setIndustry}
          onHeadcount={setHeadcount}
          headingRef={headingRef}
        />
      ) : (
        <section aria-labelledby="step-heading">
          <h1
            id="step-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
          >
            {section.title}
          </h1>
          <p className="mt-2 text-ink-soft">{section.blurb}</p>

          <ol className="mt-8 space-y-6">
            {questions.map((question) => (
              <li key={question.id} id={`question-${question.id}`}>
                <QuestionCard
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => choose(question.id, value)}
                  flagged={showMissing && !answers[question.id]}
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      {showMissing && missing.length > 0 && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-bad ring-1 ring-red-200">
          Please answer {missing.length === 1 ? 'the remaining question' : `all ${missing.length} remaining questions`} in
          this section. If you do not know, choose “Not sure”.
        </p>
      )}

      <div className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-6">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(PROFILE_STEP, s - 1))}
          disabled={step === PROFILE_STEP}
          className="rounded-lg px-5 py-3 font-medium text-ink-soft transition hover:bg-slate-100 disabled:invisible"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={next}
          className="rounded-lg bg-brand px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          {isLastStep ? 'See my results' : 'Next'}
        </button>
      </div>
    </div>
  );
}

function ProgressHeader({
  step,
  totalSteps,
  progress,
  answeredCount,
  total,
}: {
  step: number;
  totalSteps: number;
  progress: number;
  answeredCount: number;
  total: number;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between text-sm text-muted">
        <span>
          Step {step + 1} of {totalSteps}
        </span>
        <span aria-hidden="true">
          {answeredCount} of {total} answered
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${answeredCount} of ${total} questions answered`}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function ProfileStep({
  industry,
  headcount,
  onIndustry,
  onHeadcount,
  headingRef,
}: {
  industry: string;
  headcount: string;
  onIndustry: (v: string) => void;
  onHeadcount: (v: string) => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <section aria-labelledby="step-heading">
      <h1
        id="step-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold tracking-tight text-ink outline-none sm:text-3xl"
      >
        First, a little context
      </h1>
      <p className="mt-2 text-ink-soft">
        Both of these are optional and help us tailor your plan. We do not ask for your name,
        your business name, or your email.
      </p>

      <div className="mt-8 space-y-6 rounded-xl border border-line bg-surface p-6">
        <div>
          <label htmlFor="industry" className="block font-medium text-ink">
            What kind of business is it?
          </label>
          <select
            id="industry"
            value={industry}
            onChange={(e) => onIndustry(e.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-ink"
          >
            {INDUSTRIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="headcount" className="block font-medium text-ink">
            Roughly how many people work there?
          </label>
          <input
            id="headcount"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={headcount}
            onChange={(e) => onHeadcount(e.target.value)}
            placeholder="e.g. 12"
            aria-describedby="headcount-hint"
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-ink"
          />
          <p id="headcount-hint" className="mt-1.5 text-sm text-muted">
            Include part-time staff and contractors who use your systems.
          </p>
        </div>
      </div>
    </section>
  );
}

function QuestionCard({
  question,
  value,
  onChange,
  flagged,
}: {
  question: Question;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  flagged: boolean;
}) {
  return (
    <fieldset
      className={`rounded-xl border bg-surface p-5 ${
        flagged ? 'border-red-300 ring-2 ring-red-100' : 'border-line'
      }`}
    >
      <legend className="px-1 text-base font-semibold leading-snug text-ink">
        {question.text}
      </legend>
      <p className="mt-1 text-sm leading-relaxed text-muted">{question.help}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const id = `${question.id}-${option.value}`;
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                selected
                  ? 'border-brand bg-brand-tint ring-1 ring-brand'
                  : 'border-line hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <input
                id={id}
                type="radio"
                name={question.id}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span className="min-w-0">
                <span className="block font-medium text-ink">{option.label}</span>
                <span className="block text-sm leading-snug text-muted">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Generating() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-line border-t-brand"
        role="status"
        aria-label="Building your plan"
      />
      <h1 className="mt-6 text-2xl font-semibold text-ink" aria-live="polite">
        Building your action plan
      </h1>
      <p className="mt-2 text-ink-soft">
        We are scoring your answers and writing the steps for the next 30 days. This usually takes
        about fifteen seconds.
      </p>
    </div>
  );
}

function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-8 rounded-xl border border-red-200 bg-red-50 p-5">
      <h2 className="font-semibold text-bad">We could not finish your check</h2>
      <p className="mt-1 text-ink-soft">{error.message}</p>
      {error.details.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-ink-soft">
          {error.details.slice(0, 5).map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm text-muted">Your answers are still here — nothing was lost.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark"
      >
        Try again
      </button>
    </div>
  );
}
