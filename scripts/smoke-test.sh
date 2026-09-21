#!/usr/bin/env bash
#
# Proves a deployed stack actually works end to end.
#
#   ./scripts/smoke-test.sh https://d1234abcd.cloudfront.net
set -euo pipefail

SITE="${1:?usage: smoke-test.sh <site-url>}"
SITE="${SITE%/}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; exit 1; }

echo "Smoke testing $SITE"

code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/")
[ "$code" = "200" ] && pass "the site loads (HTTP $code)" || fail "the site returned HTTP $code"

headers=$(curl -sI "$SITE/")
for header in 'content-security-policy' 'strict-transport-security' 'x-content-type-options' 'referrer-policy'; do
  grep -qi "^$header" <<<"$headers" && pass "$header is set" || fail "$header is missing"
done

# A complete, valid submission built from the question bank itself.
body=$(python3 - "$ROOT/backend/questions.json" <<'PY'
import json, sys
bank = json.load(open(sys.argv[1]))
print(json.dumps({
    "answers": {q["id"]: ("yes" if i % 3 else "no") for i, q in enumerate(bank["questions"])},
    "profile": {"industry": "nonprofit", "headcount": 8},
}))
PY
)

created=$(curl -s -X POST "$SITE/assessments" -H 'Content-Type: application/json' -d "$body")
id=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' <<<"$created")
[ -n "$id" ] && pass "created an assessment ($id)" || fail "create failed: $created"

python3 - <<PY || fail "the report is missing fields"
import json
r = json.loads('''$created''')
assert isinstance(r["score"], int) and 0 <= r["score"] <= 100, r.get("score")
assert r["plan"]["summary"] and len(r["sections"]) == 6
print("  \033[32mPASS\033[0m  score %s, plan source '%s', %d actions"
      % (r["score"], r["plan"]["source"], len(r["plan"]["top_actions"])))
PY

code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/assessments/$id")
[ "$code" = "200" ] && pass "the report can be fetched back" || fail "fetch returned HTTP $code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SITE/assessments" \
  -H 'Content-Type: application/json' -d '{"answers":{},"evil":true}')
[ "$code" = "400" ] && pass "malformed input is rejected (HTTP 400)" || fail "expected 400, got $code"

code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/assessments/not-a-real-id")
[ "$code" = "404" ] && pass "unknown report ids return 404" || fail "expected 404, got $code"

printf '\n\033[32mAll checks passed.\033[0m  Report: %s/r/%s\n' "$SITE" "$id"
