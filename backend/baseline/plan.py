"""The 30-day action plan.

Two sources, in order:
  1. Bedrock writes it, and we validate every field before trusting it.
  2. If anything at all goes wrong, the question bank writes it.

The fallback is not a degraded mode we hope never runs — it is a complete,
useful plan built from the same remediation text a human wrote. The app must
never show an error page during judging because a model call timed out.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from . import question_bank, scoring

log = logging.getLogger(__name__)

MAX_ACTIONS = 8
EFFORTS = ("low", "medium", "high")
MAX_STEPS = 6

# Bedrock model ids carry an `anthropic.` prefix. Some accounts must use a
# cross-region inference profile instead (`us.anthropic.…`); both are settable
# here without a code change, and infra/ grants IAM for whichever is configured.
DEFAULT_MODEL_ID = "anthropic.claude-haiku-4-5"

SYSTEM_PROMPT = """You write cyber security action plans for small business owners who have no IT staff and no security background.

Rules you must follow:
- Write for someone who has never heard the words "endpoint", "posture", "vector", or "mitigation". If a technical term is unavoidable, define it in the same sentence in plain words.
- Be specific and concrete. "Turn on two-step sign-in for your email account" is useful; "improve authentication hygiene" is not.
- Every action must be something the owner can start themselves this month, without hiring anyone.
- Costs must be realistic for a business with fewer than 50 staff. Say $0 when it is free.
- Never invent details about the business. You only know the numbers given to you.
- Do not scare or shame the reader. Be direct, practical, and encouraging.

Return only a single JSON object, with no commentary before or after it, in exactly this shape:
{"summary": "<2-3 sentences addressed to the owner>", "top_actions": [{"title": "<short imperative>", "why_it_matters": "<2-3 plain sentences>", "steps": ["<concrete step>", ...], "estimated_cost": "<e.g. $0 or $5 to $10 per person per month>", "effort": "low|medium|high", "week": 1}]}

Use at most 8 actions, ordered by what to do first. "week" is 1 to 4, spreading the work across a month with the highest-impact items in week 1. Use 2 to 5 steps per action."""


def build_model_input(scored: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """Assemble exactly what the model is allowed to see.

    Only the score, section breakdown, failed safeguards, industry, and
    headcount. No business name, no email, no free text of any kind — there is
    no field here a user can type into.
    """
    return {
        "readiness_score": scored["score"],
        "readiness_band": scored["band"]["label"],
        "industry": profile.get("industry", "unspecified"),
        "headcount": profile.get("headcount", "unspecified"),
        "section_scores": [
            {"area": s["title"], "score": s["score"]} for s in scored["sections"]
        ],
        "gaps_worst_first": [
            {
                "area": _section_title(gap["section"]),
                "status": "partly in place" if gap["answer"] == "partly" else "not in place",
                "practices_missing": [sg["title"] for sg in gap["safeguards"]],
            }
            for gap in scored["gaps"][:12]
        ],
        "already_in_place": [
            question_bank.question_by_id(qid)["remediation"]["title"]
            for qid in scored["strength_ids"][:10]
        ],
    }


def _section_title(section_id: str) -> str:
    for section in question_bank.sections():
        if section["id"] == section_id:
            return section["title"]
    return section_id


def generate_plan(scored: dict[str, Any], profile: dict[str, Any], client: Any = None) -> dict[str, Any]:
    """Return a validated plan. Never raises — falls back instead."""
    try:
        raw = _invoke_model(build_model_input(scored, profile), client=client)
        plan = validate_plan(raw)
        plan["source"] = "bedrock"
        return plan
    except Exception as exc:  # noqa: BLE001 — a broken plan must never break the report
        log.warning("falling back to static plan: %s: %s", type(exc).__name__, exc)
        plan = static_plan(scored)
        plan["source"] = "fallback"
        return plan


def _invoke_model(model_input: dict[str, Any], client: Any = None) -> Any:
    if client is None:
        import boto3  # imported lazily so unit tests need no AWS SDK

        client = boto3.client("bedrock-runtime")

    model_id = os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)

    response = client.invoke_model(
        modelId=model_id,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 3000,
                "system": SYSTEM_PROMPT,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Write the action plan for this business.\n\n"
                            + json.dumps(model_input, indent=2)
                        ),
                    }
                ],
            }
        ),
    )
    payload = json.loads(response["body"].read())
    text = "".join(
        block.get("text", "") for block in payload.get("content", []) if block.get("type") == "text"
    )
    return _extract_json(text)


def _extract_json(text: str) -> Any:
    """Parse the model's reply, tolerating a code fence or stray prose."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def validate_plan(raw: Any) -> dict[str, Any]:
    """Enforce the shape and clamp every value. Raises if it cannot be trusted.

    This runs on model output, so it assumes nothing: wrong types, missing
    fields, 40 actions, or an effort of "catastrophic" all raise or get clamped
    rather than reaching the browser.
    """
    if not isinstance(raw, dict):
        raise ValueError("plan must be a JSON object")

    summary = raw.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("plan.summary must be a non-empty string")

    actions = raw.get("top_actions")
    if not isinstance(actions, list) or not actions:
        raise ValueError("plan.top_actions must be a non-empty list")

    clean: list[dict[str, Any]] = []
    for item in actions[:MAX_ACTIONS]:
        if not isinstance(item, dict):
            raise ValueError("each action must be an object")

        title = item.get("title")
        why = item.get("why_it_matters")
        steps = item.get("steps")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("action.title must be a non-empty string")
        if not isinstance(why, str) or not why.strip():
            raise ValueError("action.why_it_matters must be a non-empty string")
        if not isinstance(steps, list) or not steps:
            raise ValueError("action.steps must be a non-empty list")

        clean_steps = [s.strip() for s in steps[:MAX_STEPS] if isinstance(s, str) and s.strip()]
        if not clean_steps:
            raise ValueError("action.steps must contain at least one usable step")

        effort = item.get("effort")
        cost = item.get("estimated_cost")
        week = item.get("week")

        clean.append(
            {
                "title": title.strip()[:120],
                "why_it_matters": why.strip()[:600],
                "steps": [s[:300] for s in clean_steps],
                "estimated_cost": (cost.strip()[:80] if isinstance(cost, str) and cost.strip() else "Not estimated"),
                "effort": effort if effort in EFFORTS else "medium",
                "week": week if isinstance(week, int) and not isinstance(week, bool) and 1 <= week <= 4 else 1,
            }
        )

    if not clean:
        raise ValueError("no usable actions in plan")

    clean.sort(key=lambda a: a["week"])
    return {"summary": summary.strip()[:800], "top_actions": clean}


def static_plan(scored: dict[str, Any]) -> dict[str, Any]:
    """Build a real plan from the question bank, worst gaps first.

    Used whenever Bedrock is unavailable, slow, or returns something we will
    not vouch for. The owner cannot tell it is the fallback except by the
    `source` field, and the advice is the same advice.
    """
    selected = scored["gaps"][:MAX_ACTIONS]
    # Spread the chosen actions over the four weeks by how urgent they are, so
    # a 30-day plan actually reads as one. Without this, every high-priority
    # gap carries week 1 from the bank and the whole plan lands on Monday.
    per_week = max(1, -(-len(selected) // 4))  # ceiling division

    actions: list[dict[str, Any]] = []
    for rank, gap in enumerate(selected):
        remediation = question_bank.question_by_id(gap["question_id"])["remediation"]
        rank_week = min(4, rank // per_week + 1)
        # The bank's own week is a floor: work that needs a purchase or a
        # scheduled meeting should not be pulled forward just because it ranked
        # highly.
        bank_week = remediation["week"] if 1 <= remediation["week"] <= 4 else 1
        actions.append(
            {
                "title": remediation["title"],
                "why_it_matters": remediation["why_it_matters"],
                "steps": list(remediation["steps"][:MAX_STEPS]),
                "estimated_cost": remediation["estimated_cost"],
                "effort": remediation["effort"] if remediation["effort"] in EFFORTS else "medium",
                "week": min(4, max(rank_week, bank_week)),
            }
        )

    if not actions:
        return {
            "summary": (
                f"You scored {scored['score']} out of 100, and you answered yes to every question. "
                "There is nothing on this list left to fix. Re-run this check in six months, or "
                "whenever you add staff, change systems, or take on a new kind of customer data."
            ),
            "top_actions": [],
        }

    actions.sort(key=lambda a: a["week"])
    gap_count = len(scored["gaps"])
    free_count = sum(1 for a in actions if a["estimated_cost"].strip().startswith("$0"))

    summary = (
        f"You scored {scored['score']} out of 100 — {scored['band']['label'].lower()}. "
        f"We found {gap_count} {'gap' if gap_count == 1 else 'gaps'} against the basic security "
        f"practices recommended for businesses your size, and the {len(actions)} below are the ones "
        f"worth your attention first. "
        + (
            f"{free_count} of them cost nothing but your time."
            if free_count
            else "Work through them in the order shown."
        )
    )
    return {"summary": summary, "top_actions": actions}
