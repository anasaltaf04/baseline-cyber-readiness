/**
 * Post-build assertions on what actually shipped.
 *
 * Checking for the *identifier* `why_it_matters` does not work: it is a field
 * on the report the API returns, so ActionCard renders `action.why_it_matters`
 * and the name is legitimately in the bundle. What must never ship is the
 * question bank's remediation *copy* — the text of the fallback plan.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const bank = JSON.parse(readFileSync(join(here, '..', '..', 'backend', 'questions.json'), 'utf8'));

const assets = readdirSync(join(dist, 'assets'))
  .map((f) => readFileSync(join(dist, 'assets', f), 'utf8'))
  .join('\n');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const failures = [];

// 1. No remediation copy — that is the questionnaire's answer key.
for (const q of bank.questions) {
  const r = q.remediation;
  for (const [field, text] of [
    ['title', r.title],
    ['why_it_matters', r.why_it_matters],
    ...r.steps.map((s, i) => [`steps[${i}]`, s]),
  ]) {
    if (assets.includes(text)) failures.push(`remediation copy shipped: ${q.id}.${field}`);
  }
}

// 2. The bank really is in there, so check 1 cannot pass vacuously.
if (!assets.includes(bank.questions[0].text)) {
  failures.push('the question bank is missing from the bundle — check 1 proved nothing');
}

// 3. The CSP forbids inline script, so the build must not produce any.
if (/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html)) {
  failures.push("index.html has an inline script, which script-src 'self' will block");
}

if (failures.length) {
  console.error('Bundle checks failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Bundle checks passed: no remediation copy, ${bank.questions.length} questions present, no inline script.`,
);
