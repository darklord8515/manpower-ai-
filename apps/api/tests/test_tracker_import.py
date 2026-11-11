# ruff: noqa: E501
"""The tracker importer, on a small fictional workbook (never the client's real files).

Staff rows: a joined engineer, an engineer on offer, two empty engineer positions (one needed by a date),
an empty UAE-nationals-only position, a resignation, a planned transfer out and in (same person), a row
with a status nobody knows, and a person on a cost centre ("Camp") missing from the Projects sheet.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.services import headcount, tracker_import
from tests.support import CEO, HR_MANAGER, sign_in

PROJECTS = [
    ["ZA", "Test Tower", "", "", "", None, None, "Under Construction", ""],
    ["ZB", "Second Site", "", "", "", None, None, "Pre-Construction", ""],
    ["ZH", "Head Office Z", "", "", "", None, None, "Ongoing-Overhead", ""],
]
PROJECT_HEAD = ["Project Code", "Project Name", "Client / Developer", "Location", "Project Manager",
                "Start Date", "Planned Completion", "Project Status", "Remarks"]  # fmt: skip
STAFF_HEAD = ["Staff ID", "Employee Name", "Project Name", "Designation", "Discipline / Dept",
              "Employment Status", "Date of Joining", "Exit Date / Required By", "Contact No.", "Email"]  # fmt: skip
STAFF = [
    [9001, "Alice Test", "Test Tower", "Site Engineer", "Construction", "Active", date(2026, 1, 5), None, "+971 50 000 0001", "alice@example.test"],
    [9002, "Bob Test", "Test Tower", "Site Engineer", "Construction", "Offer Issued", None, None, None, None],
    [9003, "TBA", "Test Tower", "Site Engineer", "Construction", "Future Recruitment", None, date(2026, 12, 1), None, None],
    [9004, "TBA", "Test Tower", "Site Engineer", "Construction", "Future Recruitment", None, None, None, None],
    [9005, "TBA", "Test Tower", "Admin Officer - UAEN", "Admin", "Future Recruitment", None, None, None, None],
    [9006, "Cara Test", "Head Office Z", "Accountant", "Finance", "Resigned", date(2024, 3, 1), date(2026, 10, 1), None, None],
    [9007, "Dan Test", "Test Tower", "Planner", "Planning", "Transfer Out - Planned", date(2025, 5, 1), None, None, None],
    [9007, "Dan Test", "Second Site", "Planner", "Planning", "Transfer In - Planned", None, None, None, None],
    [9009, "Eve Test", "Test Tower", "Planner", "Planning", "On Hold", None, None, None, None],
    [9010, "Fay Test", "Camp", "Cook", "General", "Active", date(2025, 2, 1), None, None, None],
]  # fmt: skip
LABOUR_HEAD = ["Labour ID", "Labour Name", "Recrutiment - Local/ Overseas", "Project Name", "Trade",
               "Trade Group (auto)", "Labour Status", "Date of Joining", "Exit Date / Required By"]  # fmt: skip
LABOUR = [
    [8001, "Gus Test", "", "Test Tower", "Steel Fixer", "Structure", "Active", date(2026, 2, 1), None],
    [8002, "TBA", "Overseas", "Test Tower", "Steel Fixer", "Structure", "Future Requirement", None, date(2027, 1, 15)],
    [8003, "Hal Test", "Local", "Test Tower", "Steel Fixer", "Structure", "Offer issued", None, None],
    ["?", "Ivy Test", "Local", "Test Tower", "Steel Fixer", "Structure", "Offer issued", None, None],
    ["?", "TBA", "Overseas", "Test Tower", "Steel Fixer", "Structure", "Future Requirement", None, None],
]  # fmt: skip


def workbook(
    sheet: str, head: list[str], rows: list[list[Any]], project_data: list[list[Any]] | None = None
) -> bytes:
    book = Workbook()
    projects = book.active
    assert projects is not None
    projects.title = "Projects"
    master = book.create_sheet(sheet)
    project_rows = PROJECTS if project_data is None else project_data
    for ws, header, data in ((projects, PROJECT_HEAD, project_rows), (master, head, rows)):
        for column, value in enumerate(header, start=1):
            ws.cell(row=4, column=column, value=value)
        for r, row in enumerate(data, start=5):
            for column, value in enumerate(row, start=1):
                ws.cell(row=r, column=column, value=value)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


STAFF_FILE = workbook("Staff_Master", STAFF_HEAD, STAFF)
# The real labour tracker names the same projects with other codes (and has no head-office row).
LABOUR_PROJECTS = [["TT-L", *PROJECTS[0][1:]], ["SS-L", *PROJECTS[1][1:]]]
LABOUR_FILE = workbook("Labour_Master", LABOUR_HEAD, LABOUR, LABOUR_PROJECTS)


@pytest.fixture
def desk(make_client: Callable[..., TestClient]) -> tuple[TestClient, TestClient]:
    manager, ceo = make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(ceo, CEO)
    return manager, ceo


def count(engine: Engine, sql: str) -> int:
    with engine.connect() as c:
        return int(c.execute(text(sql)).scalar_one())


# ------------------------------------------------------------------------------------ cleaning


def test_statuses_names_and_uaen_are_cleaned_by_rules() -> None:
    parsed = tracker_import.parse_workbook(STAFF_FILE, "staff")
    assert parsed.rows == 10
    s = tracker_import.summary(parsed, applied=False)
    assert s["by_status"] == {
        "active": 2, "offer_issued": 1, "resigned": 1,
        "transfer_in": 1, "transfer_out": 1, "vacancy": 3,
    }  # fmt: skip
    assert s["people"] == 5  # the engineer, the one on offer, the resignation, Dan once, the cook
    assert s["vacancies"] == 4  # three empty positions and the transfer in
    assert s["uae_only_lines"] == 1 and s["transfers_noted"] == 2
    assert s["issue_count"] == 2  # the unknown status, and the camp cost centre
    assert any("On Hold" in i or "on hold" in i.lower() for i in s["issues"])
    admin = next(k for k in parsed.plan if k[1] == "Admin Officer")
    assert admin == ("ZA", "Admin Officer", True)  # "- UAEN" stripped, flagged
    engineers = parsed.plan[("ZA", "Site Engineer", False)]
    assert engineers.planned == 4 and str(engineers.needed_by) == "2026-12-01"
    assert ("ZH", "Accountant", False) not in parsed.plan  # a resigned person is no position


def test_bad_files_are_refused_in_plain_words() -> None:
    with pytest.raises(tracker_import.TrackerError, match="not an Excel"):
        tracker_import.parse_workbook(b"hello", "staff")
    with pytest.raises(tracker_import.TrackerError, match="Labour_Master"):
        tracker_import.parse_workbook(STAFF_FILE, "labour")


# ---------------------------------------------------------------------------- the API and the data


def test_a_preview_changes_nothing_and_apply_writes_everything_once(
    desk: tuple[TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _ = desk
    before = count(migrated_db, "SELECT count(*) FROM employees")
    shown = manager.post("/imports/trackers?kind=staff", content=STAFF_FILE)
    assert shown.status_code == 200 and shown.json()["applied"] is False
    assert count(migrated_db, "SELECT count(*) FROM employees") == before
    assert count(migrated_db, "SELECT count(*) FROM projects WHERE code = 'ZA'") == 0

    done = manager.post("/imports/trackers?kind=staff&apply=true", content=STAFF_FILE)
    assert done.status_code == 200 and done.json()["applied"] is True
    assert count(migrated_db, "SELECT count(*) FROM employees") == before + 5
    assert (
        count(migrated_db, "SELECT count(*) FROM audit_log WHERE action = 'tracker.imported'") == 1
    )
    rerun = manager.post("/imports/trackers?kind=staff&apply=true", content=STAFF_FILE)
    assert rerun.status_code == 200
    assert (
        count(migrated_db, "SELECT count(*) FROM employees") == before + 5
    )  # matched by ID, not doubled
    assert (
        count(
            migrated_db,
            "SELECT count(*) FROM plan_lines WHERE planned > 0 AND project_id IN "
            "(SELECT id FROM projects WHERE code = 'ZA')",
        )
        == 3
    )  # engineer, UAEN admin, planner


def test_the_headcount_counts_joined_pipeline_and_what_is_still_to_hire(
    desk: tuple[TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _ = desk
    assert (
        manager.post("/imports/trackers?kind=staff&apply=true", content=STAFF_FILE).status_code
        == 200
    )
    with Session(migrated_db) as session:
        rows = {(r.project_code, r.trade, r.uae_only): r for r in headcount.lines(session)}
        engineers = rows[("ZA", "Site Engineer", False)]
        assert (engineers.planned, engineers.active, engineers.pipeline) == (4, 1, 1)
        assert (engineers.to_hire, engineers.over, engineers.kind) == (2, 0, "staff")
        assert (
            rows[("ZA", "Admin Officer", True)].to_hire == 1
            and rows[("ZA", "Admin Officer", True)].label == "UAEN Admin Officer"
        )
        assert (
            rows[("ZB", "Planner", False)].to_hire == 1
        )  # the planned transfer in is an open position
        assert rows[("ZA", "Planner", False)].active == 1  # Dan stays where he is
        assert ("ZH", "Accountant", False) not in rows or rows[
            ("ZH", "Accountant", False)
        ].active == 0
        cook = next(r for r in headcount.lines(session, project_code="CAMP"))
        assert cook.project_kind == "head_office" and cook.active == 1

        # Adding a person lowers "to hire" with no other step.
        session.execute(
            text(
                """INSERT INTO employees (employee_code, full_name, primary_trade_id, project_id,
                                         employment_status, is_demo)
                   SELECT 'T-1', 'New Engineer', t.id, p.id, CAST('offer_issued' AS employment_status), false
                   FROM trades t, projects p WHERE t.name = 'Site Engineer' AND p.code = 'ZA'"""
            )
        )
        again = {(r.project_code, r.trade, r.uae_only): r for r in headcount.lines(session)}
        assert again[("ZA", "Site Engineer", False)].to_hire == 1
        session.rollback()


def test_a_person_on_offer_with_no_company_id_is_kept_with_a_temporary_code(
    desk: tuple[TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _ = desk
    first = manager.post("/imports/trackers?kind=labour&apply=true", content=LABOUR_FILE)
    assert first.status_code == 200, first.text
    assert any("no company ID" in i for i in first.json()["issues"])
    assert (
        count(migrated_db, "SELECT count(*) FROM employees WHERE employee_code LIKE 'NEW-%'") == 1
    )
    manager.post("/imports/trackers?kind=labour&apply=true", content=LABOUR_FILE)
    assert (
        count(migrated_db, "SELECT count(*) FROM employees WHERE employee_code LIKE 'NEW-%'") == 1
    )


def test_labour_trades_reuse_the_ones_that_exist_and_a_person_over_the_plan_shows_as_over(
    desk: tuple[TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _ = desk
    assert (
        manager.post("/imports/trackers?kind=labour&apply=true", content=LABOUR_FILE).status_code
        == 200
    )
    assert count(migrated_db, "SELECT count(*) FROM trades WHERE lower(name) = 'steel fixer'") == 1
    with Session(migrated_db) as session:
        line = next(
            r for r in headcount.lines(session, project_code="TT-L") if r.trade == "Steel fixer"
        )
        assert (line.planned, line.active, line.pipeline, line.to_hire) == (5, 1, 2, 2)
        assert str(line.needed_by) == "2027-01-15" and line.source == "overseas"


def test_both_trackers_share_a_project_by_name_and_spelling_variants_are_one_role(
    desk: tuple[TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _ = desk
    assert (
        manager.post("/imports/trackers?kind=staff&apply=true", content=STAFF_FILE).status_code
        == 200
    )
    assert (
        manager.post("/imports/trackers?kind=labour&apply=true", content=LABOUR_FILE).status_code
        == 200
    )
    assert count(migrated_db, "SELECT count(*) FROM projects WHERE name = 'Test Tower'") == 1
    with Session(migrated_db) as session:
        kinds = {r.kind for r in headcount.lines(session, project_code="ZA")}
        assert kinds == {"staff", "labour"}  # one project, staff and labour lines together
        steel = [
            r
            for r in headcount.lines(session, project_code="ZA")
            if r.trade.lower() == "steel fixer"
        ]
        assert len(steel) == 1 and steel[0].planned == 5  # "Steel Fixer" twice is one role


def test_only_hr_may_import_and_bad_uploads_get_plain_answers(
    desk: tuple[TestClient, TestClient], make_client: Callable[..., TestClient]
) -> None:
    manager, ceo = desk
    assert ceo.post("/imports/trackers?kind=staff", content=STAFF_FILE).status_code == 403
    assert make_client().post("/imports/trackers?kind=staff", content=STAFF_FILE).status_code == 401
    assert manager.post("/imports/trackers?kind=staff", content=b"").status_code == 422
    wrong = manager.post("/imports/trackers?kind=staff", content=b"not a workbook")
    assert wrong.status_code == 422 and "not an Excel" in wrong.text
    assert manager.post("/imports/trackers?kind=other", content=STAFF_FILE).status_code == 422
