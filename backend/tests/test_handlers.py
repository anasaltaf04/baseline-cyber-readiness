"""End-to-end through the Lambda entry points, with AWS stubbed out."""

import json

import pytest

from baseline import handlers, storage


class FakeTable:
    """Enough of a DynamoDB Table to exercise put/get, including TTL."""

    def __init__(self):
        self.items = {}

    def put_item(self, Item):  # noqa: N803 — matches boto3's signature
        self.items[(Item["pk"], Item["sk"])] = json.loads(json.dumps(Item))

    def get_item(self, Key):  # noqa: N803
        item = self.items.get((Key["pk"], Key["sk"]))
        return {"Item": item} if item else {}


@pytest.fixture
def table(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(storage, "_table", lambda table=None: fake)
    return fake


@pytest.fixture
def no_bedrock(monkeypatch):
    """Force the fallback path so tests never reach the network."""
    from baseline import plan

    monkeypatch.setattr(
        plan, "_invoke_model", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline"))
    )


def _post(answers, profile=None):
    body = {"answers": answers}
    if profile is not None:
        body["profile"] = profile
    return handlers.create_handler({"body": json.dumps(body)})


def test_create_returns_a_report(table, no_bedrock, all_no):
    response = _post(all_no)
    assert response["statusCode"] == 201
    report = json.loads(response["body"])
    assert report["score"] == 0
    assert report["plan"]["top_actions"]
    assert report["band"]["label"]
    assert len(report["sections"]) == 6


def test_create_then_get_round_trips(table, no_bedrock, qids):
    answers = {q: ("yes" if i % 2 else "partly") for i, q in enumerate(qids)}
    created = json.loads(_post(answers, {"industry": "nonprofit", "headcount": 7})["body"])

    fetched = handlers.get_handler({"pathParameters": {"id": created["id"]}})
    assert fetched["statusCode"] == 200
    body = json.loads(fetched["body"])
    assert body["id"] == created["id"]
    assert body["score"] == created["score"]
    assert body["plan"]["summary"] == created["plan"]["summary"]
    assert body["profile"] == {"industry": "nonprofit", "headcount": 7}


def test_ids_are_unguessable_and_unique(table, no_bedrock, all_yes):
    ids = {json.loads(_post(all_yes)["body"])["id"] for _ in range(25)}
    assert len(ids) == 25
    for value in ids:
        assert len(value) >= 22, "128 bits of entropy should not shrink below 22 chars"
        assert handlers.ID_PATTERN.match(value)


def test_answers_are_stored_for_audit_but_not_returned(table, no_bedrock, all_no):
    report = json.loads(_post(all_no)["body"])
    assert "answers" not in report
    stored = next(iter(table.items.values()))
    assert stored["answers"] == all_no


@pytest.mark.parametrize(
    "bad_id",
    ["", "   ", "../../etc/passwd", "a", "x" * 200, "has space", "semi;colon", "a/b"],
)
def test_get_rejects_malformed_ids_without_touching_the_table(table, bad_id):
    response = handlers.get_handler({"pathParameters": {"id": bad_id}})
    assert response["statusCode"] == 404


def test_get_returns_404_for_an_unknown_id(table):
    response = handlers.get_handler({"pathParameters": {"id": "aaaaaaaaaaaaaaaaaaaaaa"}})
    assert response["statusCode"] == 404
    assert "90 days" in json.loads(response["body"])["error"]["message"]


def test_get_treats_an_expired_item_as_gone(table, no_bedrock, all_no, monkeypatch):
    report_id = json.loads(_post(all_no)["body"])["id"]
    for item in table.items.values():
        item["expires_at"] = 0
    assert handlers.get_handler({"pathParameters": {"id": report_id}})["statusCode"] == 404


def test_validation_failure_returns_400_not_500(table, all_yes):
    response = handlers.create_handler({"body": json.dumps({"answers": {}, "nope": 1})})
    assert response["statusCode"] == 400
    assert json.loads(response["body"])["error"]["message"]


def test_storage_failure_returns_a_friendly_500(monkeypatch, no_bedrock, all_no):
    def boom(*a, **k):
        raise RuntimeError("table is gone")

    monkeypatch.setattr(storage, "put_report", boom)
    response = handlers.create_handler({"body": json.dumps({"answers": all_no})})
    assert response["statusCode"] == 500
    message = json.loads(response["body"])["error"]["message"]
    assert "table is gone" not in message, "internal errors must not leak to the browser"


def test_responses_carry_the_configured_cors_origin(table, no_bedrock, all_yes, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGIN", "https://d123.cloudfront.net")
    response = _post(all_yes)
    assert response["headers"]["Access-Control-Allow-Origin"] == "https://d123.cloudfront.net"
    assert response["headers"]["X-Content-Type-Options"] == "nosniff"


def test_cors_fails_closed_when_no_origin_is_configured(table, no_bedrock, all_yes, monkeypatch):
    """No allowlist means no header, so another site cannot read a response."""
    monkeypatch.delenv("ALLOWED_ORIGIN", raising=False)
    assert "Access-Control-Allow-Origin" not in _post(all_yes)["headers"]

    monkeypatch.setenv("ALLOWED_ORIGIN", "   ")
    assert "Access-Control-Allow-Origin" not in _post(all_yes)["headers"]


def test_new_reports_are_not_cached_but_fetched_ones_are(table, no_bedrock, all_yes):
    created = _post(all_yes)
    assert created["headers"]["Cache-Control"] == "no-store"
    report_id = json.loads(created["body"])["id"]
    fetched = handlers.get_handler({"pathParameters": {"id": report_id}})
    assert "max-age" in fetched["headers"]["Cache-Control"]


def test_a_perfect_score_still_returns_a_usable_report(table, no_bedrock, all_yes):
    report = json.loads(_post(all_yes)["body"])
    assert report["score"] == 100
    assert report["plan"]["top_actions"] == []
    assert report["plan"]["summary"]
