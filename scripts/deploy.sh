#!/usr/bin/env bash
#
# One command: test, build, deploy, and record the evidence judges asked for.
#
#   ./scripts/deploy.sh                          first deploy (placeholder page)
#   ./scripts/deploy.sh -c alertEmail=you@x.com  with budget and alarm emails
#
# Any arguments are passed through to `cdk deploy`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE="$ROOT/docs/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$EVIDENCE"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# Account ids are not secret, but they are not worth publishing either.
redact() { sed -E 's/[0-9]{12}/<ACCOUNT-ID>/g'; }

say "Who am I?"
aws sts get-caller-identity | redact | tee "$EVIDENCE/sts-identity-$STAMP.txt"

say "Backend tests"
( cd "$ROOT/backend" && python3 -m pytest ) 2>&1 | tee "$EVIDENCE/pytest-$STAMP.txt"

say "Building the frontend"
( cd "$ROOT/frontend" && npm ci --silent && npm run build )

say "Deploying"
(
  cd "$ROOT/infra"
  npm ci --silent
  npx cdk deploy --require-approval never "$@"
) 2>&1 | redact | tee "$EVIDENCE/cdk-deploy-$STAMP.txt"

say "Done"
grep -E 'SiteUrl|ApiEndpoint' "$EVIDENCE/cdk-deploy-$STAMP.txt" || true
