"""Lambda entry points.

Two functions, deployed separately so each gets only the IAM it needs:
  create_handler  POST /assessments      DynamoDB PutItem + Bedrock InvokeModel
  get_handler     GET  /assessments/{id} DynamoDB GetItem
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import secrets
from typing import Any

from . import plan as plan_module
from . import question_bank, scoring, storage, validation

log = logging.getLogger()
log.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

# 16 random bytes, URL-safe: 128 bits of entropy, so report links cannot be
# guessed or enumerated. This is the only thing protecting a report.
ID_BYTES = 16
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def _cors_headers() -> dict[str, str]:
    """Locked to the CloudFront domain the stack deploys; "*" only if unset."""
    return {
        "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
        "Vary": "Origin",
    }


def _respond(status: int, body: dict[str, Any], cache: str = "no-store") -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": cache,
            "X-Content-Type-Options": "nosniff",
            **_cors_headers(),
        },
        "body": json.dumps(body),
    }


def _error(status: int, message: str, details: list[str] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"error": {"message": message}}
    if details:
        payload["error"]["details"] = details[:20]
    return _respond(status, payload)


def new_id() -> str:
    return secrets.token_urlsafe(ID_BYTES)


def create_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Score the answers, generate a plan, store it, return the report."""
    try:
        body = validation.parse_body(event.get("body"))
        clean = validation.validate_submission(body)
    except validation.ValidationError as exc:
        log.info("rejected submission: %s", exc.message)
        return _error(400, exc.message, exc.details)

    try:
        scored = scoring.score_assessment(clean["answers"])
        generated = plan_module.generate_plan(scored, clean["profile"])

        report = {
            "id": new_id(),
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "score": scored["score"],
            "band": scored["band"],
            "sections": scored["sections"],
            "plan": generated,
            "profile": clean["profile"],
            "question_bank_version": question_bank.load_bank()["version"],
        }
        storage.put_report(report, clean["answers"])
    except Exception:  # noqa: BLE001
        log.exception("failed to create assessment")
        return _error(500, "We could not save your results. Please try again.")

    log.info(
        "created assessment score=%s plan_source=%s gaps=%s",
        report["score"],
        generated.get("source"),
        len(scored["gaps"]),
    )
    return _respond(201, report)


def get_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Return a stored report by id."""
    report_id = (event.get("pathParameters") or {}).get("id", "")
    if not ID_PATTERN.match(report_id):
        return _error(404, "That report link is not valid.")

    try:
        report = storage.get_report(report_id)
    except Exception:  # noqa: BLE001
        log.exception("failed to read assessment")
        return _error(500, "We could not load that report. Please try again.")

    if report is None:
        return _error(
            404,
            "We could not find that report. Reports are deleted automatically after 90 days.",
        )
    # Safe to cache briefly: reports never change once written.
    return _respond(200, report, cache="public, max-age=300")
