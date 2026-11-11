# ruff: noqa: E501
"""People, plans and the hiring board, on the small fictional tracker from test_tracker_import.

After importing STAFF_FILE, project ZA (Test Tower) plans 4 site engineers (Alice joined, Bob on
offer, two open), 1 admin officer for UAE nationals only, and Dan the planner; ZB (Second Site)
plans one planner.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_MANAGER, sign_in
from tests.test_tracker_import import STAFF_FILE


class Desk:
    def __init__(self, make_client: Callable[..., TestClient], engine: Engine) -> None:
        self.engine = engine
        self.hr = make_client()
        self.ceo = make_client()
        sign_in(self.hr, HR_MANAGER)
        sign_in(self.ceo, CEO)
        done = self.hr.post("/imports/trackers?kind=staff&apply=true", content=STAFF_FILE)
        assert done.status_code == 200, done.text

    def add(self, **fields: Any) -> Any:
        return self.hr.post("/workforce/people", json={"name": "New Person", **fields})

    def engineers(self) -> dict[str, Any]:
        plan = self.hr.get("/workforce/projects/ZA/plan").json()
        return next(r for r in plan["staff"] if r["designation"] == "Site engineer")

    def count(self, sql: str) -> int:
        with self.engine.connect() as c:
            return int(c.execute(text(sql)).scalar_one())


@pytest.fixture
def desk(make_client: Callable[..., TestClient], migrated_db: Engine) -> Desk:
    return Desk(make_client, migrated_db)


def test_adding_a_person_to_a_project_places_them_and_lowers_what_is_left_to_hire(
    desk: Desk,
) -> None:
    assert desk.engineers()["to_hire"] == 2
    placed = desk.add(name="Gil Test", designation="site engineer", project_code="ZA")
    assert placed.status_code == 201, placed.text
    body = placed.json()
    assert (body["project_code"], body["decided_by"], body["to_hire"]) == ("ZA", "hr", 1)
    assert "now has 3 of 4" in body["message"]
    assert desk.engineers()["to_hire"] == 1 and desk.engineers()["pipeline"] == 2
    board = desk.hr.get("/workforce/recruitment").json()
    row = next(r for r in board["rows"] if r["designation"] == "Site engineer")
    assert row["to_hire"] == 1 and row["projects"][0]["project_code"] == "ZA"
    assert desk.count("SELECT count(*) FROM workforce_events WHERE kind = 'placed'") == 1


def test_let_ai_decide_places_the_person_where_the_role_is_needed_and_says_why(desk: Desk) -> None:
    placed = desk.add(name="Hana Test", designation="Site engineer", auto=True)
    assert placed.status_code == 201, placed.text
    body = placed.json()
    assert body["project_code"] == "ZA" and body["decided_by"] == "ai"
    assert "2 of 4 Site engineer places are still open" in body["reason"]
    mine = desk.hr.get("/workforce/history", params={"by": "ai"}).json()
    assert [(e["kind"], e["person_name"], e["to_project"]) for e in mine] == [
        ("placed", "Hana Test", "Test Tower")
    ]
    nowhere = desk.add(
        name="Ian Test", designation="Cook", auto=True
    )  # no open Cook place anywhere
    assert nowhere.status_code == 409 and "No project has an open Cook place" in nowhere.text


def test_a_full_line_asks_before_anything_changes_and_hr_can_raise_the_plan(desk: Desk) -> None:
    for name in ("One", "Two"):
        assert (
            desk.add(name=name, designation="Site engineer", project_code="ZA").status_code == 201
        )
    people_before = desk.count("SELECT count(*) FROM employees")
    full = desk.add(name="Three", designation="Site engineer", project_code="ZA")
    assert full.status_code == 409
    asked = full.json()["overfilled"]
    assert asked["table"] == [
        {
            "project": "Test Tower",
            "designation": "Site engineer",
            "planned": 4,
            "now": 4,
            "after": 5,
        }
    ]
    assert {p["name"] for p in asked["people"]} >= {"Alice Test", "Bob Test"}  # who to move instead
    assert asked["options"] == ["increase_plan", "choose_another_person", "cancel"]
    assert desk.count("SELECT count(*) FROM employees") == people_before  # nothing was written
    raised = desk.add(
        name="Three", designation="Site engineer", project_code="ZA", resolve="increase_plan"
    )
    assert raised.status_code == 201
    line = desk.engineers()
    assert (line["planned"], line["to_hire"], line["over"]) == (5, 0, 0)
    assert desk.count("SELECT count(*) FROM workforce_events WHERE kind = 'plan_changed'") == 1


def test_uae_only_places_take_only_uae_nationals(desk: Desk) -> None:
    refused = desk.add(name="Not A National", designation="Admin Officer", project_code="ZA")
    assert refused.status_code == 409  # ZA plans no ordinary Admin Officer place
    ok = desk.add(
        name="A National", designation="Admin Officer", project_code="ZA", uae_national=True
    )
    assert ok.status_code == 201 and ok.json()["designation"] == "UAEN Admin Officer"
    board = desk.hr.get("/workforce/recruitment").json()
    assert all(
        r["designation"] != "UAEN Admin Officer" for r in board["rows"]
    )  # nothing left to hire


def test_the_steps_run_in_order_and_resigning_is_always_possible(desk: Desk) -> None:
    bob = "9002"
    skip = desk.hr.post(f"/workforce/people/{bob}/milestone", json={"to": "active"})
    assert skip.status_code == 409 and "steps are in order" in skip.text
    for step in ("documents_cleared", "active"):
        assert (
            desk.hr.post(f"/workforce/people/{bob}/milestone", json={"to": step}).status_code == 200
        )
    profile = desk.hr.get(f"/workforce/people/{bob}").json()
    assert profile["status"] == "active" and profile["joined_on"] is not None
    assert [h["kind"] for h in profile["history"]][:2] == ["joined", "documents_cleared"]
    assert (
        desk.hr.post(f"/workforce/people/{bob}/milestone", json={"to": "resigned"}).status_code
        == 200
    )
    assert desk.engineers()["to_hire"] == 3  # a resignation opens the place again
    assert (
        desk.hr.post(f"/workforce/people/{bob}/milestone", json={"to": "resigned"}).status_code
        == 409
    )


def test_moving_a_person_checks_the_new_project_and_is_recorded(desk: Desk) -> None:
    alice = "9001"
    full = desk.hr.post(f"/workforce/people/{alice}/move", json={"project_code": "ZB"})
    assert full.status_code == 409 and full.json()["overfilled"]["table"][0]["planned"] == 0
    moved = desk.hr.post(
        f"/workforce/people/{alice}/move", json={"project_code": "ZB", "resolve": "increase_plan"}
    )
    assert moved.status_code == 200 and "moved to Second Site" in moved.json()["message"]
    assert desk.hr.get(f"/workforce/people/{alice}").json()["project_code"] == "ZB"
    assert desk.engineers()["to_hire"] == 3  # her old place on ZA is open again
    assert (
        desk.hr.post(f"/workforce/people/{alice}/move", json={"project_code": "ZB"}).status_code
        == 409
    )


def test_the_hiring_board_groups_by_role_with_a_table_per_project(desk: Desk) -> None:
    board = desk.hr.get("/workforce/recruitment", params={"kind": "staff"}).json()
    by_name = {r["designation"]: r for r in board["rows"]}
    # The demo also has two site engineers with no project, so two places can be filled by moving them.
    assert by_name["Site engineer"]["to_hire"] == 2 and by_name["Site engineer"]["could_move"] == 2
    assert (
        by_name["Site engineer"]["hire"] == 0 and "so hire 0" in by_name["Site engineer"]["advice"]
    )
    assert by_name["Site engineer"]["projects"][0]["needed_by"] == "2026-12-01"
    assert by_name["UAEN Admin Officer"]["uae_only"] is True
    assert by_name["Planner"]["projects"][0]["project_code"] == "ZB"  # the planned transfer in
    assert board["totals"]["staff"] == board["totals"]["to_hire"]


def test_staff_and_labour_are_listed_apart_with_a_project_filter_and_no_phone_numbers(
    desk: Desk,
) -> None:
    staff = desk.hr.get("/workforce/people", params={"kind": "staff", "project": "ZA"}).json()
    names = {p["name"] for p in staff["items"]}
    assert {"Alice Test", "Bob Test", "Dan Test"} <= names and "Fay Test" not in names
    assert all("phone" not in p and "email" not in p for p in staff["items"])
    assert staff["by_status"]["active"] >= 2
    page = desk.hr.get("/workforce/projects/ZA/people").json()
    assert set(page) == {"staff", "labour"} and page["staff"]["total"] == 3
    only_offers = desk.hr.get(
        "/workforce/people", params={"project": "ZA", "status": "offer_issued"}
    ).json()
    assert [p["name"] for p in only_offers["items"]] == ["Bob Test"]
    detail = desk.hr.get("/workforce/people/9001").json()
    assert detail["phone"] == "+971 50 000 0001"
    assert (
        desk.ceo.get("/workforce/people/9001").json()["phone"] is None
    )  # the MD does not see contacts


def test_hr_edits_the_plan_and_the_stage_and_the_md_cannot(desk: Desk) -> None:
    body = {
        "designation": "Site engineer",
        "planned": 6,
        "needed_by": "2026-12-15",
        "source": "overseas",
    }
    assert desk.hr.put("/workforce/projects/ZA/plan", json=body).status_code == 200
    assert desk.engineers()["planned"] == 6 and desk.engineers()["to_hire"] == 4
    bad = desk.hr.patch(
        "/workforce/projects/ZA", json={"starts_on": "2026-12-01", "ends_on": "2026-11-01"}
    )
    assert bad.status_code == 422
    ok = desk.hr.patch(
        "/workforce/projects/ZA", json={"stage": "handover", "starts_on": "2026-01-01"}
    )
    assert ok.status_code == 200 and ok.json()["stage"] == "handover"
    assert desk.ceo.put("/workforce/projects/ZA/plan", json=body).status_code == 403
    assert desk.ceo.patch("/workforce/projects/ZA", json={"stage": "active"}).status_code == 403
    assert desk.add(name="Xu", designation="Site engineer", project_code="ZA").status_code == 201
    assert (
        desk.ceo.post(
            "/workforce/people", json={"name": "Yu", "designation": "Site engineer"}
        ).status_code
        == 403
    )
    chart = desk.ceo.get("/workforce/chart").json()
    za = next(p for p in chart["projects"] if p["code"] == "ZA")
    assert za["planned"] >= 6 and chart["totals"]["planned"] >= za["planned"]


def test_unknown_roles_and_duplicate_ids_get_plain_answers(
    desk: Desk, make_client: Callable[..., TestClient]
) -> None:
    unknown = desk.add(name="Z Test", designation="Wizard", project_code="ZA")
    assert unknown.status_code == 422 and "not a known role" in unknown.text
    twice = desk.add(name="Z Test", designation="Site engineer", project_code="ZA", code="9001")
    assert twice.status_code == 409 and "already used" in twice.text
    assert (
        desk.add(name="Z Test", designation="Site engineer").status_code == 422
    )  # no project, no auto
    assert make_client().get("/workforce/people").status_code == 401
    roles = desk.hr.get("/workforce/designations", params={"kind": "staff"}).json()
    assert any(r["name"] == "Site engineer" and r["kind"] == "staff" for r in roles)


def test_let_ai_decide_only_chooses_real_projects_never_head_office(desk: Desk) -> None:
    plan = {"designation": "Accountant", "planned": 2}
    assert (
        desk.hr.put("/workforce/projects/ZH/plan", json=plan).status_code == 200
    )  # head office plans 2
    auto = desk.add(name="Kim Test", designation="Accountant", auto=True)
    assert auto.status_code == 409 and "only chooses projects" in auto.text
    by_hand = desk.add(name="Kim Test", designation="Accountant", project_code="ZH")
    assert by_hand.status_code == 201 and by_hand.json()["project_code"] == "ZH"


def test_expected_joining_dates_fill_the_mobilization_board_and_become_the_joining_date(
    desk: Desk,
) -> None:
    board = desk.hr.get("/workforce/mobilization").json()
    cols = {c["id"]: c["people"] for c in board["columns"]}
    assert [p["name"] for p in cols["offer_issued"]] == ["Bob Test"]
    assert cols["documents_cleared"] == [] and cols["can_join"] == []
    assert (
        desk.hr.post(
            "/workforce/people/9002/milestone", json={"to": "documents_cleared"}
        ).status_code
        == 200
    )
    cols = {c["id"]: c["people"] for c in desk.hr.get("/workforce/mobilization").json()["columns"]}
    assert [p["name"] for p in cols["documents_cleared"]] == ["Bob Test"]  # no date yet
    done = desk.hr.patch(
        "/workforce/people/9002/join-date", json={"expected_join_on": "2026-11-20"}
    )
    assert done.status_code == 200 and done.json()["expected_join_on"] == "2026-11-20"
    cols = {c["id"]: c["people"] for c in desk.hr.get("/workforce/mobilization").json()["columns"]}
    assert [p["name"] for p in cols["can_join"]] == ["Bob Test"]  # documents cleared + a date
    assert cols["can_join"][0]["late"] is False
    assert (
        desk.hr.patch(
            "/workforce/people/9002/join-date", json={"expected_join_on": "2026-11-01"}
        ).status_code
        == 200
    )
    assert desk.hr.get("/workforce/mobilization").json()["late"] == 1  # the date has passed
    assert (
        desk.hr.patch(
            "/workforce/people/9002/join-date", json={"expected_join_on": "2026-11-20"}
        ).status_code
        == 200
    )
    assert (
        desk.hr.post("/workforce/people/9002/milestone", json={"to": "active"}).status_code == 200
    )
    assert (
        desk.hr.get("/workforce/people/9002").json()["joined_on"] == "2026-11-20"
    )  # the expected date
    assert (
        desk.hr.get("/workforce/mobilization").json()["total"] == 0
    )  # joined people leave the board
    assert (
        desk.hr.patch(
            "/workforce/people/9002/join-date", json={"expected_join_on": "2026-12-01"}
        ).status_code
        == 409
    )
    assert (
        desk.ceo.patch(
            "/workforce/people/9001/join-date", json={"expected_join_on": None}
        ).status_code
        == 403
    )
    assert desk.count("SELECT count(*) FROM workforce_events WHERE kind = 'join_date_set'") == 3


def test_a_project_has_a_start_date_an_expected_end_and_a_real_end(desk: Desk) -> None:
    ok = desk.hr.patch(
        "/workforce/projects/ZA", json={"starts_on": "2026-01-01", "ends_on": "2027-06-30"}
    )
    assert ok.status_code == 200 and ok.json()["actual_end_on"] is None
    early = desk.hr.patch("/workforce/projects/ZA", json={"actual_end_on": "2025-12-01"})
    assert early.status_code == 422 and "real end date" in early.text  # before the start
    done = desk.hr.patch("/workforce/projects/ZA", json={"actual_end_on": "2027-05-20"})
    assert (
        done.status_code == 200 and done.json()["stage"] == "completed"
    )  # a real end completes it
    shown = next(p for p in desk.hr.get("/workforce/projects").json() if p["code"] == "ZA")
    assert (shown["starts_on"], shown["ends_on"], shown["actual_end_on"]) == (
        "2026-01-01", "2027-06-30", "2027-05-20",
    )  # fmt: skip
    plan = desk.hr.get("/workforce/projects/ZA/plan").json()["project"]
    assert plan["actual_end_on"] == "2027-05-20" and plan["stage"] == "completed"
    cleared = desk.hr.patch(
        "/workforce/projects/ZA", json={"actual_end_on": None, "stage": "active"}
    )
    assert cleared.json()["actual_end_on"] is None and cleared.json()["stage"] == "active"
    assert (
        desk.ceo.patch("/workforce/projects/ZA", json={"actual_end_on": "2027-05-20"}).status_code
        == 403
    )
