# Deploying Baseline

Two routes. Both end with a live CloudFront URL and the deploy evidence in
[`evidence/`](evidence/).

- **[GitHub Actions](#github-actions-recommended)** — no AWS credentials stored
  anywhere, and every push to `main` redeploys. Roughly ten minutes to set up.
- **[From your own machine](#from-your-own-machine)** — one command, nothing to
  configure.

Either way, do step 0 first.

---

## Step 0 — turn on Bedrock model access

**This cannot be done from code.** There is no IAM permission or CDK property
for it; it is a one-time toggle in the console.

1. Open the Bedrock console in **us-east-1** → **Model access**.
2. Request access to the Anthropic **Haiku-class** model. It is usually
   granted immediately.
3. Note the exact model id shown. The stack defaults to
   `anthropic.claude-haiku-4-5`.

If your account serves the model through a cross-region inference profile
instead, the id will start with `us.` — set `BEDROCK_MODEL_ID` (below) to that
value and the stack widens its IAM grant to match.

> **If you skip this step the app still works.** Every plan silently comes
> from the static fallback instead of Bedrock. To tell which you got, look at
> `plan.source` in the API response, or the `plan_source` field in the
> Lambda's CloudWatch logs.

---

## GitHub Actions (recommended)

### Step 1 — bootstrap CDK

Once per account and region, from a machine with administrator credentials.
There is no way to avoid this step; CDK needs to create its own deployment
roles before anything else can use them.

```bash
npx cdk bootstrap aws://<account-id>/us-east-1
```

### Step 2 — create the deploy role

Still with administrator credentials, from a clone of this repository:

```bash
aws cloudformation deploy \
  --template-file infra/github-oidc-role.yaml \
  --stack-name baseline-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides GitHubOwner=<your-github-user> GitHubRepo=baseline-cyber-readiness
```

If the account already uses GitHub Actions OIDC, add
`CreateOidcProvider=false` — an account may only have one provider per URL.

Then read back the role ARN:

```bash
aws cloudformation describe-stacks --stack-name baseline-github-oidc \
  --region us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue' --output text
```

The role is deliberately close to powerless. It cannot touch S3, DynamoDB,
Lambda or CloudFront directly — all it may do is step into CDK's own bootstrap
roles, and only from this repository, and only from `main`. A pull request,
including one from a fork, cannot assume it.

### Step 3 — tell GitHub about it

In the repository: **Settings → Secrets and variables → Actions → Variables →
New repository variable**.

| Variable | Required | Value |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | yes | The ARN from step 2 |
| `ALERT_EMAIL` | no | Where budget and alarm notifications go |
| `BEDROCK_MODEL_ID` | no | Only if it differs from `anthropic.claude-haiku-4-5` |

These are **variables, not secrets**. A role ARN is not sensitive — it is
useless to anyone who cannot produce a signed OIDC token naming this
repository. The deploy job skips itself while `AWS_DEPLOY_ROLE_ARN` is unset,
so nothing fails in the meantime.

### Step 4 — deploy

Push to `main`, or run the workflow by hand from the **Actions** tab. The job:

1. runs the backend tests, and stops if any fail,
2. builds the frontend,
3. assumes the role through OIDC and records the identity,
4. deploys the stack,
5. smoke tests the live URL,
6. commits the redacted output to `docs/evidence/` and prints the URL in the
   run summary.

---

## From your own machine

```bash
npx cdk bootstrap aws://<account-id>/us-east-1     # once
./scripts/deploy.sh -c alertEmail=you@example.com
./scripts/smoke-test.sh https://<distribution>.cloudfront.net
```

`deploy.sh` runs the tests, builds the frontend, deploys, and writes the
terminal output to `docs/evidence/` with account ids redacted. Commit that
directory afterwards.

---

## Checking it worked

`smoke-test.sh` asserts the security headers are present, creates a real
assessment, fetches it back, and confirms malformed input is rejected. It
writes nothing to the repository.

To confirm Bedrock is actually being used rather than the fallback:

```bash
curl -s -X POST https://<your-url>/assessments \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c '
import json
bank = json.load(open("backend/questions.json"))
print(json.dumps({"answers": {q["id"]: "no" for q in bank["questions"]}}))
')" | python3 -c 'import json,sys; print(json.load(sys.stdin)["plan"]["source"])'
```

`bedrock` means the model wrote the plan. `fallback` means it did not — revisit
step 0, then check the Lambda's CloudWatch logs for the reason.

---

## Tearing it down

```bash
cd infra && npx cdk destroy
```

The DynamoDB table is set to `RETAIN`, so it survives on purpose and must be
deleted by hand if you really want it gone. Everything else is removed.
