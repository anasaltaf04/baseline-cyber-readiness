"""The plan comes from a model, so every field is treated as untrusted."""

import json

import pytest

from baseline import plan, question_bank, scoring


def _scored(answers):
    return scoring.score_assessment(answers)


# --- what the model is allowed to see -------------------------------------


def test_model_input_never_includes_business_name_or_email(all_no):
    payload = plan.build_model_input(
        _scored(all_no),
        {
            "industry": "dental_or_medical",
            "headcount": 9,
            "business_name": "Bright Smile Dental",
            "contact_email": "owner@brightsmile.example",
        },
    )
    blob = json.dumps(payload)
    assert "Bright Smile" not in blob
    assert "brightsmile" not in blob
    assert "business_name" not in payload
    assert "contact_email" not in payload


def test_model_input_carries_only_the_agreed_fields(all_no):
    payload = plan.build_model_input(_scored(all_no), {})
    assert set(payload) == {
        "readiness_score",
        "readiness_band",
        "industry",
        "headcount",
        "section_scores",
        "gaps_worst_first",
        "already_in_place",
    }


def test_model_input_survives_an_empty_profile(all_no):
    payload = plan.build_model_input(_scored(all_no), {})
    assert payload["industry"] == "unspecified"
    assert payload["headcount"] == "unspecified"


# --- validating what comes back -------------------------------------------


def _valid_action(**overrides):
    action = {
        "title": "Turn on two-step sign-in",
        "why_it_matters": "A stolen password stops being enough on its own.",
        "steps": ["Open your email settings", "Switch on two-step sign-in"],
        "estimated_cost": "$0",
        "effort": "low",
        "week": 1,
    }
    action.update(overrides)
    return action


def _valid_plan(**overrides):
    payload = {"summary": "Here is where to start.", "top_actions": [_valid_action()]}
    payload.update(overrides)
    return payload


def test_accepts_a_well_formed_plan():
    result = plan.validate_plan(_valid_plan())
    assert result["summary"] == "Here is where to start."
    assert len(result["top_actions"]) == 1


@pytest.mark.parametrize(
    "bad",
    [None, [], "a string", 42, {}, {"summary": "x"}, {"top_actions": []},
     {"summary": "", "top_actions": [_valid_action()]},
     {"summary": "ok", "top_actions": []},
     {"summary": "ok", "top_actions": "not a list"},
     {"summary": "ok", "top_actions": ["not an object"]}],
)
def test_rejects_malformed_plans(bad):
    with pytest.raises(ValueError):
        plan.validate_plan(bad)


@pytest.mark.parametrize("field", ["title", "why_it_matters", "steps"])
def test_rejects_actions_missing_required_text(field):
    with pytest.raises(ValueError):
        plan.validate_plan(_valid_plan(top_actions=[_valid_action(**{field: None})]))


def test_rejects_action_whose_steps_are_all_blank():
    with pytest.raises(ValueError):
        plan.validate_plan(_valid_plan(top_actions=[_valid_action(steps=["", "   "])]))


def test_caps_actions_at_eight():
    result = plan.validate_plan(_valid_plan(top_actions=[_valid_action()] * 40))
    assert len(result["top_actions"]) == plan.MAX_ACTIONS == 8


def test_caps_steps_per_action():
    result = plan.validate_plan(
        _valid_plan(top_actions=[_valid_action(steps=[f"step {i}" for i in range(50)])])
    )
    assert len(result["top_actions"][0]["steps"]) == plan.MAX_STEPS


@pytest.mark.parametrize("bad", ["catastrophic", "LOW", "", None, 3, True])
def test_unknown_effort_falls_back_to_medium(bad):
    result = plan.validate_plan(_valid_plan(top_actions=[_valid_action(effort=bad)]))
    assert result["top_actions"][0]["effort"] == "medium"


@pytest.mark.parametrize("bad", [0, 5, 99, -1, "1", None, True, 1.5])
def test_out_of_range_week_falls_back_to_one(bad):
    result = plan.validate_plan(_valid_plan(top_actions=[_valid_action(week=bad)]))
    assert result["top_actions"][0]["week"] == 1


@pytest.mark.parametrize("bad", [None, 12, "", "   ", []])
def test_missing_cost_becomes_not_estimated(bad):
    result = plan.validate_plan(_valid_plan(top_actions=[_valid_action(estimated_cost=bad)]))
    assert result["top_actions"][0]["estimated_cost"] == "Not estimated"


def test_long_text_is_truncated_not_rejected():
    result = plan.validate_plan(
        _valid_plan(
            summary="s" * 5000,
            top_actions=[_valid_action(title="t" * 5000, why_it_matters="w" * 5000)],
        )
    )
    assert len(result["summary"]) <= 800
    assert len(result["top_actions"][0]["title"]) <= 120
    assert len(result["top_actions"][0]["why_it_matters"]) <= 600


def test_actions_come_back_ordered_by_week():
    result = plan.validate_plan(
        _valid_plan(
            top_actions=[_valid_action(week=4), _valid_action(week=1), _valid_action(week=3)]
        )
    )
    assert [a["week"] for a in result["top_actions"]] == [1, 3, 4]


# --- tolerating the model's formatting ------------------------------------


@pytest.mark.parametrize(
    "wrapper",
    [
        '{body}',
        '```json\n{body}\n```',
        '```\n{body}\n```',
        'Here is the plan:\n{body}\nLet me know if you need more.',
    ],
)
def test_extracts_json_from_common_model_formatting(wrapper):
    body = json.dumps(_valid_plan())
    parsed = plan._extract_json(wrapper.format(body=body))
    assert plan.validate_plan(parsed)["top_actions"]


def test_extract_json_raises_when_there_is_no_json():
    with pytest.raises(ValueError):
        plan._extract_json("I'm sorry, I can't help with that.")


# --- the fallback ---------------------------------------------------------


def test_fallback_plan_is_a_real_plan(all_no):
    result = plan.static_plan(_scored(all_no))
    assert plan.validate_plan(result)
    assert len(result["top_actions"]) == plan.MAX_ACTIONS


def test_fallback_spreads_work_across_the_month(all_no):
    weeks = {a["week"] for a in plan.static_plan(_scored(all_no))["top_actions"]}
    assert weeks == {1, 2, 3, 4}, "a 30-day plan must not all land in week one"


def test_fallback_leads_with_the_highest_value_fix(all_no):
    first = plan.static_plan(_scored(all_no))["top_actions"][0]
    assert "multi-factor" in first["title"].lower()


def test_fallback_text_comes_from_the_question_bank(all_no):
    titles = {q["remediation"]["title"] for q in question_bank.questions()}
    for action in plan.static_plan(_scored(all_no))["top_actions"]:
        assert action["title"] in titles


def test_fallback_congratulates_a_perfect_score(all_yes):
    result = plan.static_plan(_scored(all_yes))
    assert result["top_actions"] == []
    assert "100" in result["summary"]


def test_fallback_summary_counts_the_gaps(qids):
    answers = {q: "yes" for q in qids}
    answers[qids[0]] = "no"
    result = plan.static_plan(_scored(answers))
    assert "1 gap" in result["summary"]
    assert len(result["top_actions"]) == 1


# --- generate_plan must never raise ---------------------------------------


class _BrokenClient:
    def invoke_model(self, **kwargs):
        raise RuntimeError("Bedrock is on fire")


class _FakeBody:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode()


class _StubClient:
    def __init__(self, text):
        self._text = text
        self.calls = []

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        return {"body": _FakeBody({"content": [{"type": "text", "text": self._text}]})}


def test_generate_plan_falls_back_when_bedrock_fails(all_no):
    result = plan.generate_plan(_scored(all_no), {}, client=_BrokenClient())
    assert result["source"] == "fallback"
    assert result["top_actions"]


def test_generate_plan_falls_back_on_unparseable_output(all_no):
    result = plan.generate_plan(_scored(all_no), {}, client=_StubClient("no json here"))
    assert result["source"] == "fallback"


def test_generate_plan_falls_back_on_valid_json_of_the_wrong_shape(all_no):
    stub = _StubClient(json.dumps({"summary": "hi", "actions": []}))
    assert plan.generate_plan(_scored(all_no), {}, client=stub)["source"] == "fallback"


def test_generate_plan_uses_bedrock_output_when_it_is_good(all_no):
    stub = _StubClient(json.dumps(_valid_plan()))
    result = plan.generate_plan(_scored(all_no), {}, client=stub)
    assert result["source"] == "bedrock"
    assert result["summary"] == "Here is where to start."


def test_bedrock_request_sends_no_free_text(all_no):
    stub = _StubClient(json.dumps(_valid_plan()))
    plan.generate_plan(
        _scored(all_no), {"business_name": "Acme Dental", "contact_email": "a@b.example"}, client=stub
    )
    body = stub.calls[0]["body"]
    assert "Acme Dental" not in body
    assert "a@b.example" not in body


def test_bedrock_request_targets_an_anthropic_model(all_no, monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    stub = _StubClient(json.dumps(_valid_plan()))
    plan.generate_plan(_scored(all_no), {}, client=stub)
    assert "anthropic." in stub.calls[0]["modelId"]
    assert json.loads(stub.calls[0]["body"])["anthropic_version"] == "bedrock-2023-05-31"
