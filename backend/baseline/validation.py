"""Strict input validation.

Everything arriving from the browser is rejected unless it matches the question
bank exactly. Unknown keys are an error, not something to ignore — silently
dropping fields is how injected data ends up somewhere it was never checked.
"""

from __future__ import annotations

import json
from typing import Any

from . import question_bank

# Generous for 26 short answers plus a profile; far below API Gateway's own
# limit, so oversized bodies die here instead of reaching DynamoDB or Bedrock.
MAX_BODY_BYTES = 16 * 1024

ALLOWED_TOP_LEVEL = {"answers", "profile"}
ALLOWED_PROFILE = {"industry", "headcount", "business_name", "contact_email"}

# Kept short and closed so the value can never be free text heading for the
# model prompt. "other" is the escape hatch.
INDUSTRIES = (
    "dental_or_medical",
    "accounting_or_legal",
    "auto_or_trades",
    "retail_or_hospitality",
    "nonprofit",
    "real_estate",
    "construction",
    "other",
)

MAX_HEADCOUNT = 500
MAX_NAME_LEN = 120
MAX_EMAIL_LEN = 254


class ValidationError(ValueError):
    """Raised with a message safe to show the person who submitted the form."""

    def __init__(self, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or []


def parse_body(raw: str | bytes | None) -> dict[str, Any]:
    """Size-check, then JSON-parse, then shape-check the request body."""
    if raw is None:
        raise ValidationError("Request body is required.")
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) > MAX_BODY_BYTES:
        raise ValidationError("Request body is too large.")
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValidationError("Request body must be valid JSON.")
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object.")
    return body


def validate_submission(body: dict[str, Any]) -> dict[str, Any]:
    """Return a clean {answers, profile} or raise ValidationError."""
    unknown = sorted(set(body) - ALLOWED_TOP_LEVEL)
    if unknown:
        raise ValidationError("Unexpected fields in request.", [f"unknown field: {k}" for k in unknown])

    return {
        "answers": _validate_answers(body.get("answers")),
        "profile": _validate_profile(body.get("profile")),
    }


def _validate_answers(answers: Any) -> dict[str, str]:
    if not isinstance(answers, dict):
        raise ValidationError("'answers' must be an object of question id to answer.")

    expected = question_bank.question_ids()
    submitted = set(answers)

    problems: list[str] = []
    for extra in sorted(submitted - expected):
        problems.append(f"unknown question: {extra}")
    for missing in sorted(expected - submitted):
        problems.append(f"unanswered question: {missing}")
    if problems:
        raise ValidationError("Answers do not match the question set.", problems)

    clean: dict[str, str] = {}
    bad: list[str] = []
    for qid in sorted(expected):
        value = answers[qid]
        if not isinstance(value, str) or value not in question_bank.VALID_ANSWERS:
            bad.append(f"{qid}: must be one of {', '.join(question_bank.VALID_ANSWERS)}")
        else:
            clean[qid] = value
    if bad:
        raise ValidationError("One or more answers are not valid.", bad)
    return clean


def _validate_profile(profile: Any) -> dict[str, Any]:
    if profile is None:
        return {}
    if not isinstance(profile, dict):
        raise ValidationError("'profile' must be an object.")

    unknown = sorted(set(profile) - ALLOWED_PROFILE)
    if unknown:
        raise ValidationError("Unexpected fields in profile.", [f"unknown field: {k}" for k in unknown])

    clean: dict[str, Any] = {}

    industry = profile.get("industry")
    if industry is not None:
        if industry not in INDUSTRIES:
            raise ValidationError("'industry' is not one of the accepted values.")
        clean["industry"] = industry

    headcount = profile.get("headcount")
    if headcount is not None:
        # bool is an int subclass; reject it explicitly.
        if isinstance(headcount, bool) or not isinstance(headcount, int):
            raise ValidationError("'headcount' must be a whole number.")
        if not 1 <= headcount <= MAX_HEADCOUNT:
            raise ValidationError(f"'headcount' must be between 1 and {MAX_HEADCOUNT}.")
        clean["headcount"] = headcount

    # Optional and never sent to the model — see plan.build_model_input.
    name = profile.get("business_name")
    if name is not None:
        if not isinstance(name, str) or len(name) > MAX_NAME_LEN:
            raise ValidationError(f"'business_name' must be text under {MAX_NAME_LEN} characters.")
        if name.strip():
            clean["business_name"] = name.strip()

    email = profile.get("contact_email")
    if email is not None:
        if not isinstance(email, str) or len(email) > MAX_EMAIL_LEN:
            raise ValidationError(f"'contact_email' must be text under {MAX_EMAIL_LEN} characters.")
        email = email.strip()
        if email:
            # Deliberately loose: we never send mail, so this only guards storage.
            if email.count("@") != 1 or email.startswith("@") or email.endswith("@"):
                raise ValidationError("'contact_email' does not look like an email address.")
            clean["contact_email"] = email

    return clean
