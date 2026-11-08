"""The Action Center's routes: who sees which alerts, what they can do, and what keeps them current.

Runs on the seeded demo (see tests/test_alert_engine.py for what the seed raises). The simulated
time is Thursday 5 Nov 2026, 09:00 Gulf time. HR (Manager and Executive) act on alerts; the MD/CEO
reads them. Alerts are created, updated and resolved by the detectors only.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.clock import GULF
from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in
from tests.world import scenario

SEED_NOW = datetime(2026, 11, 5, 9, 0, tzinfo=GULF)
SANJEEV = "Sanjeev Rana: residency visa ends in 7 days (12 Nov 2026)"


def after(hours: float = 0, days: float = 0) -> str:
    return (SEED_NOW + timedelta(hours=hours, days=days)).isoformat()


class Center:
    def __init__(self, make_client: Any, engine: Engine) -> None:
        self.engine = engine
        self.make_client = make_client
        self.manager: TestClient = make_client()
        self.executive: TestClient = make_client()
        self.ceo: TestClient = make_client()
        sign_in(self.manager, HR_MANAGER)
        sign_in(self.executive, HR_EXECUTIVE)
        sign_in(self.ceo, CEO)

    def alerts(self, who: TestClient | None = None, **params: Any) -> dict[str, Any]:
        response = (who or self.manager).get("/alerts", params=params)
        assert response.status_code == 200, response.text
        return response.json()

    def find(self, start: str, who: TestClient | None = None, **params: Any) -> dict[str, Any]:
        items = self.alerts(who, **params)["items"]
        return next(a for a in items if a["title"].startswith(start))

    def detail(self, alert_id: str, who: TestClient | None = None) -> dict[str, Any]:
        response = (who or self.manager).get(f"/alerts/{alert_id}")
        assert response.status_code == 200, response.text
        return response.json()

    def scalar(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as c:
            return c.execute(text(sql), params).scalar_one()  # noqa: S608


@pytest.fixture
def center(make_client: Any, migrated_db: Engine) -> Center:
    return Center(make_client, migrated_db)


# ------------------------------------------------------------------------------------ reading


def test_the_list_is_sorted_by_severity_with_counts_and_the_last_run(center: Center) -> None:
    body = center.alerts()
    assert body["counts"] == {"critical": 2, "action_needed": 16, "info": 29}
    assert len(body["items"]) == 47 and body["snoozed"] == 0 and body["can_act"] is True
    ranks = {"critical": 0, "action_needed": 1, "info": 2}
    order = [ranks[a["severity"]] for a in body["items"]]
    assert order == sorted(order)  # critical first, information last
    assert [a["severity"] for a in body["items"][:2]] == ["critical", "critical"]
    assert body["items"][0]["title"].startswith("Harish Mondal")  # due 8 Nov, before 12 Nov
    assert datetime.fromisoformat(body["last_run"]) == SEED_NOW  # the seed's own run


def test_the_list_can_be_filtered(center: Center) -> None:
    assert [a["severity"] for a in center.alerts(severity="critical")["items"]] == ["critical"] * 2
    assert len(center.alerts(type="document_expiry")["items"]) == 37
    assert len(center.alerts(type="mobilization_stuck")["items"]) == 7
    only_rak07 = center.alerts(project="RAK-07")["items"]
    assert [a["type"] for a in only_rak07] == ["upcoming_shortfall"]
    assert [a["title"] for a in center.alerts(q="Sanjeev")["items"]] == [SANJEEV]
    assert center.alerts(mine="true")["items"] == []
    assert center.alerts(view="snoozed")["items"] == []
    assert center.alerts(view="cleared")["items"] == []
    # The counts follow the other filters, so the chips agree with the list.
    counts = center.alerts(type="document_expiry")["counts"]
    assert counts == {"critical": 2, "action_needed": 7, "info": 28}


def test_the_summary_is_what_the_bell_shows(center: Center) -> None:
    body = center.manager.get("/alerts/summary").json()
    assert body["counts"] == {"critical": 2, "action_needed": 16, "info": 29}
    assert body["needs_attention"] == 18 and body["mine"] == 0
    assert [a["severity"] for a in body["top"]] == ["critical", "critical"] + ["action_needed"] * 3
    assert len(body["top"]) == 5
    ceo = center.ceo.get("/alerts/summary").json()
    assert (
        ceo["counts"] == body["counts"] and ceo["can_act"] is False
    )  # the same numbers, read-only


def test_an_alert_opens_with_its_facts_actions_and_history(center: Center) -> None:
    row = center.find("Sanjeev Rana")
    detail = center.detail(row["id"])
    assert detail["severity"] == "critical" and detail["narrated"] is False
    assert "Sanjeev Rana (EMP-0088)" in detail["explanation"]
    assert detail["facts"]["worker"] == "EMP-0088" and detail["facts"]["threshold"] == 7
    assert [a["action"] for a in detail["actions"]] == ["open_worker"]
    assert detail["actions"][0]["params"] == {"worker": "EMP-0088"}
    assert detail["can_act"] and detail["can_dismiss"]
    assert [(h["by"], h["what"]) for h in detail["history"]] == [("System", "Raised")]
    assert "number" not in str(detail["facts"]).lower()


def test_the_md_sees_the_alert_but_has_no_buttons(center: Center) -> None:
    detail = center.detail(center.find("Sanjeev Rana", who=center.ceo)["id"], who=center.ceo)
    assert detail["can_act"] is False and detail["can_dismiss"] is False
    assert [a["action"] for a in detail["actions"]] == ["open_worker"]  # they may open the worker


def test_only_actions_the_viewer_may_use_are_offered(center: Center) -> None:
    add_user(center.engine, "pm@constructiq.test", "project_manager", projects=("RAK-07",))
    pm = center.make_client()
    sign_in(pm, "pm@constructiq.test")
    row = center.find("RAK-07 starts", who=pm)
    # A project manager may read alerts on their project but holds no forecast permission here.
    assert center.detail(row["id"], who=pm)["actions"] == []


# ------------------------------------------------------------------------------------- scope


def test_a_project_manager_sees_only_alerts_on_their_projects(center: Center) -> None:
    add_user(center.engine, "pm@constructiq.test", "project_manager", projects=("RAK-07",))
    pm = center.make_client()
    sign_in(pm, "pm@constructiq.test")
    mine = center.alerts(pm)["items"]
    assert [a["project"] for a in mine] == ["RAK-07"]  # no company-wide alerts, none elsewhere
    other = center.find("Sanjeev Rana")["id"]  # on another project
    assert pm.get(f"/alerts/{other}").status_code == 404  # not "forbidden": no leak
    assert pm.post(f"/alerts/{other}/take").status_code == 403  # a project manager cannot act


def test_who_may_read_and_who_may_act(center: Center) -> None:
    anonymous = center.make_client()
    assert anonymous.get("/alerts").status_code == 401
    add_user(center.engine, "logistics@constructiq.test", "logistics_coordinator")
    logistics = center.make_client()
    sign_in(logistics, "logistics@constructiq.test")
    assert logistics.get("/alerts").status_code == 403
    assert logistics.get("/alerts/summary").status_code == 403
    sanjeev = center.find("Sanjeev Rana")["id"]
    for path in ("take", "snooze", "dismiss", "assign"):
        assert center.ceo.post(f"/alerts/{sanjeev}/{path}", json={}).status_code == 403
    assert center.ceo.get("/alerts/assignees").status_code == 403
    assert center.manager.post("/alerts/run").status_code == 403  # only the service account runs it


# ---------------------------------------------------------------------------- taking, assigning


def test_taking_an_alert_makes_it_yours_and_is_audited(center: Center) -> None:
    sanjeev = center.find("Sanjeev Rana")["id"]
    response = center.executive.post(f"/alerts/{sanjeev}/take")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["assignee"]) == ("in_progress", "Priya Demo")
    assert [h["what"] for h in body["history"]][0] == "Taken"
    assert center.alerts(center.executive, mine="true")["items"][0]["id"] == sanjeev
    assert center.manager.get("/alerts/summary").json()["mine"] == 0  # not the manager's
    assert center.scalar("SELECT count(*) FROM audit_log WHERE action = 'alert.taken'") == 1


def test_two_people_cannot_take_the_same_alert(center: Center) -> None:
    sanjeev = center.find("Sanjeev Rana")["id"]
    center.executive.post(f"/alerts/{sanjeev}/take")
    refused = center.manager.post(f"/alerts/{sanjeev}/take")
    assert refused.status_code == 409 and "Priya Demo is already working on this" in refused.text


def test_an_alert_can_be_given_to_someone_who_works_on_alerts(center: Center) -> None:
    names = [a["name"] for a in center.manager.get("/alerts/assignees").json()]
    assert names == ["Mr Imtiyaz", "Priya Demo"]  # not the MD, who cannot act
    sanjeev = center.find("Sanjeev Rana")["id"]
    priya = next(
        a["id"] for a in center.manager.get("/alerts/assignees").json() if "Priya" in a["name"]
    )
    body = center.manager.post(f"/alerts/{sanjeev}/assign", json={"user_id": priya}).json()
    assert (body["status"], body["assignee"]) == ("in_progress", "Priya Demo")
    assert "Assigned to Priya Demo" in [h["what"] for h in body["history"]]
    layla = center.scalar("SELECT id::text FROM users WHERE email = :e", e=CEO)
    refused = center.manager.post(f"/alerts/{sanjeev}/assign", json={"user_id": layla})
    assert refused.status_code == 422 and "cannot work on alerts" in refused.text


# ---------------------------------------------------------------------------------- snoozing


def test_snoozing_hides_an_alert_until_the_time_and_is_capped(center: Center) -> None:
    sanjeev = center.find("Sanjeev Rana")["id"]  # critical: at most 24 hours
    too_long = center.manager.post(f"/alerts/{sanjeev}/snooze", json={"until": after(days=2)})
    assert too_long.status_code == 422
    assert "A critical alert can be snoozed for 24 hours at most." in too_long.text
    past = center.manager.post(f"/alerts/{sanjeev}/snooze", json={"until": after(hours=-1)})
    assert past.status_code == 422 and "Choose a time in the future." in past.text

    ok = center.manager.post(f"/alerts/{sanjeev}/snooze", json={"until": after(hours=24)})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "snoozed"
    assert sanjeev not in [a["id"] for a in center.alerts()["items"]]  # gone from the open list
    assert center.alerts()["snoozed"] == 1
    assert [a["id"] for a in center.alerts(view="snoozed")["items"]] == [sanjeev]
    assert center.manager.get("/alerts/summary").json()["counts"]["critical"] == 1
    assert "Snoozed until 6 Nov 2026" in [h["what"] for h in ok.json()["history"]]


def test_a_lesser_alert_can_be_snoozed_for_a_week_but_not_longer(center: Center) -> None:
    labour = center.find("Farhan Ali: labour card")["id"]  # action needed
    assert (
        center.manager.post(f"/alerts/{labour}/snooze", json={"until": after(days=8)}).status_code
        == 422
    )
    refused = center.manager.post(f"/alerts/{labour}/snooze", json={"until": after(days=8)})
    assert "7 days at most" in refused.text
    assert (
        center.manager.post(f"/alerts/{labour}/snooze", json={"until": after(days=7)}).status_code
        == 200
    )


# ---------------------------------------------------------------------------------- dismissing


def test_dismissing_needs_a_reason_and_keeps_the_alert_as_history(center: Center) -> None:
    sanjeev = center.find("Sanjeev Rana")["id"]
    short = center.manager.post(f"/alerts/{sanjeev}/dismiss", json={"reason": "too short"})
    assert short.status_code == 422 and "at least 10 characters" in short.text
    ok = center.manager.post(
        f"/alerts/{sanjeev}/dismiss", json={"reason": "  Renewal already in progress  "}
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert (
        body["status"] == "dismissed" and body["resolution_note"] == "Renewal already in progress"
    )
    assert body["can_act"] is False  # closed
    assert [a["id"] for a in center.alerts(view="cleared")["items"]] == [sanjeev]
    assert sanjeev not in [a["id"] for a in center.alerts()["items"]]
    again = center.manager.post(f"/alerts/{sanjeev}/dismiss", json={"reason": "Doing it again now"})
    assert again.status_code == 409 and "already dismissed" in again.text
    assert center.scalar("SELECT count(*) FROM audit_log WHERE action = 'alert.dismissed'") == 1


def test_some_alerts_can_only_be_snoozed(center: Center) -> None:
    stuck = center.find("MOB-2026-0107")
    assert center.detail(stuck["id"])["can_dismiss"] is False
    refused = center.manager.post(
        f"/alerts/{stuck['id']}/dismiss", json={"reason": "We will do it next week"}
    )
    assert refused.status_code == 409 and "can only be snoozed" in refused.text


def test_a_person_cannot_resolve_an_alert(center: Center) -> None:
    sanjeev = center.find("Sanjeev Rana")["id"]
    for verb in ("resolve", "close"):
        assert center.manager.post(f"/alerts/{sanjeev}/{verb}").status_code in (404, 405)
    assert center.scalar("SELECT status::text FROM alerts WHERE id = :i", i=sanjeev) == "open"


# ------------------------------------------------------------------------------------- bulk


def test_several_alerts_can_be_snoozed_or_assigned_at_once(center: Center) -> None:
    info = [a["id"] for a in center.alerts(severity="info")["items"][:3]]
    done = center.manager.post(
        "/alerts/bulk", json={"ids": info, "action": "snooze", "until": after(hours=5)}
    )
    assert done.status_code == 200 and done.json() == {"changed": 3}
    assert center.alerts()["snoozed"] == 3
    priya = next(
        a["id"] for a in center.manager.get("/alerts/assignees").json() if "Priya" in a["name"]
    )
    more = [a["id"] for a in center.alerts(severity="info")["items"][:2]]
    assigned = center.manager.post(
        "/alerts/bulk", json={"ids": more, "action": "assign", "user_id": priya}
    )
    assert assigned.json() == {"changed": 2}
    assert center.alerts(center.executive, mine="true")["counts"]["info"] == 2
    assert center.scalar("SELECT count(*) FROM audit_log WHERE action = 'alert.snoozed'") == 3


def test_one_refusal_stops_the_whole_batch(center: Center) -> None:
    critical = center.find("Sanjeev Rana")["id"]  # cannot be snoozed past 24 hours
    info = center.alerts(severity="info")["items"][0]["id"]
    refused = center.manager.post(
        "/alerts/bulk", json={"ids": [info, critical], "action": "snooze", "until": after(days=3)}
    )
    assert refused.status_code == 422
    assert center.alerts()["snoozed"] == 0  # not even the first one
    assert center.scalar("SELECT count(*) FROM audit_log WHERE action = 'alert.snoozed'") == 0


def test_bulk_can_snooze_and_assign_but_never_dismiss(center: Center) -> None:
    ids = [center.find("Sanjeev Rana")["id"]]
    refused = center.manager.post("/alerts/bulk", json={"ids": ids, "action": "dismiss"})
    assert refused.status_code == 422
    assert (
        center.manager.post("/alerts/bulk", json={"ids": [], "action": "snooze"}).status_code == 422
    )


# ----------------------------------------------------------- the detectors keep them current


def test_ticking_the_last_task_clears_the_stuck_alert_without_anyone_running_anything(
    center: Center,
) -> None:
    detail = center.manager.get("/mobilizations/MOB-2026-0107").json()
    open_tasks = [t["id"] for t in detail["tasks"] if t["status"] != "done"]
    for task_id in open_tasks:
        assert (
            center.manager.post(f"/mobilizations/MOB-2026-0107/tasks/{task_id}/done").status_code
            == 200
        )
    titles = [a["title"] for a in center.alerts(type="mobilization_stuck")["items"]]
    assert not any(t.startswith("MOB-2026-0107") for t in titles) and len(titles) == 6
    cleared = center.alerts(view="cleared")["items"]
    assert [a["resolution_note"] for a in cleared] == [
        "Condition cleared: the checklist is done and nothing is overdue"
    ]


def test_approving_a_request_clears_the_waiting_alert_and_raises_the_new_checklists(
    center: Center,
) -> None:
    request = center.manager.get("/requests/SR-2026-0001").json()
    line = request["lines"][0]["id"]
    assert center.executive.post(f"/requests/SR-2026-0001/lines/{line}/suggest").status_code == 200
    approved = center.manager.post(f"/requests/SR-2026-0001/lines/{line}/approve", json={})
    assert approved.status_code == 200 and approved.json()["ok"] is True
    titles = [a["title"] for a in center.alerts()["items"]]
    assert not any(t.startswith("SR-2026-0001 has waited") for t in titles)  # it was answered
    assert center.alerts(type="mobilization_stuck")["counts"]["action_needed"] == 14  # 7 + 7 new


def test_moving_a_source_projects_end_date_raises_the_transfer_alert(
    center: Center, migrated_db: Engine
) -> None:
    scenario(migrated_db)  # T-OLD (ends 31 Aug 2027) -> T-NEW (starts 12 Feb 2027)
    reserved = center.manager.post(
        "/projects/T-NEW/reserve", json={"trade": "test_trade", "employee_codes": ["W04", "W05"]}
    )
    assert reserved.json()["reserved"] == 2
    assert center.alerts(type="transfer_dependency_broken")["items"] == []  # nothing has moved

    moved = center.manager.patch("/projects/T-OLD", json={"ends_on": "2027-12-31"})
    assert moved.status_code == 200 and moved.json()["ends"] == "2027-12-31"
    (alert,) = center.alerts(type="transfer_dependency_broken")["items"]
    assert alert["severity"] == "critical" and alert["project"] == "T-NEW"
    assert alert["title"] == (
        "Transfer from T-OLD to T-NEW is at risk: T-OLD now ends 31 Dec 2027, after 5 Feb 2027"
    )
    facts = center.detail(alert["id"])["facts"]
    assert facts["count"] == 2 and [w["code"] for w in facts["workers"]] == ["W04", "W05"]

    center.manager.patch("/projects/T-OLD", json={"ends_on": "2027-08-31"})  # put it back
    assert center.alerts(type="transfer_dependency_broken")["items"] == []
    cleared = center.alerts(type="transfer_dependency_broken", view="cleared")["items"]
    assert [a["resolution_note"] for a in cleared] == [
        "Condition cleared: the dates fit again, or the reservation was released"
    ]


def test_the_scheduled_run_is_for_the_service_account(center: Center, migrated_db: Engine) -> None:
    add_user(migrated_db, "n8n@constructiq.test", "service_n8n")
    service = center.make_client()
    sign_in(service, "n8n@constructiq.test")
    with migrated_db.begin() as c:  # something changed behind the detectors' back
        c.execute(
            text("UPDATE mobilizations SET report_on = '2026-11-25' WHERE mob_no = 'MOB-2026-0103'")
        )
    done = service.post("/alerts/run")
    assert done.status_code == 200 and done.json()["resolved"] == 1
    again = service.post("/alerts/run").json()
    assert again == {"raised": 0, "updated": 0, "resolved": 0, "reopened": 0, "escalated": 0}
    assert (
        center.scalar("SELECT count(*) FROM audit_log WHERE action = 'alerts.detectors_run'") == 3
    )


# ---------------------------------------------------------------------------- project dates


def test_a_projects_dates_can_be_changed_and_its_whole_project_lines_follow(
    center: Center, migrated_db: Engine
) -> None:
    before = center.scalar(
        """SELECT count(*) FROM manpower_requirements m JOIN projects p ON p.id = m.project_id
           WHERE p.code = 'RAK-07' AND m.period = daterange(p.starts_on, p.ends_on, '[]')"""
    )
    assert before > 0
    moved = center.executive.patch("/projects/RAK-07", json={"starts_on": "2027-03-01"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["starts"] == "2027-03-01" and moved.json()["ends"] == "2027-12-31"
    assert (
        center.scalar(
            """SELECT count(*) FROM manpower_requirements m JOIN projects p ON p.id = m.project_id
               WHERE p.code = 'RAK-07' AND m.period = daterange(p.starts_on, p.ends_on, '[]')"""
        )
        == before
    )
    audit = center.scalar(
        "SELECT after_json->>'starts_on' FROM audit_log WHERE action = 'project.dates_changed'"
    )
    assert audit == "2027-03-01"
    # The shortfall alert follows the new start date: a new key, so the old alert clears.
    titles = [a["title"] for a in center.alerts(type="upcoming_shortfall")["items"]]
    assert titles and all("1 Mar 2027" in t for t in titles)


def test_a_project_date_change_is_checked(center: Center) -> None:
    patch = center.manager.patch
    assert patch("/projects/RAK-07", json={}).status_code == 422
    early = patch("/projects/RAK-07", json={"ends_on": "2027-01-01"})
    assert early.status_code == 422 and "end date must not be before the start date" in early.text
    assert patch("/projects/NOPE-1", json={"ends_on": "2027-12-31"}).status_code == 404
    assert center.ceo.patch("/projects/RAK-07", json={"ends_on": "2028-01-31"}).status_code == 403
    same = patch("/projects/RAK-07", json={"ends_on": "2027-12-31"})  # already so: nothing happens
    assert same.status_code == 200
    assert (
        center.scalar("SELECT count(*) FROM audit_log WHERE action = 'project.dates_changed'") == 0
    )
    with center.engine.begin() as c:
        c.execute(text("UPDATE projects SET status = 'completed' WHERE code = 'RAK-07'"))
    closed = patch("/projects/RAK-07", json={"ends_on": "2028-01-31"})
    assert closed.status_code == 409 and "closed" in closed.text


# ------------------------------------------------------------------------------ the insight


def test_the_home_line_is_chosen_in_python_from_the_most_urgent_alert(center: Center) -> None:
    hr = center.manager.get("/summary").json()["insight"]
    assert (
        hr == "Harish Mondal: residency visa ends in 3 days (8 Nov 2026). 17 more need attention."
    )
    ceo = center.ceo.get("/summary").json()["insight"]
    assert ceo == (
        "18 people short across active projects. 8 documents run out in the next 30 days, "
        "and 2 already have."
    )
    add_user(center.engine, "logistics@constructiq.test", "logistics_coordinator")
    logistics = center.make_client()
    sign_in(logistics, "logistics@constructiq.test")
    assert logistics.get("/summary").json()["insight"].startswith("No documents are running out")


def test_with_nothing_left_to_do_the_line_says_so(center: Center) -> None:
    with center.engine.begin() as c:
        c.execute(
            text("UPDATE alerts SET status = 'snoozed', snoozed_until = :u"),
            {"u": SEED_NOW + timedelta(hours=1)},
        )
    assert center.manager.get("/summary").json()["insight"] == "Nothing needs attention today."
