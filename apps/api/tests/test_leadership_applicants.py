"""Project leads and key roles, the Excel lists and their emails, worker photos, demo applicants.

Runs on the seeded demo. RAK-01 to RAK-05 each have a lead (Project managers EMP-0701 to 0705);
RAK-06 has none; RAK-07 starts 12 Feb 2027, when the leads of RAK-02 (ends 31 Jan) and RAK-05
(ends 15 Dec 2026) are free. The simulated date is Thursday 5 Nov 2026.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import Engine, text

from app.routes.worker_mail import mail_transport
from app.routes.worker_photo import get_storage
from app.storage import LocalStorage
from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, sign_in

KEY = "k" * 40
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


class Desk:
    def __init__(self, make_client: Callable[..., TestClient], engine: Engine, tmp: Path) -> None:
        self.engine = engine
        self.manager = make_client(n8n_hmac_secret=KEY)
        self.executive = make_client(n8n_hmac_secret=KEY)
        self.ceo = make_client(n8n_hmac_secret=KEY)
        sign_in(self.manager, HR_MANAGER)
        sign_in(self.executive, HR_EXECUTIVE)
        sign_in(self.ceo, CEO)
        self.calls: list[httpx.Request] = []
        transport = httpx.MockTransport(self._answer)
        for who in (self.manager, self.executive, self.ceo):
            app: FastAPI = who.app  # type: ignore[assignment]
            app.dependency_overrides[mail_transport] = lambda: transport
            app.dependency_overrides[get_storage] = lambda: LocalStorage(str(tmp))

    def _answer(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        return httpx.Response(200, json={"ok": True})

    def one(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as c:
            return c.execute(text(sql), params).scalar_one()


@pytest.fixture
def desk(make_client: Callable[..., TestClient], migrated_db: Engine, tmp_path: Path) -> Desk:
    return Desk(make_client, migrated_db, tmp_path)


# ------------------------------------------------------------------------------------- leads


def test_a_project_shows_its_lead_and_who_could_lead_the_next(desk: Desk) -> None:
    one = desk.manager.get("/projects/RAK-01/leadership").json()
    assert one["lead"]["name"] == "Imran Qureshi" and one["can_edit"] is True
    seven = desk.manager.get("/projects/RAK-07/leadership").json()
    assert seven["lead"] is None
    assert {c["name"] for c in seven["free"]} == {"Vikram Nair", "Omar Haddad"}
    assert {c["busy_on"] for c in seven["busy"]} == {"RAK-01", "RAK-03", "RAK-04"}
    assert "2 project managers are free" in seven["advice"]


def test_when_nobody_is_free_it_names_the_nearest_and_the_recruit_dates(desk: Desk) -> None:
    six = desk.manager.get("/projects/RAK-06/leadership").json()
    assert six["free"] == [] and six["lead"] is None
    assert six["busy"][0]["name"] == "Omar Haddad"  # RAK-05 finishes first
    assert "No project manager is free from 1 Jun 2026" in six["advice"]
    assert "locally by" in six["advice"] and "overseas by" in six["advice"]


def test_assigning_a_lead_is_checked_and_audited(desk: Desk) -> None:
    busy = desk.manager.put("/projects/RAK-07/lead", json={"employee_code": "EMP-0701"})
    assert busy.status_code == 409 and "already leads RAK-01" in busy.text
    not_a_pm = desk.manager.put("/projects/RAK-07/lead", json={"employee_code": "EMP-0706"})
    assert not_a_pm.status_code == 422
    done = desk.manager.put("/projects/RAK-07/lead", json={"employee_code": "emp-0702"})
    assert done.status_code == 200 and done.json()["lead"]["name"] == "Vikram Nair"
    assert desk.one("SELECT count(*) FROM audit_log WHERE action = 'project.lead_assigned'") == 1
    assert desk.executive.delete("/projects/RAK-07/lead").json()["lead"] is None
    assert (
        desk.ceo.put("/projects/RAK-07/lead", json={"employee_code": "EMP-0702"}).status_code == 403
    )
    assert desk.ceo.get("/projects/RAK-07/leadership").json()["can_edit"] is False


def test_the_suggested_key_roles_can_be_added_to_the_plan(desk: Desk) -> None:
    before = {
        r["trade"]: r for r in desk.manager.get("/projects/RAK-07/leadership").json()["key_roles"]
    }
    assert (
        before["Project manager"]["recommended"] == 1 and before["Project manager"]["missing"] == 1
    )
    assert before["Site engineer"]["recommended"] == 1  # a crew of 24 needs one
    added = desk.manager.post("/projects/RAK-07/key-roles/add").json()
    assert "1 Project manager" in added["added"]
    assert all(r["missing"] == 0 for r in added["leadership"]["key_roles"])
    assert (
        desk.manager.post("/projects/RAK-07/key-roles/add").json()["added"] == []
    )  # nothing twice


# ------------------------------------------------------------------------------ Excel, email


def test_the_people_list_is_an_excel_file_without_numbers(desk: Desk) -> None:
    response = desk.manager.get("/projects/RAK-01/staff.xlsx")
    assert response.status_code == 200 and "spreadsheetml" in response.headers["content-type"]
    book = load_workbook(io.BytesIO(response.content))
    assert book.sheetnames == ["Project", "People"]
    header = [c.value for c in book["People"][1]]
    assert header == ["Code", "Name", "Trade", "Level", "Status", "Site", "Starts", "Ends"]
    assert book["People"].max_row > 5
    text_of_everything = " ".join(str(c.value) for s in book for r in s.iter_rows() for c in r)
    assert "+971" not in text_of_everything and "784-" not in text_of_everything
    assert ("Project lead", "Imran Qureshi") in {
        (r[0].value, r[1].value) for r in book["Project"].iter_rows()
    }


def test_the_list_goes_to_the_lead_with_the_file_attached_and_is_logged(desk: Desk) -> None:
    shown = desk.manager.post("/projects/RAK-01/email/preview", json={"kind": "staff"}).json()
    assert shown["to"] == "imran.qureshi@example.test" and shown["attachment"].endswith(".xlsx")
    assert desk.calls == []  # a preview sends nothing
    sent = desk.manager.post("/projects/RAK-01/email", json={"kind": "staff"})
    assert sent.status_code == 200, sent.text
    request = desk.calls[-1]
    assert request.headers["content-type"].startswith("multipart/form-data")
    assert b"filename=" in request.content and b"PK" in request.content  # a real .xlsx (zip)
    assert desk.one("SELECT count(*) FROM notifications WHERE event = 'project.staff_list'") == 1
    assert desk.one("SELECT count(*) FROM audit_log WHERE action = 'project.emailed'") == 1


def test_the_recruitment_sheet_and_the_guards_on_sending(desk: Desk) -> None:
    sheet = desk.manager.get("/projects/RAK-07/recruitment.xlsx")
    assert sheet.status_code == 200
    no_lead = desk.manager.post("/projects/RAK-07/email", json={"kind": "recruitment"})
    assert no_lead.status_code == 422 and "Assign a project lead first" in no_lead.text
    desk.manager.put("/projects/RAK-07/lead", json={"employee_code": "EMP-0702"})
    sent = desk.manager.post("/projects/RAK-07/email", json={"kind": "recruitment"})
    assert sent.status_code == 200, sent.text
    assert "Recruitment needed for RAK-07" in sent.json()["subject"]
    assert desk.ceo.post("/projects/RAK-07/email", json={"kind": "staff"}).status_code == 403
    with desk.engine.begin() as c:
        c.execute(text("UPDATE employees SET email = NULL WHERE employee_code = 'EMP-0702'"))
    nomail = desk.manager.post("/projects/RAK-07/email/preview", json={"kind": "recruitment"})
    assert nomail.status_code == 422 and "no email address" in nomail.text


# --------------------------------------------------------------------------------------- photo


def test_a_photo_is_checked_stored_and_shown_only_to_people_who_may_read_it(desk: Desk) -> None:
    url = "/workers/EMP-0088/photo"
    assert desk.manager.get(url).status_code == 404
    assert desk.manager.put(url, content=b"GIF89a....").status_code == 422  # not JPEG/PNG/WebP
    assert desk.manager.put(url, content=PNG + b"0" * (2 * 1024 * 1024)).status_code == 413
    assert desk.manager.put(url, content=PNG).status_code == 204
    shown = desk.manager.get(url)
    assert shown.content == PNG and shown.headers["content-type"] == "image/png"
    assert desk.ceo.get(url).status_code == 200  # the MD may look
    assert desk.ceo.put(url, content=PNG).status_code == 403  # but not change it
    assert desk.manager.get("/workers/EMP-0088").json()["has_photo"] is True
    assert desk.one("SELECT count(*) FROM audit_log WHERE action = 'worker.photo_set'") == 1
    assert desk.manager.delete(url).status_code == 204
    assert desk.manager.get(url).status_code == 404


# ----------------------------------------------------------------------------------- applicants

WHEN = {
    "day": "2026-11-12",
    "at": "10:30",
    "mode": "online",
    "venue": "https://meet.example.test/x",
}


def test_applicants_are_ranked_by_a_match_python_worked_out(desk: Desk) -> None:
    page = desk.manager.get("/applicants").json()
    assert page["demo"] is True and len(page["items"]) == 10
    percents = [a["percent"] for a in page["items"]]
    assert percents == sorted(percents, reverse=True)
    assert page["strong"] == sum(1 for p in percents if p >= 90)
    assert "match at 90% or more" in page["summary"]
    masons = desk.manager.get("/applicants", params={"category": "Mason"}).json()["items"]
    assert [a["name"] for a in masons] == ["Rafiq Ahmed", "Sunil Gurung"]
    strong = desk.manager.get("/applicants", params={"min_match": 90}).json()["items"]
    assert strong and all(a["percent"] >= 90 for a in strong)
    one = desk.manager.get("/applicants/APP-001").json()
    assert one["percent"] == 90 and one["tier"] == "strong" and one["missing"] == []
    assert "5 of 5 required skills" in one["reasons"][0]


def test_an_invitation_is_previewed_sent_and_remembered(desk: Desk) -> None:
    preview = desk.manager.post("/applicants/APP-001/interview/preview", json=WHEN)
    assert preview.status_code == 200 and "12 Nov 2026 at 10:30" in preview.json()["body"]
    assert desk.calls == []
    sent = desk.manager.post("/applicants/APP-001/interview", json=WHEN)
    assert sent.status_code == 200, sent.text
    assert desk.calls[-1].url.path.endswith("/hamra-send-email")
    detail = desk.manager.get("/applicants/APP-001").json()
    assert detail["status"] == "interview_sent" and detail["interviews"][0]["delivered"] is True
    assert desk.one("SELECT count(*) FROM audit_log WHERE action = 'applicant.interview_sent'") == 1


def test_invitations_are_checked_and_the_md_can_look_but_not_send(desk: Desk) -> None:
    past = {**WHEN, "day": "2026-11-01"}
    assert desk.manager.post("/applicants/APP-001/interview", json=past).status_code == 422
    offline_link = {**WHEN, "mode": "online", "venue": "Room 3, HR office"}
    assert desk.manager.post("/applicants/APP-001/interview", json=offline_link).status_code == 422
    assert (
        desk.manager.post(
            "/applicants/APP-001/interview", json={**WHEN, "send_to": "nope"}
        ).status_code
        == 422
    )
    assert desk.ceo.get("/applicants").status_code == 200
    assert desk.ceo.post("/applicants/APP-001/interview", json=WHEN).status_code == 403
    assert desk.manager.get("/applicants/APP-999").status_code == 404
    shortlisted = desk.manager.post("/applicants/APP-002/status", json={"status": "shortlisted"})
    assert shortlisted.json()["status"] == "shortlisted"
