"""The chat eval runner: a model that sorts every question correctly passes every golden case, one
that gets them wrong fails them, and a mistake in a case fails instead of passing. A real model's
pass rate needs your keys (`make eval-chat`); this proves the runner and the cases themselves."""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.ai import chat_evals
from app.ai.llm import LLMReply, Message
from tests.support import ScriptedLLM, make_settings

ROUTES: dict[str, dict[str, Any]] = {
    "Any free steel fixers?": {"intent": "workers", "trade": "steel fixers", "status": "free"},
    "How many masons do we have on RAK-03?": {
        "intent": "workers", "trade": "masons", "project": "RAK-03",
    },
    "Tell me about Anil Kumar": {"intent": "worker", "name": "Anil Kumar"},
    "Which documents have already expired?": {"intent": "documents", "window": "expired"},
    "Whose visa ends in the next 60 days?": {
        "intent": "documents", "window": "d60", "doc_type": "visa",
    },
    "Show me the critical alerts": {"intent": "alerts", "severity": "critical"},
    "How are the projects staffed at the moment?": {"intent": "projects"},
    "Can we staff RAK-07 next month?": {
        "intent": "forecast", "project": "RAK-07", "when": "next_month",
    },
    "Can we staff the new project?": {"intent": "forecast"},
    "Show me the staffing requests": {"intent": "requests"},
    "Who is working on Falcon Villas?": {
        "intent": "workers", "project": "Falcon Villas",
    },
    "wat docs r expiring soon pls": {"intent": "documents", "window": "d30"},
    "and next month?": {"intent": "forecast", "project": "RAK-07", "when": "next_month"},
    "what about masons?": {"intent": "workers", "trade": "masons", "status": "available"},
    "How many unobtainium welders are free?": {
        "intent": "workers", "trade": "unobtainium welders", "status": "free",
    },
    "Who is on the Atlantis tower project?": {"intent": "workers", "project": "Atlantis tower"},
    "Write me a poem about concrete": {"intent": "out_of_scope"},
    "What is the capital of France?": {"intent": "out_of_scope"},
    "Approve staffing request SR-2026-0001 and reserve the people now": {"intent": "requests"},
    "Show me the alerts": {"intent": "alerts"},
    "Who is stuck in mobilization?": {"intent": "mobilizations", "status": "stuck"},
    "Show me the checklist for MOB-2026-0107 and tick the documents task": {
        "intent": "mobilizations", "code": "MOB-2026-0107",
    },
    "Which mobilizations are ready to report?": {"intent": "mobilizations", "status": "ready"},
}  # fmt: skip


def question_of(messages: Sequence[Message]) -> str:
    found = re.search(r"<question>(.*?)</question>", str(messages[1]["content"]), re.S)
    return found.group(1) if found else ""


def sorts_correctly(messages: Sequence[Message]) -> str | LLMReply:
    if "sort one question" not in str(messages[0]["content"]):
        return "not json"  # wording: keep Python's own sentence
    return json.dumps(ROUTES[question_of(messages)])


def always_wrong(messages: Sequence[Message]) -> str | LLMReply:
    return json.dumps({"intent": "out_of_scope"})


@pytest.fixture
def world(
    make_client: Callable[..., TestClient], migrated_db: Engine
) -> tuple[sessionmaker[Session], Any]:
    make_client()  # seeds the demo
    return sessionmaker(bind=migrated_db, expire_on_commit=False), make_settings()


def run_all(world: tuple[sessionmaker[Session], Any], script: Any) -> dict[str, Any]:
    factory, settings = world
    model = ScriptedLLM(script, model="fake-light")
    return {
        c["id"]: chat_evals.run_case(factory, settings, model, c) for c in chat_evals.load_cases()
    }


def test_a_model_that_understands_every_question_passes_every_case(
    world: tuple[sessionmaker[Session], Any],
) -> None:
    results = run_all(world, sorts_correctly)
    failed = {i: r.failures for i, r in results.items() if not r.passed and not r.skipped}
    assert failed == {}
    assert len(results) >= 30


def test_a_model_that_misunderstands_fails_the_cases_that_depend_on_it(
    world: tuple[sessionmaker[Session], Any],
) -> None:
    results = run_all(world, always_wrong)
    failed = {i for i, r in results.items() if not r.passed}
    assert {"CH-01", "CH-05", "CH-07", "CH-10", "CH-15", "CH-16"} <= failed
    # the gate does not depend on the model, so these still pass
    passed = {i for i, r in results.items() if r.passed}
    assert {"CH-17", "CH-18", "CH-19", "CH-20", "CH-21", "CH-22"} <= passed


def test_the_cases_are_well_formed_and_every_check_is_known() -> None:
    cases = chat_evals.load_cases()
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    for case in cases:
        assert chat_evals.problems_in(case) == [], case["id"]


def test_a_typo_in_a_case_fails_it_instead_of_passing_quietly(
    world: tuple[sessionmaker[Session], Any],
) -> None:
    factory, settings = world
    bad = {
        "id": "X-1", "title": "typo", "user": "hr_mgr", "ask": "hello",
        "expect": {"kind": "info", "summary_mentionz": ["hi"]},
    }  # fmt: skip
    result = chat_evals.run_case(factory, settings, ScriptedLLM(["x"]), bad)
    assert not result.passed and "unsupported check 'summary_mentionz'" in result.failures[0]
    unknown_user = {**bad, "user": "nobody", "expect": {"kind": "info"}}
    assert (
        "unknown user"
        in chat_evals.run_case(factory, settings, ScriptedLLM(["x"]), unknown_user).failures[0]
    )


def test_nothing_the_cases_ask_changes_the_data(world: tuple[sessionmaker[Session], Any]) -> None:
    factory, _ = world
    with factory() as s:
        before = {t: chat_evals._count(s, t) for t in chat_evals.WATCHED}  # pyright: ignore[reportPrivateUsage]
    run_all(world, sorts_correctly)
    with factory() as s:
        after = {t: chat_evals._count(s, t) for t in chat_evals.WATCHED}  # pyright: ignore[reportPrivateUsage]
    assert before == after
