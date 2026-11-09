"""The MD's dashboard and briefing: numbers from Python, wording checked, and never a failure."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ai.deps import light_client
from app.ai.llm import LLMReply, Message
from app.routes.executive import health_of
from tests.support import CEO, HR_MANAGER, ScriptedLLM, provider_down, sign_in


@pytest.fixture
def desk(make_client: Callable[..., TestClient]) -> tuple[TestClient, TestClient, TestClient]:
    manager, ceo, anon = make_client(), make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(ceo, CEO)
    return manager, ceo, anon


def use(clients: Sequence[TestClient], model: ScriptedLLM | None) -> None:
    for c in clients:
        cast(FastAPI, c.app).dependency_overrides[light_client] = lambda: model


def test_the_dashboard_numbers_agree_with_the_screens(
    desk: tuple[TestClient, TestClient, TestClient],
) -> None:
    manager, ceo, _ = desk
    d = ceo.get("/executive/dashboard")
    assert d.status_code == 200, d.text
    body = d.json()
    summary = ceo.get("/summary").json()
    assert body["people"]["total"] == summary["workforce"]["total"]
    assert body["people"]["deployed"] == summary["workforce"]["deployed"]
    assert body["hr"]["documents"] == summary["documents"]
    alerts = ceo.get("/alerts/summary").json()["counts"]
    assert (body["hr"]["critical"], body["hr"]["action_needed"]) == (
        alerts["critical"],
        alerts["action_needed"],
    )
    assert {p["code"] for p in body["projects"]} == {p["code"] for p in summary["projects"]}
    assert all(p["gap"] == max(p["planned"] - p["deployed"], 0) for p in body["projects"])
    assert manager.get("/executive/dashboard").json()["hr"] == body["hr"]  # HR sees the same


@pytest.mark.parametrize(
    ("status", "planned", "deployed", "progress", "expected"),
    [
        ("active", 10, 10, 80, "on_track"),
        ("active", 10, 6, 20, "needs_people"),
        ("active", 10, 6, 70, "at_risk"),
        ("planning", 10, 0, 0, "planning"),
        ("on_hold", 10, 4, 30, "planning"),
        ("completed", 10, 10, 100, "done"),
    ],
)
def test_project_health_is_a_rule(
    status: str, planned: int, deployed: int, progress: int, expected: str
) -> None:
    assert health_of(status, planned, deployed, progress) == expected


def test_without_a_model_the_briefing_is_python_and_true(
    desk: tuple[TestClient, TestClient, TestClient],
) -> None:
    manager, ceo, _ = desk
    use([manager, ceo], None)
    brief = ceo.post("/executive/brief").json()
    assert brief["ai_worded"] is False and 3 <= len(brief["bullets"]) <= 6
    people = ceo.get("/summary").json()["workforce"]
    assert f"{people['deployed']} of {people['total']} people are deployed" in brief["bullets"][0]
    assert manager.post("/executive/brief").status_code == 200  # HR may read it too


def test_a_model_wording_made_of_the_facts_is_kept_and_an_invented_one_is_not(
    desk: tuple[TestClient, TestClient, TestClient],
) -> None:
    _, ceo, _ = desk
    people = ceo.get("/summary").json()["workforce"]
    good = [
        f"{people['deployed']} of {people['total']} people are deployed.",
        "Documents need attention this week.",
        "HR still has alerts to clear before the end of the week.",
    ]
    use([ceo], ScriptedLLM([json.dumps({"bullets": good})]))
    kept = ceo.post("/executive/brief").json()
    assert kept["ai_worded"] is True and kept["bullets"] == good

    bad = [*good[:2], "Exactly 4321 workers will quit tomorrow."]
    use([ceo], ScriptedLLM([json.dumps({"bullets": bad})]))
    dropped = ceo.post("/executive/brief").json()
    assert dropped["ai_worded"] is False and "4321" not in json.dumps(dropped)


def test_a_model_that_fails_never_breaks_the_briefing(
    desk: tuple[TestClient, TestClient, TestClient],
) -> None:
    _, ceo, _ = desk

    def broken(messages: Sequence[Message]) -> str | LLMReply:
        raise provider_down()

    use([ceo], ScriptedLLM(broken))
    assert ceo.post("/executive/brief").json()["ai_worded"] is False
    use([ceo], ScriptedLLM(["not json", "still not json"]))
    assert ceo.post("/executive/brief").json()["ai_worded"] is False


def test_the_dashboard_needs_a_sign_in(desk: tuple[TestClient, TestClient, TestClient]) -> None:
    anon = desk[2]
    assert anon.get("/executive/dashboard").status_code == 401
    assert anon.post("/executive/brief").status_code == 401


def test_the_briefing_never_carries_a_phone_or_document_number(
    desk: tuple[TestClient, TestClient, TestClient],
) -> None:
    _, ceo, _ = desk
    prompts: list[Any] = []

    def spy(messages: Sequence[Message]) -> str | LLMReply:
        prompts.append(messages)
        return "not json"

    use([ceo], ScriptedLLM(spy))
    ceo.post("/executive/brief")
    sent = json.dumps(prompts).lower()
    assert "doc_number" not in sent and "phone" not in sent and "whatsapp" not in sent
