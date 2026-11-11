# ruff: noqa: E501
"""Adding people from an Excel list: sorted, deduplicated, and doubts asked, on the fictional demo files.

`new` has 10 people (6 labour and 4 staff mixed in one sheet). `changes` is imported afterwards: two
rows are already there, one more is the same person without an ID, and four are doubts.
"""

from __future__ import annotations

import base64
import io
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import Engine, text

from app.services.employee_samples import sample_xlsx
from tests.support import CEO, HR_MANAGER, sign_in

NEW = base64.b64encode(sample_xlsx("new")).decode()
CHANGES = base64.b64encode(sample_xlsx("changes")).decode()


class Desk:
    def __init__(self, make_client: Callable[..., TestClient], engine: Engine) -> None:
        self.engine = engine
        self.hr = make_client()
        self.ceo = make_client()
        sign_in(self.hr, HR_MANAGER)
        sign_in(self.ceo, CEO)
        # Greens plans three Helpers, so "no project" has somewhere for the AI to put one.
        plan = {"designation": "Helper", "planned": 3}
        assert self.hr.put("/workforce/projects/RAK-03/plan", json=plan).status_code == 200

    def post(self, file: str, **fields: Any) -> Any:
        return self.hr.post("/imports/employees", json={"file": file, **fields})

    def count(self, sql: str) -> int:
        with self.engine.connect() as c:
            return int(c.execute(text(sql)).scalar_one())


@pytest.fixture
def desk(make_client: Callable[..., TestClient], migrated_db: Engine) -> Desk:
    return Desk(make_client, migrated_db)


def test_a_mixed_sheet_is_sorted_into_staff_and_labour_and_a_preview_changes_nothing(
    desk: Desk,
) -> None:
    before = desk.count("SELECT count(*) FROM employees")
    shown = desk.post(NEW).json()
    assert shown["issues"] == []
    assert (shown["rows"], shown["new"], shown["unchanged"], shown["conflicts"]) == (10, 10, 0, [])
    assert (shown["new_staff"], shown["new_labour"]) == (4, 6)
    assert shown["ai_placed"] == 1  # the row with no project
    assert set(shown["new_roles"]) == {"Document Controller", "Admin Officer", "Quantity Surveyor"}
    assert desk.count("SELECT count(*) FROM employees") == before  # a preview writes nothing


def test_importing_adds_each_person_to_the_right_section_and_mobilization(desk: Desk) -> None:
    done = desk.post(NEW, apply=True).json()["applied"]
    assert (
        done["created"] == {"staff": 4, "labour": 6}
        and done["ai_placed"] == 1
        and done["skipped"] == []
    )
    staff = desk.hr.get("/workforce/people", params={"kind": "staff", "q": "Demo"}).json()
    labour = desk.hr.get("/workforce/people", params={"kind": "labour", "q": "Demo"}).json()
    assert {p["name"] for p in staff["items"]} == {
        "Yasmin Demo",
        "Zaid Demo",
        "Amal Demo",
        "Basil Demo",
    }
    assert {p["name"] for p in labour["items"] if p["code"].startswith("DEMO-L-")} == {
        "Rahim Demo",
        "Sabir Demo",
        "Tariq Demo",
        "Umar Demo",
        "Vikash Demo",
        "Wasim Demo",
    }
    amal = desk.hr.get("/workforce/people/DEMO-S-003").json()
    assert amal["uae_national"] is True and amal["project_name"] == "Aila Homes"
    wasim = desk.hr.get("/workforce/people/DEMO-L-006").json()
    assert wasim["project_name"] == "Greens"  # "let AI decide" picked the only open Helper place
    board = desk.hr.get("/workforce/mobilization").json()
    names = {p["name"] for c in board["columns"] for p in c["people"]}
    assert {"Vikash Demo", "Rahim Demo", "Sabir Demo"} <= names  # no status means offer issued
    assert "Tariq Demo" not in names  # already joined, so not on the board
    sabir = next(p for c in board["columns"] for p in c["people"] if p["name"] == "Sabir Demo")
    assert sabir["status"] == "documents_cleared" and sabir["expected_join_on"] == "2026-11-28"
    ai = desk.hr.get("/workforce/history", params={"by": "ai"}).json()
    assert [e["person_name"] for e in ai] == ["Wasim Demo"]


def _sheet(headers: list[str], rows: list[list[str | None]]) -> str:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return base64.b64encode(out.getvalue()).decode()


def test_a_list_with_no_project_column_lets_the_ai_decide_for_every_person(desk: Desk) -> None:
    assert (
        desk.hr.put(
            "/workforce/projects/RAK-03/plan", json={"designation": "Site engineer", "planned": 5}
        ).status_code
        == 200
    )
    file = _sheet(
        ["Full name", "Designation", "Status"],
        [["Hala Demo", "Helper", None], ["Idris Demo", "Site engineer", "Offer issued"]],
    )
    shown = desk.post(file).json()
    assert shown["issues"] == [] and shown["new"] == 2 and shown["ai_placed"] == 2
    assert (shown["new_staff"], shown["new_labour"]) == (1, 1)
    done = desk.post(file, apply=True).json()["applied"]
    assert done["ai_placed"] == 2 and done["skipped"] == []
    names = {
        e["person_name"] for e in desk.hr.get("/workforce/history", params={"by": "ai"}).json()
    }
    assert {"Hala Demo", "Idris Demo"} <= names
    for person in desk.hr.get("/workforce/people", params={"q": "Demo"}).json()["items"]:
        if person["name"] in ("Hala Demo", "Idris Demo"):
            assert person["project_name"] is not None  # a real project, chosen by the AI


def test_the_same_file_again_adds_nobody_because_everyone_is_already_there(desk: Desk) -> None:
    desk.post(NEW, apply=True)
    before = desk.count("SELECT count(*) FROM employees")
    again = desk.post(NEW).json()
    assert (again["new"], again["unchanged"], again["conflicts"]) == (0, 10, [])
    assert desk.post(NEW, apply=True).json()["applied"]["created"] == {"staff": 0, "labour": 0}
    assert desk.count("SELECT count(*) FROM employees") == before


def test_doubtful_rows_are_asked_about_and_nothing_is_written_until_hr_answers(desk: Desk) -> None:
    desk.post(NEW, apply=True)
    shown = desk.post(CHANGES).json()
    assert (shown["new"], shown["unchanged"]) == (1, 3)  # Newman; and L-001, L-003, Zaid ignored
    asked = {c["row"]: c for c in shown["conflicts"]}
    assert {r: c["kind"] for r, c in asked.items()} == {
        4: "moved",
        5: "details",
        6: "id_clash",
        7: "moved",
    }
    assert (
        "Yasmin Demo is already here as Site engineer on Marina Waterfront" in asked[4]["question"]
    )
    assert [o["id"] for o in asked[4]["options"]] == ["transfer", "another", "ignore"]
    assert [o["id"] for o in asked[5]["options"]] == ["update", "another", "ignore"]
    assert "DEMO-L-004" in asked[6]["question"] and "Umar Demo" in asked[6]["question"]
    before = desk.count("SELECT count(*) FROM employees")
    unanswered = desk.post(CHANGES, apply=True, decisions={"4": "transfer"})
    assert unanswered.status_code == 422 and "still need an answer" in unanswered.text
    wrong = desk.post(
        CHANGES,
        apply=True,
        decisions={"4": "transfer", "5": "transfer", "6": "ignore", "7": "ignore"},
    )
    assert wrong.status_code == 422  # "transfer" is not an option for a change of details
    assert desk.count("SELECT count(*) FROM employees") == before


def test_hr_answers_decide_what_is_committed(desk: Desk) -> None:
    desk.post(NEW, apply=True)
    answers = {"4": "transfer", "5": "update", "6": "another", "7": "ignore"}
    done = desk.post(CHANGES, apply=True, decisions=answers, raise_plans=True).json()["applied"]
    assert (
        done["transferred"],
        done["updated"],
        done["another"],
        done["ignored"],
        done["unchanged"],
    ) == (1, 1, 1, 1, 3)
    assert done["created"] == {
        "staff": 0,
        "labour": 2,
    }  # Newman, and "Umar Different" as another person
    yasmin = desk.hr.get("/workforce/people/DEMO-S-001").json()
    assert yasmin["project_name"] == "Aila Homes"  # the transfer
    assert any(h["kind"] == "moved" for h in yasmin["history"])
    sabir = desk.hr.get("/workforce/people/DEMO-L-002").json()
    assert sabir["status"] == "active" and sabir["joined_on"] == "2026-11-20"  # the update
    assert any(h["kind"] == "joined" for h in sabir["history"])  # logged on the person
    umar = desk.hr.get("/workforce/people/DEMO-L-004").json()
    assert umar["name"] == "Umar Demo"  # the original is untouched
    assert (
        desk.count(
            "SELECT count(*) FROM employees WHERE full_name = 'Umar Different' AND employee_code LIKE 'NEW-%'"
        )
        == 1
    )
    basil = desk.hr.get("/workforce/people/DEMO-S-004").json()
    assert basil["project_name"] == "Marina Waterfront"  # "mistake": ignored, still where he was
    assert desk.count("SELECT count(*) FROM employees WHERE full_name = 'Basil Demo'") == 1


def test_a_transfer_into_a_full_project_is_blocked_unless_hr_lets_the_plan_grow(desk: Desk) -> None:
    desk.post(NEW, apply=True)
    answers = {"4": "transfer", "5": "ignore", "6": "ignore", "7": "ignore"}
    done = desk.post(CHANGES, apply=True, decisions=answers).json()["applied"]
    assert done["transferred"] == 0 and "plan" in done["blocked"][0].lower()
    assert desk.hr.get("/workforce/people/DEMO-S-001").json()["project_name"] == "Marina Waterfront"


def test_only_hr_may_import_and_bad_files_get_plain_answers(desk: Desk) -> None:
    assert desk.ceo.post("/imports/employees", json={"file": NEW}).status_code == 403
    assert desk.ceo.get("/imports/employees/sample.xlsx").status_code == 403
    bad = desk.post(base64.b64encode(b"not a workbook").decode())
    assert bad.status_code == 422 and "not an Excel" in bad.text
    assert desk.post("%%%not base64%%%").status_code == 422
    sample = desk.hr.get("/imports/employees/sample.xlsx", params={"which": "changes"})
    assert sample.status_code == 200 and sample.content[:2] == b"PK"
