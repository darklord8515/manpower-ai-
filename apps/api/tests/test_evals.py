"""The eval runner (`make eval`): its cases are well formed, it passes a model that behaves, and it
catches one that does not. The model here is a script; nothing reaches a provider.

Real pass rates need a real model (`make eval` with LLM_TIER_MID_* set); this proves the runner and
the cases themselves are sound.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import sessionmaker

from app.ai.evals import GOLDEN, Result, load_cases, problems_in, report, run_case
from app.ai.llm import LLMReply, Message
from app.seed.load import seed_demo
from tests.support import ScriptedLLM, make_settings
from tests.test_workforce_agent import call, explains, results, well_behaved

CASES = {c["id"]: c for c in load_cases()}


def behaving(messages: Sequence[Message]) -> str | LLMReply:
    if any(str(m["content"]).startswith("<forecast_data>") for m in messages):
        return explains(messages)
    return well_behaved(messages)


@pytest.fixture
def seeded(migrated_db: Engine) -> sessionmaker[Any]:
    with migrated_db.begin() as connection:
        seed_demo(connection, make_settings())
    return sessionmaker(bind=migrated_db, expire_on_commit=False)


def run(factory: sessionmaker[Any], model: ScriptedLLM, case_id: str) -> Result:
    return run_case(factory, make_settings(), model, CASES[case_id])


# ------------------------------------------------------------------------------- the cases


def test_every_golden_case_is_well_formed() -> None:
    assert len(CASES) >= 8
    for case in CASES.values():
        assert problems_in(case) == [], case["id"]
    ids = [c["id"] for c in load_cases()]
    assert len(ids) == len(set(ids))


def test_the_full_product_suite_is_kept_for_later_and_is_not_what_runs() -> None:
    later = load_cases(Path(GOLDEN).with_name("post-mvp.yaml"))
    assert len(later) == 35 and not set(c["id"] for c in later) & set(CASES)


def test_a_case_with_a_typo_fails_instead_of_passing() -> None:
    bad = {
        "id": "X-1", "title": "t", "user": "nobody", "kind": "recommend_line",
        "expect": {"outcome": "succeeded", "checks": {"proposd_count": 7}},
        "extra": 1,
    }  # fmt: skip
    found = problems_in(bad)
    assert "unsupported check 'proposd_count'" in found
    assert "unknown user 'nobody'" in found and "unknown key 'extra'" in found


def test_a_case_marked_post_mvp_is_skipped_and_says_why(seeded: sessionmaker[Any]) -> None:
    case = {**CASES["WF-01"], "phase": "post_mvp", "note": "needs the Command Centre"}
    outcome = run_case(seeded, make_settings(), ScriptedLLM(behaving), case)
    assert outcome.skipped == "needs the Command Centre" and outcome.passed is False


# ---------------------------------------------------------------------- a model that behaves


def test_a_model_that_behaves_passes_every_case(seeded: sessionmaker[Any]) -> None:
    model = ScriptedLLM(behaving, model="fake-mid")
    outcomes = [run_case(seeded, make_settings(), model, c) for c in CASES.values()]
    lines: list[str] = []
    assert report(outcomes, lines.append) is True, "\n".join(lines)
    assert all(o.passed for o in outcomes)
    assert lines[-2].startswith(f"{len(CASES)} passed, 0 failed, 0 skipped · pass rate 100%")
    assert any(line.startswith("PASS  WF-01") for line in lines)


def test_a_case_that_edits_the_data_puts_it_back(seeded: sessionmaker[Any]) -> None:
    def note() -> str | None:
        with seeded() as s:
            return s.execute(
                text("SELECT source_text FROM staffing_requests WHERE request_no = 'SR-2026-0001'")
            ).scalar_one()

    before = note()
    for case_id in ("WF-03", "WF-05"):  # both write a request note for the run
        run(seeded, ScriptedLLM(behaving), case_id)
        assert note() == before


def test_the_run_is_logged_like_any_other(seeded: sessionmaker[Any]) -> None:
    outcome = run(seeded, ScriptedLLM(behaving, model="fake-mid"), "WF-01")
    assert outcome.passed and (outcome.tokens_in, outcome.tokens_out) == (30, 60)
    with seeded() as s:
        row = s.execute(text("SELECT status::text, model FROM agent_runs")).one()
    assert tuple(row) == ("succeeded", "fake-mid")


# ------------------------------------------------------------------ a model that does not


def test_a_model_that_picks_too_few_people_fails_the_count(seeded: sessionmaker[Any]) -> None:
    def lazy(messages: Sequence[Message]) -> str | LLMReply:
        seen = results(messages)
        if not seen:
            return call("get_request_line")
        if len(seen) == 1:
            return call("search_candidates")
        pick = seen[1]["candidates"][0]
        return call(
            "recommend_candidates", selections=[{"code": pick["code"], "reason": "Free now"}]
        )

    outcome = run(seeded, ScriptedLLM(lazy), "WF-01")
    assert not outcome.passed and "proposed 1 people, expected 7" in outcome.failures


def test_a_model_that_never_finishes_fails_the_outcome(seeded: sessionmaker[Any]) -> None:
    outcome = run(seeded, ScriptedLLM(lambda m: call("get_request_line")), "WF-01")
    assert not outcome.passed
    assert any(f.startswith("outcome was failed") for f in outcome.failures)
    assert "did not call search_candidates" in outcome.failures


def test_an_explanation_with_a_made_up_number_fails_the_forecast_check(
    seeded: sessionmaker[Any],
) -> None:
    def invents(messages: Sequence[Message]) -> str | LLMReply:
        return '{"summary": "RAK-07 is short of 99 people, so recruit them all this week."}'

    outcome = run(seeded, ScriptedLLM(invents), "WF-06")
    assert not outcome.passed
    assert any("rejected: states 99" in f for f in outcome.failures)


def test_a_case_whose_user_cannot_do_it_fails_when_the_run_is_not_refused(
    seeded: sessionmaker[Any],
) -> None:
    case = {**CASES["WF-04"], "user": "hr_exec"}  # the Executive may, so the run is not refused
    outcome = run_case(seeded, make_settings(), ScriptedLLM(behaving), case)
    assert not outcome.passed and any(
        f.startswith("outcome was succeeded") for f in outcome.failures
    )


def test_the_report_names_each_problem_and_counts_what_ran() -> None:
    lines: list[str] = []
    ok = report(
        [
            Result("A", "passes", tokens_in=10, tokens_out=5, seconds=1.0),
            Result("B", "fails", failures=["did not call x"]),
            Result("C", "later", skipped="needs the Command Centre"),
        ],
        lines.append,
    )
    assert ok is False
    assert lines[0].startswith("PASS  A") and lines[1] == "FAIL  B        fails"
    assert lines[2] == "        - did not call x"
    assert lines[3] == "SKIP  C        later  [needs the Command Centre]"
    assert "1 passed, 1 failed, 1 skipped · pass rate 50%" in lines
