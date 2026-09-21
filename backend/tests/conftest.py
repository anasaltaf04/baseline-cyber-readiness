import pytest

from baseline import question_bank


@pytest.fixture
def qids():
    return sorted(question_bank.question_ids())


@pytest.fixture
def all_yes(qids):
    return {q: "yes" for q in qids}


@pytest.fixture
def all_no(qids):
    return {q: "no" for q in qids}
