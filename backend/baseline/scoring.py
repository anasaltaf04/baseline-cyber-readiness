"""Deterministic scoring.

The score is computed here, in Python, and never by the model. Given the same
answers this function returns the same number every time — that is what makes
the report defensible to the business owner reading it.
"""

from __future__ import annotations

from typing import Any

from . import question_bank

BANDS = (
    (80, "strong", "Strong footing", "You are ahead of most businesses your size. Keep it current."),
    (60, "solid", "Solid foundation", "The basics are in place. A few gaps are worth closing soon."),
    (40, "developing", "Developing", "You have made a start. The gaps below are the ones that bite first."),
    (0, "at_risk", "Needs attention", "Several basics are missing. The good news: most fixes here are free."),
)


def _pct(earned: float, possible: float) -> int:
    """Percentage, rounded half-up, clamped to 0-100."""
    if possible <= 0:
        return 0
    return max(0, min(100, int(earned / possible * 100 + 0.5)))


def band_for(score: int) -> dict[str, str]:
    for threshold, key, label, blurb in BANDS:
        if score >= threshold:
            return {"key": key, "label": label, "blurb": blurb}
    raise AssertionError("BANDS must include a 0 floor")


def score_assessment(answers: dict[str, str]) -> dict[str, Any]:
    """Turn validated answers into a score, section breakdown, and gap list.

    `answers` must already have passed validation — every question id present,
    every value one of the four allowed answers.
    """
    weights = question_bank.answer_weights()
    questions = question_bank.questions()

    earned = 0.0
    possible = 0.0
    per_section: dict[str, dict[str, float]] = {}
    gaps: list[dict[str, Any]] = []
    strengths: list[str] = []

    for q in questions:
        answer = answers[q["id"]]
        weight = float(q.get("weight", 1.0))
        credit = weights[answer] * weight

        earned += credit
        possible += weight

        bucket = per_section.setdefault(q["section"], {"earned": 0.0, "possible": 0.0})
        bucket["earned"] += credit
        bucket["possible"] += weight

        if answer == "yes":
            strengths.append(q["id"])
        else:
            gaps.append(
                {
                    "question_id": q["id"],
                    "section": q["section"],
                    "answer": answer,
                    "safeguards": q["safeguards"],
                    "priority": q["remediation"].get("priority", 500),
                }
            )

    # Worst gaps first: a "no" outranks a "partly", then by the bank's own
    # priority ordering, then by id so the result never depends on dict order.
    gaps.sort(key=lambda g: (g["answer"] == "partly", g["priority"], g["question_id"]))

    score = _pct(earned, possible)
    section_lookup = {s["id"]: s for s in question_bank.sections()}

    return {
        "score": score,
        "band": band_for(score),
        "sections": [
            {
                "id": sid,
                "title": section_lookup[sid]["title"],
                "blurb": section_lookup[sid]["blurb"],
                "score": _pct(per_section[sid]["earned"], per_section[sid]["possible"]),
                "answered_well": sum(
                    1
                    for q in questions
                    if q["section"] == sid and answers[q["id"]] == "yes"
                ),
                "question_count": sum(1 for q in questions if q["section"] == sid),
            }
            for sid in (s["id"] for s in question_bank.sections())
            if sid in per_section
        ],
        "gaps": gaps,
        "strength_ids": strengths,
        "questions_answered": len(questions),
    }


def failed_safeguards(scored: dict[str, Any]) -> list[dict[str, str]]:
    """De-duplicated safeguards behind the gaps, worst first.

    This is what gets sent to the model — safeguard ids and our own paraphrased
    titles, never the owner's free text.
    """
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for gap in scored["gaps"]:
        for sg in gap["safeguards"]:
            if sg["id"] in seen:
                continue
            seen.add(sg["id"])
            out.append({"id": sg["id"], "title": sg["title"], "status": gap["answer"]})
    return out
