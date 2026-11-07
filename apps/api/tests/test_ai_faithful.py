"""ALERT_NARRATION_FAITHFUL: model text may state only what Python gave it."""

from __future__ import annotations

import pytest

from app.ai.faithful import all_faithful, allowed_tokens, invented_names, tokens, unfaithful

FACTS = {
    "employee": "EMP-0088",
    "name": "Sanjeev Rana",
    "document": "residency_visa",
    "expires_on": "2026-11-12",
    "days_left": 7,
    "project": "RAK-01",
    "threshold": 7,
}
TEMPLATE_TITLE = "Sanjeev Rana: residency visa ends in 7 days (12 Nov 2026)"
TEMPLATE_BODY = "The residency visa of Sanjeev Rana (EMP-0088) ends in 7 days, on 12 Nov 2026."


@pytest.fixture
def allowed() -> set[str]:
    return allowed_tokens(FACTS, TEMPLATE_TITLE, TEMPLATE_BODY)


def test_tokens_find_dates_codes_times_and_numbers_once_each() -> None:
    found = tokens(
        "RAK-07 starts 12 Feb 2027 at 06:00: 1,200 workers, 3.5 shifts, ref MOB-2026-0107"
    )
    assert found == {
        "code:RAK-07",
        "date:12 Feb 2027",
        "time:06:00",
        "number:1200",
        "number:3.5",
        "code:MOB-2026-0107",
    }


def test_an_iso_date_in_the_facts_allows_the_date_as_alerts_write_it() -> None:
    assert "date:12 Nov 2026" in allowed_tokens({"expires_on": "2026-11-12T00:00:00+04:00"})


def test_wording_made_of_the_facts_passes(allowed: set[str]) -> None:
    text = "Sanjeev Rana (EMP-0088) on RAK-01: the residency visa ends on 12 Nov 2026, in 7 days."
    assert unfaithful(text, allowed) == []


def test_the_year_may_be_left_off_a_date_that_is_in_the_facts(allowed: set[str]) -> None:
    assert unfaithful("The visa ends on 12 Nov.", allowed) == []


@pytest.mark.parametrize(
    ("text", "invented"),
    [
        ("The visa ends in 14 days.", ["14"]),  # an invented number
        ("The visa ends on 19 Nov 2026.", ["19 Nov 2026"]),  # a shifted date
        ("Move him to RAK-09 now.", ["RAK-09"]),  # a project the facts never mention
        ("Check EMP-0099 too.", ["EMP-0099"]),  # an invented employee code
        ("Call HR before 17:30.", ["17:30"]),  # an invented time
        ("It has been waiting 41 hours.", ["41"]),
    ],
)
def test_anything_python_never_said_is_caught(
    text: str, invented: list[str], allowed: set[str]
) -> None:
    assert unfaithful(text, allowed) == invented


def test_every_text_is_checked_and_the_problems_are_collected(allowed: set[str]) -> None:
    bad = all_faithful(["Fine: 7 days", "Not fine: 3 days", "Also not: RAK-09"], allowed)
    assert bad == ["3", "RAK-09"]


def test_numbers_inside_a_code_or_date_are_not_read_as_separate_numbers() -> None:
    allowed = allowed_tokens("RAK-07 starts 12 Feb 2027")
    assert unfaithful("RAK-07 starts 12 Feb 2027", allowed) == []
    # "07" and "2027" are not free-standing numbers just because they sit inside a code or a date.
    assert unfaithful("07 people", allowed) == ["7"]


def test_thousands_separators_do_not_change_a_number() -> None:
    assert unfaithful("1,200 workers", allowed_tokens({"count": 1200})) == []


def test_names_and_ordinary_words_are_not_checked(allowed: set[str]) -> None:
    assert unfaithful("Please ask Priya to speak with the worker today.", allowed) == []


def test_a_name_the_facts_never_mention_is_caught_by_the_chat_check() -> None:
    facts = {"people": [{"name": "Anil Kumar", "trade": "Steel fixer"}], "project": "Shamal Hub"}
    assert invented_names("Anil Kumar is a steel fixer on Shamal Hub.", facts) == []
    assert invented_names("Mohammed Salim Rahman is free.", facts) == ["Mohammed Salim Rahman"]
    assert invented_names("Ask Priya Sharma about it.", facts, "ask priya sharma") == []
    assert (
        invented_names("There are 12 workers and no one is late.", facts) == []
    )  # one word is fine
