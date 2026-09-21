# Agent build log

A record of each session in which a coding agent worked on Baseline: what it
was asked to do, what it created or changed, and what it had to resolve.
Terminal output is in [`evidence/`](evidence/) with account ids redacted.

---

## Session 1 — 21 September 2026

**Agent:** Claude Code (Claude Opus 5), running in a cloud session against a
fresh, empty repository.

**Asked to do:** Build Baseline from the product specification — the question
bank, scoring, API, infrastructure, frontend, and documentation — in a new
repository rather than inside the existing coursework repo.

### AWS resources created or changed

**None.** No AWS resource was created, changed, or deleted in this session.
The container's AWS credentials were placeholders, and
`sts.get_caller_identity()` returned `InvalidClientTokenId`. The stack is
written and synthesises, but has not been deployed.

Everything in `infra/` was verified by generating the CloudFormation template
(`npx cdk synth`) and reading it, not by deploying it. See **Not yet verified**
below for exactly what that leaves open.

### Built

| Area | What was produced |
|---|---|
| `backend/questions.json` | 26 questions, six sections, covering 42 distinct CIS v8 IG1 safeguards, each with plain-English remediation copy |
| `backend/baseline/` | Question bank loader, deterministic scoring, strict validation, Bedrock plan generation with a static fallback, DynamoDB storage, two Lambda handlers |
| `backend/tests/` | 166 tests, passing, needing no AWS access or network |
| `infra/` | One CDK stack: CloudFront + S3 (OAC), HTTP API, two Lambdas, DynamoDB, CloudWatch dashboard and alarm, AWS Budgets |
| `frontend/` | React + Vite + TypeScript + Tailwind; landing, questionnaire, report |
| `docs/` | This log, the architecture write-up and diagram, the submission write-up |
| `scripts/` | `deploy.sh` (tests, builds, deploys, captures evidence) and `smoke-test.sh` |

### Decisions worth recording

**The API is served from the same origin as the app.** CloudFront routes
`assessments*` to API Gateway. This removes CORS from the browser's path, lets
the CSP keep `connect-src 'self'`, and makes an unconfigured deployment deny
cross-origin requests instead of allowing them. The Lambda omits the
allow-origin header entirely when `ALLOWED_ORIGIN` is unset, so the failure
mode is closed rather than `*`.

**boto3 `invoke_model` rather than the Anthropic SDK.** Keeps the Lambda free
of third-party dependencies, which keeps Docker and bundling out of the deploy
path. For a project whose first requirement is a live URL that never breaks,
that was the better trade.

**The stack deploys before the frontend exists.** If `frontend/dist` is
absent, the stack uploads a placeholder page instead, so the public URL is
live from the very first deploy — the ship gate in the build order.

**No contact address is committed.** Budget and alarm notifications come from
`-c alertEmail=...`. Without it the stack deploys and reports in its outputs
that those notifications are off.

### Problems found and resolved

1. **`plan.py` imported boto3 even when a client was injected**, so the unit
   tests could not exercise the Bedrock path at all — they silently took the
   fallback branch and three assertions failed on an empty call list. Moved
   the import inside the branch that actually constructs a client. Caught by
   the tests, fixed in the source rather than the test.

2. **The fallback plan put all eight actions in week 1.** The bank's
   highest-priority items all carry week 1, so selecting the top eight gaps
   produced a "30-day plan" that was entirely one Monday. Actions are now
   spread across the four weeks by rank, with the bank's own week as a floor
   so work needing a purchase is not pulled forward.

3. **A multi-line `<legend>` was struck through by the fieldset border.**
   Found by screenshotting the built app in Chromium. Floating the legend
   fixes the rendering while keeping the native grouping screen readers use.

4. **The step heading drew a focus ring on every step change.** The global
   `:focus-visible` rule outranked Tailwind's `outline-none`. Programmatic
   focus targets (`tabindex="-1"`) are now exempt — they are not in the tab
   order, so a ring only confuses sighted users.

5. **The header tagline collided with the logo at 390px.** Hidden below the
   `sm` breakpoint.

5b. **The first CI run failed on a check that was itself wrong.** The
   workflow grepped the built bundle for `why_it_matters` to prove the
   question bank's answer key had not shipped — but that is a field name on
   the report the API returns, so `ActionCard` renders `action.why_it_matters`
   and the identifier is legitimately in the bundle. The check was testing for
   an identifier when it should have been testing for content. Replaced with
   `frontend/scripts/check-bundle.mjs`, which asserts none of the bank's
   remediation *text* is present, that the bank itself is (so the first check
   cannot pass vacuously), and that no inline script was emitted. It is part
   of `npm run build`, and it was verified by deliberately injecting a leak
   and confirming the build fails.

6. **CloudFront's SPA fallback would have broken the API's 404s.** Mapping
   404 to `/index.html` is the usual way to make client-side routes work, but
   `CustomErrorResponses` is a property of the *distribution*, not of a cache
   behaviour — so it applied to the API too. `GET /assessments/<unknown-id>`
   would have returned the React app with status 200 instead of a 404, and
   the app could never have told a missing report from a real one. Found by
   reading the synthesised template, not by running it. Replaced with a
   CloudFront viewer-request function attached only to the site behaviour,
   which rewrites extension-less paths to `/index.html` and leaves the API's
   status codes alone.

7. **`minimumProtocolVersion` on the distribution did nothing.** CDK warned
   that it has no effect without a custom certificate. Removed rather than
   left in place, because a security setting that is not applied should not
   look like one that is.

### Verified

- 166 backend tests pass with no network or AWS access.
- `npx tsc --noEmit` is clean for both the CDK app and the frontend.
- `npx cdk synth` succeeds; the template was read to confirm least-privilege
  IAM (`dynamodb:PutItem` and `bedrock:InvokeModel` on single ARNs for create,
  `dynamodb:GetItem` for get), 10 rps / burst 20 throttling, the TTL
  attribute, Block Public Access, and the full security header set.
- The production frontend build was served locally and driven with Playwright:
  landing, questionnaire and report render with no console errors, answering
  works by keyboard alone, the Next button refuses to advance past unanswered
  questions and names how many are missing, there is no horizontal scroll at
  390px, the toolbar is hidden in print, and the report prints to a clean
  7-page PDF.
- The built bundle contains no inline script (so `script-src 'self'` holds)
  and none of the remediation copy.

### Not yet verified — needs a real deploy

Everything below is untested against AWS and should be treated as unproven
until `scripts/deploy.sh` has run:

- That the stack deploys cleanly and CloudFront serves the site.
- That `anthropic.claude-haiku-4-5` is the right model id for the target
  account, and that model access has been granted in the Bedrock console.
  **Until access is granted, the app works but every plan comes from the
  fallback** — check `plan.source` in the response or the CloudWatch logs.
  If the account requires a cross-region inference profile, redeploy with
  `-c modelId=us.anthropic.claude-haiku-4-5`; the stack widens the IAM grant
  to match.
- That the Bedrock response shape matches what `_invoke_model` parses.
- That CloudFront's `assessments*` behaviour forwards POST bodies as expected.

`scripts/smoke-test.sh <site-url>` checks all of these against a live stack
and writes nothing to the repository.
