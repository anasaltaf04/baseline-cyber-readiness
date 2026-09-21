/**
 * Generates the browser's copy of the question bank from the backend's.
 *
 * The backend file is the single source of truth, but it also holds the
 * remediation copy the report is built from. Shipping that to the browser
 * would hand the questionnaire its own answer key, so it is stripped here.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', 'backend', 'questions.json');
const target = join(here, '..', 'src', 'questions.generated.json');

const bank = JSON.parse(readFileSync(source, 'utf8'));

const output = {
  version: bank.version,
  framework: bank.framework,
  framework_note: bank.framework_note,
  sections: bank.sections,
  questions: bank.questions.map((q) => ({
    id: q.id,
    section: q.section,
    text: q.text,
    help: q.help,
    safeguards: q.safeguards,
  })),
};

const serialized = JSON.stringify(output, null, 2);
if (serialized.includes('remediation') || serialized.includes('why_it_matters')) {
  throw new Error('remediation copy leaked into the browser bundle');
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, serialized + '\n');
console.log(
  `questions.generated.json: ${output.questions.length} questions, ` +
    `${output.sections.length} sections`,
);
