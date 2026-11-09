"""The project overview: the same numbers as the projects list, plus where, when and who."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.routes.project_overview import progress_of
from tests.support import CEO, HR_MANAGER, sign_in


@pytest.fixture
def clients(make_client: Callable[..., TestClient]) -> tuple[TestClient, TestClient]:
    manager, ceo = make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(ceo, CEO)
    return manager, ceo


def test_the_overview_agrees_with_the_projects_list(clients: tuple[TestClient, TestClient]) -> None:
    manager, _ = clients
    listed = next(p for p in manager.get("/projects").json() if p["code"] == "RAK-03")
    view = manager.get("/projects/RAK-03/overview")
    assert view.status_code == 200, view.text
    o = view.json()
    assert (o["planned"], o["deployed"]) == (listed["planned"], listed["deployed"])
    assert o["gap"] == max(o["planned"] - o["deployed"], 0)
    assert sum(t["planned"] for t in o["trades"]) == o["planned"]
    assert sum(t["deployed"] for t in o["trades"]) == o["deployed"]
    assert all(t["gap"] == max(t["planned"] - t["deployed"], 0) for t in o["trades"])
    assert o["name"] == listed["name"] and o["status"] == "active"
    assert o["sites"], "a project has a site and a place"


def test_the_staff_list_is_the_people_on_the_project_without_phones(
    clients: tuple[TestClient, TestClient],
) -> None:
    manager, _ = clients
    o = manager.get("/projects/RAK-03/overview").json()
    assert o["staff_total"] == len(o["staff"]) > 0
    first = o["staff"][0]
    assert set(first) == {"code", "name", "trade", "level", "status", "starts", "ends", "site"}
    found = manager.get("/workers", params={"project": "RAK-03", "limit": 200}).json()
    assert {p["code"] for p in o["staff"]} >= {w["code"] for w in found["items"]} - {
        w["code"] for w in found["items"] if w["status"] not in ("deployed", "mobilizing")
    }


def test_progress_runs_with_the_calendar_and_is_python() -> None:
    starts, ends = date(2026, 1, 1), date(2026, 1, 11)
    assert progress_of("active", starts, ends, date(2025, 12, 1)) == 0
    assert progress_of("active", starts, ends, date(2026, 1, 6)) == 50
    assert progress_of("active", starts, ends, date(2027, 1, 1)) == 100
    assert progress_of("completed", None, None, date(2026, 1, 6)) == 100
    assert progress_of("planning", None, ends, date(2026, 1, 6)) is None


def test_the_md_can_read_it_and_an_unknown_project_is_not_found(
    clients: tuple[TestClient, TestClient],
) -> None:
    manager, ceo = clients
    assert ceo.get("/projects/RAK-03/overview").status_code == 200
    assert manager.get("/projects/NOPE-99/overview").status_code == 404
