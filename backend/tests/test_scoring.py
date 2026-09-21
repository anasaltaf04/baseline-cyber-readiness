"""Scoring must be deterministic, bounded, and explainable."""

import pytest

from baseline import question_bank, scoring


def test_all_yes_is_one_hundred(all_yes):
    assert scoring.score_assessment(all_yes)["score"] == 100


def test_all_no_is_zero(all_no):
    assert scoring.score_assessment(all_no)["score"] == 0


def test_all_partly_is_fifty(qids):
    assert scoring.score_assessment({q: "partly" for q in qids})["score"] == 50


def test_not_sure_scores_the_same_as_no(qids):
    not_sure = scoring.score_assessment({q: "not_sure" for q in qids})
    no = scoring.score_assessment({q: "no" for q in qids})
    assert not_sure["score"] == no["score"] == 0


def test_score_is_deterministic(qids):
    answers = {q: ("yes" if i % 2 else "partly") for i, q in enumerate(qids)}
    runs = {scoring.score_assessment(answers)["score"] for _ in range(20)}
    assert len(runs) == 1


def test_score_does_not_depend_on_key_order(qids):
    answers = {q: ("yes" if i % 3 else "no") for i, q in enumerate(qids)}
    forward = scoring.score_assessment(answers)
    backward = scoring.score_assessment(dict(reversed(list(answers.items()))))
    assert forward["score"] == backward["score"]
    assert [g["question_id"] for g in forward["gaps"]] == [
        g["question_id"] for g in backward["gaps"]
    ]


def test_improving_one_answer_never_lowers_the_score(qids):
    """Monotonic: no > partly > yes must hold for every single question."""
    for target in qids:
        base = {q: "no" for q in qids}
        worse = scoring.score_assessment(base)["score"]
        mid = scoring.score_assessment({**base, target: "partly"})["score"]
        better = scoring.score_assessment({**base, target: "yes"})["score"]
        assert worse <= mid <= better, target


@pytest.mark.parametrize("answer", ["yes", "partly", "no", "not_sure"])
def test_score_stays_in_range(qids, answer):
    result = scoring.score_assessment({q: answer for q in qids})
    assert 0 <= result["score"] <= 100
    for section in result["sections"]:
        assert 0 <= section["score"] <= 100


def test_sections_are_reported_in_bank_order(all_no):
    result = scoring.score_assessment(all_no)
    assert [s["id"] for s in result["sections"]] == [
        s["id"] for s in question_bank.sections()
    ]


def test_section_counts_add_up(all_yes):
    result = scoring.score_assessment(all_yes)
    assert sum(s["question_count"] for s in result["sections"]) == len(
        question_bank.questions()
    )
    for section in result["sections"]:
        assert section["answered_well"] == section["question_count"]


def test_yes_answers_produce_no_gaps(all_yes):
    result = scoring.score_assessment(all_yes)
    assert result["gaps"] == []
    assert len(result["strength_ids"]) == len(question_bank.questions())


def test_every_non_yes_answer_becomes_a_gap(qids):
    answers = {q: ("yes" if i % 2 else "not_sure") for i, q in enumerate(qids)}
    result = scoring.score_assessment(answers)
    expected = {q for q, a in answers.items() if a != "yes"}
    assert {g["question_id"] for g in result["gaps"]} == expected


def test_gaps_put_outright_no_before_partly(qids):
    """A missing control should outrank a half-done one of equal priority."""
    answers = {q: "partly" for q in qids}
    answers[qids[-1]] = "no"
    gaps = scoring.score_assessment(answers)["gaps"]
    first_partly = next(i for i, g in enumerate(gaps) if g["answer"] == "partly")
    last_no = max(i for i, g in enumerate(gaps) if g["answer"] == "no")
    assert last_no < first_partly


def test_multi_factor_authentication_is_the_top_gap(all_no):
    """The bank's priorities must surface the highest-value fix first."""
    gaps = scoring.score_assessment(all_no)["gaps"]
    assert gaps[0]["question_id"] == "mfa"


@pytest.mark.parametrize(
    "score,expected",
    [(100, "strong"), (80, "strong"), (79, "solid"), (60, "solid"),
     (59, "developing"), (40, "developing"), (39, "at_risk"), (0, "at_risk")],
)
def test_band_boundaries(score, expected):
    assert scoring.band_for(score)["key"] == expected


def test_failed_safeguards_are_deduplicated(all_no):
    result = scoring.score_assessment(all_no)
    failed = scoring.failed_safeguards(result)
    ids = [f["id"] for f in failed]
    assert len(ids) == len(set(ids))
    assert all(f["title"] and f["status"] in ("no", "partly") for f in failed)


def test_passing_everything_leaves_no_failed_safeguards(all_yes):
    assert scoring.failed_safeguards(scoring.score_assessment(all_yes)) == []
