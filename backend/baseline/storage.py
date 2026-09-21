"""DynamoDB persistence — one table, one item per report.

Items carry a TTL so reports delete themselves after 90 days. Nothing here
needs a scan or a secondary index: a report is always fetched by its own id.
"""

from __future__ import annotations

import os
import time
from typing import Any

TTL_DAYS = 90
PK_PREFIX = "ASSESSMENT#"
SK_REPORT = "REPORT"


def _table(table: Any = None) -> Any:
    if table is not None:
        return table
    import boto3  # lazy so unit tests need no AWS SDK

    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def put_report(report: dict[str, Any], answers: dict[str, str], table: Any = None) -> None:
    """Store a finished report. Answers are kept so a score can be re-checked."""
    now = int(time.time())
    _table(table).put_item(
        Item={
            "pk": PK_PREFIX + report["id"],
            "sk": SK_REPORT,
            "id": report["id"],
            "created_at": report["created_at"],
            "expires_at": now + TTL_DAYS * 24 * 60 * 60,
            "score": report["score"],
            "band": report["band"],
            "sections": report["sections"],
            "plan": report["plan"],
            "profile": report["profile"],
            "answers": answers,
            "question_bank_version": report["question_bank_version"],
        }
    )


def get_report(report_id: str, table: Any = None) -> dict[str, Any] | None:
    """Fetch a report by id, or None if it never existed or has expired.

    DynamoDB can serve an expired item for up to ~48 hours after its TTL, so
    the expiry is re-checked here rather than trusted to the table.
    """
    response = _table(table).get_item(Key={"pk": PK_PREFIX + report_id, "sk": SK_REPORT})
    item = response.get("Item")
    if not item:
        return None
    if int(item.get("expires_at", 0)) <= int(time.time()):
        return None
    return {
        "id": item["id"],
        "created_at": item["created_at"],
        "score": int(item["score"]),
        "band": item["band"],
        "sections": [
            {**s, "score": int(s["score"]), "answered_well": int(s["answered_well"]),
             "question_count": int(s["question_count"])}
            for s in item["sections"]
        ],
        "plan": _normalise_plan(item["plan"]),
        "profile": dict(item.get("profile", {})),
        "question_bank_version": item.get("question_bank_version"),
    }


def _normalise_plan(plan: Any) -> dict[str, Any]:
    """DynamoDB hands numbers back as Decimal; the browser wants ints."""
    return {
        "summary": plan["summary"],
        "source": plan.get("source", "fallback"),
        "top_actions": [
            {
                "title": a["title"],
                "why_it_matters": a["why_it_matters"],
                "steps": list(a["steps"]),
                "estimated_cost": a["estimated_cost"],
                "effort": a["effort"],
                "week": int(a["week"]),
            }
            for a in plan.get("top_actions", [])
        ],
    }
