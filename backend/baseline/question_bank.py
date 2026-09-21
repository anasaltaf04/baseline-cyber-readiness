"""Loads and indexes the question bank.

The bank is the single source of truth for what may be submitted, how it is
scored, and what the static fallback plan says. Nothing else in the codebase
hardcodes a question id.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

_DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "questions.json")

VALID_ANSWERS = ("yes", "partly", "no", "not_sure")


@lru_cache(maxsize=1)
def load_bank(path: str | None = None) -> dict[str, Any]:
    """Read questions.json once per Lambda container."""
    with open(path or os.environ.get("QUESTIONS_PATH", _DEFAULT_PATH), encoding="utf-8") as fh:
        bank = json.load(fh)
    _validate_bank(bank)
    return bank


def _validate_bank(bank: dict[str, Any]) -> None:
    """Fail loudly at import time rather than mid-request."""
    section_ids = {s["id"] for s in bank["sections"]}
    seen: set[str] = set()
    for q in bank["questions"]:
        if q["id"] in seen:
            raise ValueError(f"duplicate question id: {q['id']}")
        seen.add(q["id"])
        if q["section"] not in section_ids:
            raise ValueError(f"question {q['id']} references unknown section {q['section']}")
        if not q.get("safeguards"):
            raise ValueError(f"question {q['id']} has no safeguard mapping")
        if not q.get("remediation"):
            raise ValueError(f"question {q['id']} has no remediation for the fallback plan")
    if set(bank["answer_weights"]) != set(VALID_ANSWERS):
        raise ValueError("answer_weights must cover exactly the four valid answers")


def questions() -> list[dict[str, Any]]:
    return load_bank()["questions"]


def question_ids() -> set[str]:
    return {q["id"] for q in questions()}


def question_by_id(question_id: str) -> dict[str, Any]:
    return _index()[question_id]


@lru_cache(maxsize=1)
def _index() -> dict[str, dict[str, Any]]:
    return {q["id"]: q for q in questions()}


def sections() -> list[dict[str, Any]]:
    return load_bank()["sections"]


def answer_weights() -> dict[str, float]:
    return load_bank()["answer_weights"]


def public_bank() -> dict[str, Any]:
    """The question bank as the browser needs it — without the remediation text.

    Remediation is withheld so the questionnaire cannot be reverse-engineered
    into "answer No to everything and read the answers"; the report returns
    only the actions that apply.
    """
    return {
        "version": load_bank()["version"],
        "framework": load_bank()["framework"],
        "sections": sections(),
        "questions": [
            {
                "id": q["id"],
                "section": q["section"],
                "text": q["text"],
                "help": q["help"],
                "safeguards": q["safeguards"],
            }
            for q in questions()
        ],
    }
