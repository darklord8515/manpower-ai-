"""Mobilization: the pipeline, the checklist, ticking tasks and confirming arrival, rule by rule.

Runs on the seeded demo. Its nine Mobilizing workers are MOB-2026-0101 to 0109, all reporting on
Sunday 8 Nov 2026 (the simulated date is Thursday 5 Nov):

  0101 0102  all three tasks done (ready to report)
  0103 0104  documents and PPE done        0105 0106 0108  documents done
  0107       PPE done; the documents check (due 1 Nov) and induction are open
  0109       nothing done; the documents check is overdue

HR (Manager and Executive) ticks tasks and confirms arrival; the MD/CEO only reads.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.services.mobilization import stage_of
from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in

TODAY = date(2026, 11, 5)


class Pipeline:
    def __init__(self, make_client: Any, engine: Engine) -> None:
        self.engine = engine
        self.make_client = make_client
        self.manager: TestClient = make_client()
        self.executive: TestClient = make_client()
        self.ceo: TestClient = make_client()
        sign_in(self.manager, HR_MANAGER)
        sign_in(self.executive, HR_EXECUTIVE)
        sign_in(self.ceo, CEO)

    def rows(self, who: TestClient | None = None, **params: Any) -> list[dict[str, Any]]:
        response = (who or self.manager).get("/mobilizations", params=params)
        assert response.status_code == 200, response.text
        return response.json()["items"]

    def row(self, mob_no: str) -> dict[str, Any]:
        return next(r for r in self.rows() if r["mob_no"] == mob_no)

    def detail(self, mob_no: str, who: TestClient | None = None) -> dict[str, Any]:
        response = (who or self.manager).get(f"/mobilizations/{mob_no}")
        assert response.status_code == 200, response.text
        return response.json()

    def task(self, mob_no: str, title_start: str) -> dict[str, Any]:
        return next(t for t in self.detail(mob_no)["tasks"] if t["title"].startswith(title_start))

    def tick(
        self, mob_no: str, title_start: str, who: TestClient | None = None, action: str = "done"
    ) -> Any:
        task = self.task(mob_no, title_start)
        return (who or self.manager).post(f"/mobilizations/{mob_no}/tasks/{task['id']}/{action}")

    def arrive(self, mob_no: str, who: TestClient | None = None) -> Any:
        return (who or self.manager).post(f"/mobilizations/{mob_no}/arrival")

    def report_today(self, mob_no: str) -> None:
        """Pretend the report day has come: the rule compares the report date with the clock."""
        with self.engine.begin() as c:
            c.execute(
                text("UPDATE mobilizations SET report_on = :d WHERE mob_no = :n"),
                {"d": TODAY, "n": mob_no},
            )

    def scalar(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as c:
            return c.execute(text(sql), params).scalar_one()  # noqa: S608


@pytest.fixture
def pipeline(make_client: Any, migrated_db: Engine) -> Pipeline:
    return Pipeline(make_client, migrated_db)


# ------------------------------------------------------------------------------------ the stage


@pytest.mark.parametrize(
    ("status", "done", "total", "stage"),
    [
        ("approved", 0, 3, "pending_checklist"),
        ("in_progress", 1, 3, "in_progress"),
        ("in_progress", 2, 3, "in_progress"),
        ("in_progress", 3, 3, "ready"),
        ("completed", 3, 3, "on_site"),
        ("pending_approval", 0, 0, "pending_checklist"),
    ],
)
def test_the_stage_is_computed_from_the_tasks(
    status: str, done: int, total: int, stage: str
) -> None:
    assert stage_of(status, done, total) == stage


# --------------------------------------------------------------------------------- the pipeline


def test_the_seeded_pipeline_has_nine_cards_in_their_stages(pipeline: Pipeline) -> None:
    response = pipeline.manager.get("/mobilizations")
    assert response.json()["today"] == "2026-11-05"
    rows = response.json()["items"]
    assert [r["mob_no"] for r in rows] == [f"MOB-2026-{n:04d}" for n in range(101, 110)]
    by_stage: dict[str, list[str]] = {}
    for r in rows:
        by_stage.setdefault(r["stage"], []).append(r["mob_no"][-4:])
    assert by_stage == {
        "ready": ["0101", "0102"],
        "in_progress": ["0103", "0104", "0105", "0106", "0107", "0108"],
        "pending_checklist": ["0109"],
    }
    stuck = pipeline.row("MOB-2026-0107")
    assert (stuck["tasks_done"], stuck["tasks_total"], stuck["overdue"]) == (1, 3, 1)
    assert stuck["report_on"] == "2026-11-08" and stuck["arrived_on"] is None
    assert stuck["worker_name"] and stuck["worker_code"].startswith("EMP-")
    assert stuck["project_code"].startswith("RAK-")


def test_the_pipeline_can_be_searched_and_filtered(pipeline: Pipeline) -> None:
    stuck = pipeline.row("MOB-2026-0107")
    assert [r["mob_no"] for r in pipeline.rows(q="0107")] == ["MOB-2026-0107"]
    assert [r["mob_no"] for r in pipeline.rows(q=stuck["worker_code"])] == ["MOB-2026-0107"]
    assert {r["project_code"] for r in pipeline.rows(project=stuck["project_code"])} >= {
        stuck["project_code"]
    }
    assert all(
        r["project_code"] == stuck["project_code"]
        for r in pipeline.rows(project=stuck["project_code"])
    )
    assert [r["mob_no"] for r in pipeline.rows(overdue="true")] == [
        "MOB-2026-0107",
        "MOB-2026-0109",
    ]
    assert pipeline.rows(q="nobody by this name") == []


def test_a_checklist_lists_its_tasks_by_department_with_who_did_them(pipeline: Pipeline) -> None:
    detail = pipeline.detail("MOB-2026-0107")
    assert [(t["department"], t["title"]) for t in detail["tasks"]] == [
        ("hr", "Verify residency visa and medical fitness"),
        ("site", "Issue PPE"),
        ("site", "Site induction"),
    ]
    docs, ppe, induction = detail["tasks"]
    assert (docs["status"], docs["overdue"], docs["due_on"]) == ("open", True, "2026-11-01")
    assert (ppe["status"], ppe["done_by"], ppe["overdue"]) == ("done", "Mr Imtiyaz", False)
    assert (induction["status"], induction["overdue"]) == ("open", False)  # due on the report day
    assert detail["can_update"] is True and detail["update_note"] is None
    assert detail["can_confirm_arrival"] is False
    assert (
        detail["arrival_note"] == "Reports on 8 Nov 2026. Arrival can be confirmed from that day."
    )


def test_an_unknown_mobilization_is_not_found(pipeline: Pipeline) -> None:
    assert pipeline.manager.get("/mobilizations/MOB-2026-9999").status_code == 404
    assert pipeline.arrive("MOB-2026-9999").status_code == 404
    bogus = "00000000-0000-4000-8000-000000000000"
    assert (
        pipeline.manager.post(f"/mobilizations/MOB-2026-0107/tasks/{bogus}/done").status_code == 404
    )


def test_people_who_arrived_stay_for_two_weeks_then_leave_the_pipeline(pipeline: Pipeline) -> None:
    pipeline.report_today("MOB-2026-0101")
    assert pipeline.arrive("MOB-2026-0101").status_code == 200
    assert pipeline.row("MOB-2026-0101")["stage"] == "on_site"
    with pipeline.engine.begin() as c:
        c.execute(
            text(
                """UPDATE employee_assignments SET arrived_at = now() - interval '20 days'
                   WHERE id = (SELECT assignment_id FROM mobilizations WHERE mob_no = :n)"""
            ),
            {"n": "MOB-2026-0101"},
        )
    assert "MOB-2026-0101" not in [r["mob_no"] for r in pipeline.rows()]


# ------------------------------------------------------------------------------ ticking tasks


def test_ticking_a_task_moves_the_card_and_records_who(pipeline: Pipeline) -> None:
    assert pipeline.row("MOB-2026-0109")["stage"] == "pending_checklist"
    response = pipeline.tick("MOB-2026-0109", "Verify residency visa")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert (detail["tasks_done"], detail["stage"], detail["status"]) == (
        1,
        "in_progress",
        "in_progress",
    )
    assert detail["overdue"] == 0  # the overdue documents task is done
    docs = detail["tasks"][0]
    assert (docs["status"], docs["done_by"], docs["overdue"]) == ("done", "Mr Imtiyaz", False)
    assert docs["done_at"] is not None
    readiness = pipeline.scalar(
        "SELECT readiness FROM mobilizations WHERE mob_no = :n", n="MOB-2026-0109"
    )
    assert readiness == {"documents": True, "ppe": False, "induction": False}
    audit = pipeline.scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'mobilization.task_done'"
    )
    assert audit == 1


def test_ticking_again_changes_nothing_and_is_not_audited_twice(pipeline: Pipeline) -> None:
    assert pipeline.tick("MOB-2026-0109", "Issue PPE").status_code == 200
    assert pipeline.tick("MOB-2026-0109", "Issue PPE").status_code == 200
    assert pipeline.row("MOB-2026-0109")["tasks_done"] == 1
    assert (
        pipeline.scalar("SELECT count(*) FROM audit_log WHERE action = 'mobilization.task_done'")
        == 1
    )


def test_reopening_the_last_done_task_puts_the_card_back(pipeline: Pipeline) -> None:
    pipeline.tick("MOB-2026-0109", "Site induction")
    assert pipeline.row("MOB-2026-0109")["stage"] == "in_progress"
    response = pipeline.tick("MOB-2026-0109", "Site induction", action="reopen")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert (detail["tasks_done"], detail["stage"], detail["status"]) == (
        0,
        "pending_checklist",
        "approved",
    )
    induction = detail["tasks"][-1]
    assert (induction["status"], induction["done_by"], induction["done_at"]) == ("open", None, None)
    assert (
        pipeline.scalar(
            "SELECT readiness->>'induction' FROM mobilizations WHERE mob_no = :n", n="MOB-2026-0109"
        )
        == "false"
    )
    assert (
        pipeline.scalar(
            "SELECT count(*) FROM audit_log WHERE action = 'mobilization.task_reopened'"
        )
        == 1
    )


def test_finishing_the_last_task_makes_the_card_ready(pipeline: Pipeline) -> None:
    for title in ("Verify residency visa", "Site induction"):
        response = pipeline.tick("MOB-2026-0107", title)
        assert response.status_code == 200, response.text
    assert response.json()["stage"] == "ready"
    assert pipeline.row("MOB-2026-0107")["overdue"] == 0


def test_the_hr_executive_ticks_tasks_too(pipeline: Pipeline) -> None:
    response = pipeline.tick("MOB-2026-0109", "Issue PPE", who=pipeline.executive)
    assert response.status_code == 200, response.text
    assert response.json()["tasks"][1]["done_by"] == "Priya Demo"


def test_the_md_reads_the_pipeline_but_cannot_change_it(pipeline: Pipeline) -> None:
    assert len(pipeline.rows(who=pipeline.ceo)) == 9
    detail = pipeline.detail("MOB-2026-0107", who=pipeline.ceo)
    assert detail["can_update"] is False and detail["update_note"] == "Only HR ticks tasks off."
    assert (
        detail["can_confirm_arrival"] is False
        and detail["arrival_note"] == "Only HR confirms arrival."
    )
    task = pipeline.task("MOB-2026-0107", "Site induction")
    assert (
        pipeline.ceo.post(f"/mobilizations/MOB-2026-0107/tasks/{task['id']}/done").status_code
        == 403
    )
    assert pipeline.arrive("MOB-2026-0101", who=pipeline.ceo).status_code == 403
    assert pipeline.task("MOB-2026-0107", "Site induction")["status"] == "open"


def test_a_signed_out_visitor_gets_nothing(pipeline: Pipeline) -> None:
    anonymous = pipeline.make_client()
    assert anonymous.get("/mobilizations").status_code == 401
    assert anonymous.post("/mobilizations/MOB-2026-0101/arrival").status_code == 401


def test_a_task_of_another_mobilization_is_not_found(pipeline: Pipeline) -> None:
    other = pipeline.task("MOB-2026-0108", "Issue PPE")
    response = pipeline.manager.post(f"/mobilizations/MOB-2026-0107/tasks/{other['id']}/done")
    assert response.status_code == 404 and "Task not found" in response.text


def test_a_mobilization_waiting_for_approval_has_no_checklist_to_tick(pipeline: Pipeline) -> None:
    with pipeline.engine.begin() as c:
        c.execute(
            text(
                """UPDATE mobilizations SET status = 'pending_approval'
                   WHERE mob_no = 'MOB-2026-0109'"""
            )
        )
    refused = pipeline.tick("MOB-2026-0109", "Issue PPE")
    assert refused.status_code == 409 and "waits for approval" in refused.text
    arrival = pipeline.arrive("MOB-2026-0109")
    assert arrival.status_code == 409 and "pending approval" in arrival.text


# ---------------------------------------------------------------------------- confirming arrival


def test_arrival_waits_for_the_report_day(pipeline: Pipeline) -> None:
    response = pipeline.arrive("MOB-2026-0101")  # all done, but it reports on 8 Nov
    assert response.status_code == 409
    assert "Reports on 8 Nov 2026. Arrival can be confirmed from that day." in response.text
    assert pipeline.row("MOB-2026-0101")["stage"] == "ready"


def test_arrival_waits_for_the_checklist_and_names_how_much_is_left(pipeline: Pipeline) -> None:
    pipeline.report_today("MOB-2026-0103")
    response = pipeline.arrive("MOB-2026-0103")  # two of three done
    assert response.status_code == 409
    assert "Finish the checklist first: 1 task is still open." in response.text
    pipeline.report_today("MOB-2026-0105")
    assert "2 tasks are still open" in pipeline.arrive("MOB-2026-0105").text
    detail = pipeline.detail("MOB-2026-0103")
    assert detail["can_confirm_arrival"] is False
    assert detail["arrival_note"] == "Finish the checklist first: 1 task is still open."


def test_confirming_arrival_starts_the_assignment_and_deploys_the_worker(
    pipeline: Pipeline,
) -> None:
    pipeline.report_today("MOB-2026-0101")
    assert pipeline.detail("MOB-2026-0101")["can_confirm_arrival"] is True
    response = pipeline.arrive("MOB-2026-0101")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert (detail["stage"], detail["status"]) == ("on_site", "completed")
    assert detail["arrived_on"] is not None and detail["can_confirm_arrival"] is False
    assert detail["arrival_note"].startswith(f"{detail['worker_name']} arrived on ")

    worker = detail["worker_code"]
    assert (
        pipeline.scalar(
            """SELECT a.status::text || '/' || (a.arrived_at IS NOT NULL)::text
               FROM employee_assignments a JOIN mobilizations m ON m.assignment_id = a.id
               WHERE m.mob_no = 'MOB-2026-0101'"""
        )
        == "active/true"
    )
    assert (
        pipeline.scalar(
            "SELECT availability::text FROM employees WHERE employee_code = :c", c=worker
        )
        == "deployed"
    )
    assert pipeline.scalar(
        "SELECT completed_at IS NOT NULL FROM mobilizations WHERE mob_no = 'MOB-2026-0101'"
    )
    assert (
        pipeline.scalar(
            "SELECT count(*) FROM audit_log WHERE action = 'mobilization.arrival_confirmed'"
        )
        == 1
    )


def test_arrival_happens_once_and_closes_the_checklist(pipeline: Pipeline) -> None:
    pipeline.report_today("MOB-2026-0102")
    assert pipeline.arrive("MOB-2026-0102").status_code == 200
    again = pipeline.arrive("MOB-2026-0102")
    assert again.status_code == 409 and "arrived on" in again.text
    reopen = pipeline.tick("MOB-2026-0102", "Issue PPE", action="reopen")
    assert reopen.status_code == 409 and "checklist is closed" in reopen.text
    assert pipeline.row("MOB-2026-0102")["tasks_done"] == 3


def test_the_hr_executive_confirms_arrival_too(pipeline: Pipeline) -> None:
    pipeline.report_today("MOB-2026-0101")
    assert pipeline.arrive("MOB-2026-0101", who=pipeline.executive).status_code == 200


# --------------------------------------------------------------------------- who sees what


def test_a_project_manager_sees_only_the_mobilizations_on_their_projects(
    pipeline: Pipeline,
) -> None:
    mine = pipeline.row("MOB-2026-0105")
    add_user(
        pipeline.engine, "pm@constructiq.test", "project_manager",
        projects=(mine["project_code"],),
    )  # fmt: skip
    pm = pipeline.make_client()
    sign_in(pm, "pm@constructiq.test")
    visible = pipeline.rows(who=pm)
    assert "MOB-2026-0105" in [r["mob_no"] for r in visible]
    assert {r["project_code"] for r in visible} == {mine["project_code"]}
    outside = next(
        r["mob_no"] for r in pipeline.rows() if r["project_code"] != mine["project_code"]
    )
    assert pm.get(f"/mobilizations/{outside}").status_code == 404  # not "forbidden": no leak
    assert pm.post(f"/mobilizations/{outside}/arrival").status_code == 403  # no such permission


def test_the_logistics_coordinator_reads_but_cannot_change(pipeline: Pipeline) -> None:
    add_user(pipeline.engine, "logistics@constructiq.test", "logistics_coordinator")
    logistics = pipeline.make_client()
    sign_in(logistics, "logistics@constructiq.test")
    assert len(pipeline.rows(who=logistics)) == 9
    task = pipeline.task("MOB-2026-0107", "Site induction")
    assert (
        logistics.post(f"/mobilizations/MOB-2026-0107/tasks/{task['id']}/done").status_code == 403
    )


def test_the_hr_roles_hold_the_new_permissions_and_the_md_does_not(pipeline: Pipeline) -> None:
    for client in (pipeline.manager, pipeline.executive):
        permissions = client.get("/auth/me").json()["permissions"]
        assert "mobilization:update" in permissions and "assignment:confirm_arrival" in permissions
    permissions = pipeline.ceo.get("/auth/me").json()["permissions"]
    assert "mobilization:read" in permissions and "mobilization:update" not in permissions


# --------------------------------------------------------------------------- the worker profile


def test_a_worker_profile_shows_their_mobilization_number_and_progress(pipeline: Pipeline) -> None:
    code = pipeline.row("MOB-2026-0107")["worker_code"]
    profile = pipeline.manager.get(f"/workers/{code}").json()
    brief = profile["assignments"][0]["mobilization"]
    assert brief == {
        "mob_no": "MOB-2026-0107", "status": "in_progress", "stage": "in_progress",
        "tasks_done": 1, "tasks_total": 3,
    }  # fmt: skip
    # People who are simply deployed have no mobilization.
    deployed = pipeline.manager.get("/workers", params={"status": "deployed"}).json()["items"][0]
    detail = pipeline.manager.get(f"/workers/{deployed['code']}").json()
    assert all(a["mobilization"] is None for a in detail["assignments"])
