"""The calendar: one list of everything with a date, and what HR may add to it."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.services import holidays
from tests.support import CEO, HR_MANAGER, sign_in


@pytest.fixture
def desk(make_client: Callable[..., TestClient]) -> tuple[TestClient, TestClient]:
    manager, ceo = make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(ceo, CEO)
    return manager, ceo


def month(client: TestClient, start: str, end: str) -> dict[str, Any]:
    response = client.get("/calendar", params={"start": start, "end": end})
    assert response.status_code == 200, response.text
    return response.json()


def kinds(view: dict[str, Any]) -> set[str]:
    return {e["kind"] for e in view["entries"]}


def test_a_month_gathers_leaves_events_holidays_project_dates_and_documents(
    desk: tuple[TestClient, TestClient],
) -> None:
    manager, _ = desk
    nov = month(manager, "2026-11-01", "2026-11-30")
    assert {"leave", "meeting", "deadline", "documents"} <= kinds(nov)
    leave = next(e for e in nov["entries"] if e["kind"] == "leave" and "EMP-0161" in e["detail"])
    assert (leave["starts"], leave["ends"]) == ("2026-11-16", "2026-11-22")
    assert leave["href"] == "/workers?worker=EMP-0161" and leave["editable"] is True
    assert any(e["title"] == "MoHRE quota submission deadline" for e in nov["entries"])
    dec = month(manager, "2026-12-01", "2026-12-31")
    national = next(e for e in dec["entries"] if e["kind"] == "holiday")
    assert (national["starts"], national["ends"]) == ("2026-12-01", "2026-12-03")
    assert national["expected"] is False
    dates = [e["starts"] for e in nov["entries"]]
    assert dates == sorted(dates)


def test_documents_are_grouped_by_day_and_never_carry_a_number(
    desk: tuple[TestClient, TestClient],
) -> None:
    manager, _ = desk
    nov = month(manager, "2026-11-01", "2026-11-30")
    docs = [e for e in nov["entries"] if e["kind"] == "documents"]
    assert docs and len({e["starts"] for e in docs}) == len(docs)
    # the next 30 days from the demo date, as the Documents screen counts them
    ahead = month(manager, "2026-11-05", "2026-12-05")["entries"]
    api = manager.get("/documents/expiring", params={"window": "d30"}).json()["counts"]
    assert sum(int(e["title"].split()[0]) for e in ahead if e["kind"] == "documents") == api["d30"]
    assert all(
        set(e)
        == {"id", "kind", "title", "detail", "starts", "ends", "href", "editable", "expected"}
        for e in docs
    )


def test_the_moon_dates_say_they_are_expected() -> None:
    eid = next(h for h in holidays.HOLIDAYS if h.name == "Eid al-Fitr")
    assert eid.expected is True
    assert holidays.between(eid.starts, eid.ends)[0].name == "Eid al-Fitr"
    assert holidays.between(eid.ends.replace(year=2030), eid.ends.replace(year=2030)) == []


def test_the_md_reads_the_same_calendar_and_cannot_edit_it(
    desk: tuple[TestClient, TestClient],
) -> None:
    manager, ceo = desk
    a, b = month(manager, "2026-11-01", "2026-11-30"), month(ceo, "2026-11-01", "2026-11-30")
    assert [e["id"] for e in a["entries"]] == [e["id"] for e in b["entries"]]
    assert b["can_edit"] is False and all(not e["editable"] for e in b["entries"])
    body = {"title": "Nope", "starts_on": "2026-11-20"}
    assert ceo.post("/calendar/events", json=body).status_code == 403
    leave = {"employee_code": "EMP-0107", "starts_on": "2026-12-01", "ends_on": "2026-12-02"}
    assert ceo.post("/calendar/leaves", json=leave).status_code == 403


def test_hr_adds_an_event_it_shows_and_it_can_be_removed(
    desk: tuple[TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, ceo = desk
    made = manager.post(
        "/calendar/events",
        json={
            "title": "  Site   visit with the client ",
            "starts_on": "2026-11-20",
            "kind": "meeting",
        },
    )
    assert made.status_code == 201, made.text
    entry = made.json()
    assert entry["title"] == "Site visit with the client" and entry["editable"] is True
    assert any(e["id"] == entry["id"] for e in month(ceo, "2026-11-01", "2026-11-30")["entries"])
    event_id = entry["id"].split(":", 1)[1]
    assert manager.delete(f"/calendar/events/{event_id}").status_code == 204
    assert manager.delete(f"/calendar/events/{event_id}").status_code == 404
    with migrated_db.connect() as c:
        actions = {r[0] for r in c.execute(text("SELECT action FROM audit_log"))}
    assert {"calendar.event_added", "calendar.event_removed"} <= actions


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x", "starts_on": "2026-11-20"},
        {"title": "Backwards", "starts_on": "2026-11-20", "ends_on": "2026-11-19"},
        {"title": "Odd kind", "starts_on": "2026-11-20", "kind": "party"},
    ],
)
def test_a_bad_event_is_refused(desk: tuple[TestClient, TestClient], body: dict[str, str]) -> None:
    assert desk[0].post("/calendar/events", json=body).status_code == 422


def test_hr_adds_a_leave_and_overlaps_are_refused(desk: tuple[TestClient, TestClient]) -> None:
    manager, _ = desk
    body = {
        "employee_code": "EMP-0088",
        "leave_type": "sick",
        "starts_on": "2026-12-05",
        "ends_on": "2026-12-07",
    }
    made = manager.post("/calendar/leaves", json=body)
    assert made.status_code == 201, made.text
    assert "on leave" in made.json()["title"]
    clash = manager.post(
        "/calendar/leaves", json={**body, "starts_on": "2026-12-06", "ends_on": "2026-12-09"}
    )
    assert clash.status_code == 409 and "overlaps" in clash.text
    dec = month(manager, "2026-12-01", "2026-12-31")
    assert any(e["id"] == made.json()["id"] for e in dec["entries"])
    leave_id = made.json()["id"].split(":", 1)[1]
    assert manager.delete(f"/calendar/leaves/{leave_id}").status_code == 204
    assert manager.delete(f"/calendar/leaves/{leave_id}").status_code == 404


def test_a_bad_leave_is_refused(desk: tuple[TestClient, TestClient]) -> None:
    manager, _ = desk
    good = {"employee_code": "EMP-0088", "starts_on": "2026-12-05", "ends_on": "2026-12-07"}
    assert (
        manager.post("/calendar/leaves", json={**good, "employee_code": "EMP-9999"}).status_code
        == 404
    )
    assert (
        manager.post("/calendar/leaves", json={**good, "ends_on": "2026-12-01"}).status_code == 422
    )
    assert (
        manager.post("/calendar/leaves", json={**good, "ends_on": "2027-12-07"}).status_code == 422
    )
    assert (
        manager.post("/calendar/leaves", json={**good, "leave_type": "holiday"}).status_code == 422
    )


def test_the_range_must_be_sensible(desk: tuple[TestClient, TestClient]) -> None:
    manager, _ = desk
    assert (
        manager.get("/calendar", params={"start": "2026-11-30", "end": "2026-11-01"}).status_code
        == 422
    )
    assert (
        manager.get("/calendar", params={"start": "2026-01-01", "end": "2027-01-01"}).status_code
        == 422
    )
    assert manager.get("/calendar").status_code == 422
