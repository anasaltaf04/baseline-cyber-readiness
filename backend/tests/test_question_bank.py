"""The bank is the contract every other module trusts, so check it hard."""

import pytest

from baseline import question_bank


def test_bank_loads_and_self_validates():
    bank = question_bank.load_bank()
    assert bank["version"]
    assert len(bank["questions"]) >= 20


def test_six_sections_every_one_populated():
    ids = [s["id"] for s in question_bank.sections()]
    assert ids == ["devices", "accounts", "data", "email", "people", "incident"]
    used = {q["section"] for q in question_bank.questions()}
    assert used == set(ids), "every section must have at least one question"


def test_question_ids_are_unique():
    ids = [q["id"] for q in question_bank.questions()]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("field", ["text", "help", "safeguards", "remediation"])
def test_every_question_has_required_fields(field):
    for q in question_bank.questions():
        assert q.get(field), f"{q['id']} is missing {field}"


def test_every_safeguard_has_an_id_and_paraphrased_title():
    for q in question_bank.questions():
        for sg in q["safeguards"]:
            assert sg["id"] and sg["title"]
            # IG1 safeguard ids look like "5.2" — control number, dot, number.
            major, _, minor = sg["id"].partition(".")
            assert major.isdigit() and minor.isdigit(), sg["id"]


def test_every_remediation_is_usable_as_a_plan_action():
    for q in question_bank.questions():
        r = q["remediation"]
        assert r["title"] and r["why_it_matters"]
        assert 2 <= len(r["steps"]) <= 6, f"{q['id']} has {len(r['steps'])} steps"
        assert r["effort"] in ("low", "medium", "high")
        assert 1 <= r["week"] <= 4
        assert r["estimated_cost"]


def test_answer_weights_match_the_spec():
    assert question_bank.answer_weights() == {
        "yes": 1.0,
        "partly": 0.5,
        "no": 0.0,
        "not_sure": 0.0,
    }


def test_public_bank_withholds_remediation():
    """The questionnaire must not ship the answer key to the browser."""
    public = question_bank.public_bank()
    blob = str(public)
    assert "remediation" not in blob
    for q in question_bank.questions():
        assert q["remediation"]["title"] not in blob
    assert len(public["questions"]) == len(question_bank.questions())
