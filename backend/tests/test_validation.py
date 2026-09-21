"""Validation is the trust boundary — it gets the adversarial tests."""

import json

import pytest

from baseline import validation
from baseline.validation import ValidationError


def test_accepts_a_well_formed_submission(all_yes):
    clean = validation.validate_submission(
        {"answers": all_yes, "profile": {"industry": "nonprofit", "headcount": 12}}
    )
    assert clean["answers"] == all_yes
    assert clean["profile"] == {"industry": "nonprofit", "headcount": 12}


def test_profile_is_optional(all_yes):
    assert validation.validate_submission({"answers": all_yes})["profile"] == {}


def test_rejects_body_over_the_size_limit():
    oversized = b"{" + b"a" * validation.MAX_BODY_BYTES + b"}"
    with pytest.raises(ValidationError, match="too large"):
        validation.parse_body(oversized)


def test_size_limit_is_checked_before_parsing():
    """A huge body must be refused without being parsed into memory first."""
    with pytest.raises(ValidationError, match="too large"):
        validation.parse_body("x" * (validation.MAX_BODY_BYTES + 1))


@pytest.mark.parametrize("raw", [None, "", "not json", "[1,2]", '"a string"', "null", "123"])
def test_rejects_bodies_that_are_not_json_objects(raw):
    with pytest.raises(ValidationError):
        validation.parse_body(raw)


def test_rejects_unknown_top_level_keys(all_yes):
    with pytest.raises(ValidationError, match="Unexpected fields"):
        validation.validate_submission({"answers": all_yes, "isAdmin": True})


def test_rejects_unknown_question_ids(all_yes):
    with pytest.raises(ValidationError) as exc:
        validation.validate_submission({"answers": {**all_yes, "made-up": "yes"}})
    assert any("unknown question: made-up" in d for d in exc.value.details)


def test_rejects_missing_answers(all_yes):
    partial = dict(all_yes)
    dropped = partial.popitem()[0]
    with pytest.raises(ValidationError) as exc:
        validation.validate_submission({"answers": partial})
    assert any(dropped in d for d in exc.value.details)


@pytest.mark.parametrize("bad", ["maybe", "YES", "Yes", "", " yes", 1, True, None, [], {}])
def test_rejects_answers_outside_the_four_options(all_yes, qids, bad):
    answers = {**all_yes, qids[0]: bad}
    with pytest.raises(ValidationError):
        validation.validate_submission({"answers": answers})


@pytest.mark.parametrize("bad", ["a string", 42, [], None])
def test_rejects_answers_that_are_not_an_object(bad):
    if bad is None:
        pytest.skip("None means absent, covered by the missing-answers test")
    with pytest.raises(ValidationError):
        validation.validate_submission({"answers": bad})


def test_rejects_unknown_profile_keys(all_yes):
    with pytest.raises(ValidationError, match="Unexpected fields in profile"):
        validation.validate_submission(
            {"answers": all_yes, "profile": {"ssn": "123-45-6789"}}
        )


def test_rejects_unlisted_industry(all_yes):
    with pytest.raises(ValidationError, match="industry"):
        validation.validate_submission(
            {"answers": all_yes, "profile": {"industry": "cybercrime"}}
        )


@pytest.mark.parametrize("bad", [0, -1, 501, 10**9, "12", 12.5, True, False])
def test_rejects_out_of_range_or_wrong_typed_headcount(all_yes, bad):
    with pytest.raises(ValidationError, match="headcount"):
        validation.validate_submission({"answers": all_yes, "profile": {"headcount": bad}})


@pytest.mark.parametrize("good", [1, 5, 50, 500])
def test_accepts_plausible_headcounts(all_yes, good):
    clean = validation.validate_submission(
        {"answers": all_yes, "profile": {"headcount": good}}
    )
    assert clean["profile"]["headcount"] == good


def test_rejects_an_overlong_business_name(all_yes):
    with pytest.raises(ValidationError, match="business_name"):
        validation.validate_submission(
            {"answers": all_yes, "profile": {"business_name": "x" * 200}}
        )


def test_blank_optional_fields_are_dropped_not_stored(all_yes):
    clean = validation.validate_submission(
        {"answers": all_yes, "profile": {"business_name": "   ", "contact_email": ""}}
    )
    assert clean["profile"] == {}


@pytest.mark.parametrize("bad", ["no-at-sign", "@leading", "trailing@", "two@at@signs"])
def test_rejects_malformed_email(all_yes, bad):
    with pytest.raises(ValidationError, match="contact_email"):
        validation.validate_submission(
            {"answers": all_yes, "profile": {"contact_email": bad}}
        )


def test_answers_are_rebuilt_not_passed_through(all_yes):
    """The returned dict must be ours, so nothing unchecked rides along."""
    submitted = dict(all_yes)
    clean = validation.validate_submission({"answers": submitted})
    assert clean["answers"] is not submitted
    assert set(clean["answers"]) == set(all_yes)


def test_round_trips_through_parse_body(all_yes):
    body = validation.parse_body(json.dumps({"answers": all_yes}))
    assert validation.validate_submission(body)["answers"] == all_yes
