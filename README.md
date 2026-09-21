# Baseline — cyber readiness for small businesses

A dental office, an accounting firm, an auto shop, a small nonprofit. The owner
knows they should "do something about cyber security" but cannot afford a
consultant and does not speak the language.

Baseline asks 26 plain-English questions, takes about ten minutes, and returns:

1. **A readiness score out of 100**, mapped to the CIS Critical Security
   Controls v8, Implementation Group 1 — the baseline set of practices
   recommended for small organisations.
2. **A 30-day action plan** written for a business owner, not an IT department:
   what to do, why it matters, what it costs, and roughly how long it takes.
3. **A printable report** on a private link they can hand to an insurer, a
   client, or an accountant.

No account. No name or email required. Reports delete themselves after 90 days.

---

## How it fits together

```
Browser ──── CloudFront (OAC, HTTPS, CSP/HSTS) ─┬─ S3        static site
                                                │
                                                └─ /assessments*
                                                     │
                                              API Gateway (HTTP API, 10 rps)
                                                     │
                                         ┌───────────┴───────────┐
                                    POST /assessments     GET /assessments/{id}
                                         │                       │
                                   Lambda (create)          Lambda (get)
                                    │         │                  │
                              Bedrock     DynamoDB ──────────────┘
                              (Haiku)     (90-day TTL)
```

The API is served from the **same origin** as the app. That removes CORS from
the browser's path entirely, lets the Content-Security-Policy keep
`connect-src` on `'self'`, and means an unconfigured deployment denies
cross-origin requests rather than allowing them.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

| Path        | What is in it |
|-------------|---------------|
| `backend/`  | Lambda handlers, the question bank, scoring, validation, plan generation, tests |
| `infra/`    | AWS CDK app — one stack, `us-east-1` |
| `frontend/` | React + Vite + TypeScript + Tailwind |
| `docs/`     | Architecture, agent build log, submission write-up, deploy evidence |
| `scripts/`  | `deploy.sh` and `smoke-test.sh` |

---

## Running it

### Prerequisites

- Node.js 20+, Python 3.12+, and the AWS CLI configured for an account you own
- Bedrock model access enabled for the Anthropic Haiku-class model in
  `us-east-1` (Bedrock console → Model access). **Do this first** — it is the
  one step that cannot be done from code, and without it the app silently uses
  its fallback plan. Check `plan.source` in any response to tell which you got.
- A bootstrapped CDK environment: `npx cdk bootstrap aws://<account>/us-east-1`

### Tests

```bash
cd backend
pip install -r requirements-dev.txt
python3 -m pytest          # 166 tests, no AWS access needed
```

### Deploy

Full runbook, including the GitHub Actions route with no stored credentials:
**[`docs/DEPLOY.md`](docs/DEPLOY.md)**. The short version:

```bash
npx cdk bootstrap aws://<account-id>/us-east-1     # once
./scripts/deploy.sh -c alertEmail=you@example.com
```

That runs the tests, builds the frontend, deploys the stack, and writes the
terminal output to `docs/evidence/` with account ids redacted. It prints the
public URL when it finishes.

The first deploy works before the frontend is built — the stack ships a
placeholder page so the public URL is live immediately. Subsequent deploys
upload the real build.

### Check it works

```bash
./scripts/smoke-test.sh https://<your-distribution>.cloudfront.net
```

This asserts the security headers are present, creates a real assessment,
fetches it back, and confirms malformed input is rejected.

### Local development

```bash
cd frontend && npm install && npm run dev
```

The dev server proxies `/assessments` to `VITE_API_TARGET`, mirroring how
CloudFront routes it in production.

### Configuration

All optional, passed as CDK context (`-c key=value`):

| Key | Default | Purpose |
|-----|---------|---------|
| `alertEmail` | unset | Budget and Lambda-error alarm notifications. No address is committed to this repo; without it those notifications stay off and the stack says so in its outputs. |
| `monthlyBudgetUsd` | `20` | AWS Budgets threshold |
| `modelId` | `anthropic.claude-haiku-4-5` | Bedrock model. If your account requires a cross-region inference profile, use `us.anthropic.claude-haiku-4-5` — the stack detects the prefix and grants the profile ARN plus its underlying foundation models. |

---

## How the score works

The question bank in `backend/questions.json` is the single source of truth.
Each of the 26 questions carries its IG1 safeguard mapping and the remediation
copy the fallback plan is built from. 42 distinct IG1 safeguards are covered
across six sections.

Answers are weighted `Yes 1.0 · Partly 0.5 · No 0 · Not sure 0`, and the score
is the weighted percentage. **It is computed in Python, never by the model.**
Given the same answers it returns the same number every time — there are tests
asserting determinism, key-order independence, and that improving any single
answer can never lower the score.

The model writes the plan's wording. It never writes the score.

## What the model is and is not told

`build_model_input()` assembles exactly what Bedrock sees: the score, the
section breakdown, the failed and partial safeguards, the industry, and the
headcount. Nothing else.

There is no field in that payload a user can type free text into. Business name
and contact email are optional, stored, and never sent — with a test asserting
it.

Every field that comes back is validated or clamped before it reaches a
browser: wrong types, missing fields, forty actions, or an effort level of
"catastrophic" are all handled. If anything at all fails, the app falls back to
a complete plan built from the question bank. **That fallback is not a
degraded mode** — it is the same human-written advice, and the report never
shows an error because a model call timed out.

## Security

This is a security product, so the practices it recommends are the ones it
follows.

- **Least-privilege IAM.** The create Lambda has `dynamodb:PutItem` on one
  table ARN and `bedrock:InvokeModel` on one model ARN. The get Lambda has
  `dynamodb:GetItem` and nothing else. Not `grantWriteData()`, which would also
  hand over `UpdateItem`, `DeleteItem` and the batch calls.
- **No PII required.** Name and email are optional and never leave the account.
- **Strict input validation.** Everything is checked against the question bank.
  Unknown keys are rejected rather than ignored, and body size is checked
  before parsing.
- **Unguessable links.** Report ids are 128 bits of URL-safe randomness. A
  report cannot be enumerated.
- **Throttling.** 10 requests per second, burst 20.
- **Headers.** CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and
  `frame-ancestors 'none'` on every response.
- **Private storage.** The S3 bucket is reachable only through CloudFront
  Origin Access Control; public access is blocked at the bucket.
- **No secrets in the repo.** No access keys, no contact addresses, nothing to
  leak. Deployment uses your own AWS credentials.

## Cost

Comfortably inside the AWS Free Tier for demo traffic. DynamoDB is on-demand,
Lambda and API Gateway are per-request, CloudFront serves a ~65 KB gzipped
bundle, and the only per-use cost of substance is one small Bedrock call per
assessment. A $20/month budget alert is deployed as a backstop.

## Licence and attribution

Baseline paraphrases the intent of CIS Controls v8 IG1 safeguards in its own
wording. It does not reproduce CIS text, and it is not affiliated with,
endorsed by, or certified by the Center for Internet Security.

A Baseline report is not a certification, an audit, or legal advice.
