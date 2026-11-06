"""Reserving and releasing people. Uses the forecast scenario from tests/world.py:

W01 free now · W04 finishes 31 Jan · W05 finishes 5 Feb · W06 finishes 6 Feb (inside the buffer)
W07 finishes 22 Feb · W02 on leave · W03 visa ends early · W11 not available · W12 planned elsewhere
"""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, sign_in
from tests.world import World, scenario

PROJECT = "T-NEW"


def reserve(client: TestClient, codes: list[str], **extra: Any) -> dict[str, Any]:
    response = client.post(
        f"/projects/{PROJECT}/reserve",
        json={"trade": "test_trade", "employee_codes": codes, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def by_code(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["code"]: r for r in body["results"]}


def planned(engine: Engine) -> dict[str, tuple[str, str | None, str | None]]:
    """code -> (first day, day after the last, project the person moves from)."""
    with engine.connect() as c:
        rows = c.execute(
            text(
                """SELECT e.employee_code, lower(a.period)::text, upper(a.period)::text, dp.code
                   FROM employee_assignments a
                   JOIN employees e ON e.id = a.employee_id
                   JOIN projects p ON p.id = a.project_id AND p.code = 'T-NEW'
                   LEFT JOIN employee_assignments d ON d.id = a.depends_on_assignment_id
                   LEFT JOIN projects dp ON dp.id = d.project_id
                   WHERE a.status = 'planned' ORDER BY 1"""
            )
        ).all()
    return {r[0]: (r[1], r[2], r[3]) for r in rows}


def test_reserving_creates_planned_assignments_and_links_the_transfers(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    body = reserve(client, ["W01", "W04", "W05"])
    assert body["reserved"] == 3
    results = by_code(body)
    assert results["W01"]["starts_on"] == "2027-02-12" and results["W01"]["moving_from"] is None
    assert (
        results["W04"]["moving_from"] == "T-OLD"
        and results["W04"]["moving_from_ends"] == "2027-01-31"
    )
    # Everyone starts on the project's start date (they were all free by then), until its end.
    assert planned(migrated_db) == {
        "W01": ("2027-02-12", "2028-01-01", None),
        "W04": ("2027-02-12", "2028-01-01", "T-OLD"),
        "W05": ("2027-02-12", "2028-01-01", "T-OLD"),
    }
    with migrated_db.connect() as c:
        audit = c.execute(
            text("SELECT after_json FROM audit_log WHERE action = 'project.people_reserved'")
        ).scalar_one()
    assert audit["reserved"] == ["W01", "W04", "W05"] and audit["refused"] == {}


def test_the_forecast_then_shows_them_as_reserved_and_assigned(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)  # needs 6; W13 is already on the project
    sign_in(client, HR_MANAGER)
    before = client.get(f"/projects/{PROJECT}/forecast").json()["trades"][0]
    assert (before["already_assigned"], before["deployable"], before["reserved"]) == (1, 3, [])
    reserve(client, ["W01", "W04"])
    after = client.get(f"/projects/{PROJECT}/forecast").json()["trades"][0]
    assert (after["already_assigned"], after["deployable"]) == (
        3,
        1,
    )  # held people leave "deployable"
    assert [(r["code"], r["moving_from"]) for r in after["reserved"]] == [
        ("W01", None),
        ("W04", "T-OLD"),
    ]
    assert after["gap"] == before["gap"]  # reserving moves people, it does not change the gap


def test_someone_who_could_join_late_starts_after_they_finish(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    result = by_code(reserve(client, ["W07"]))["W07"]  # last day 22 Feb 2027
    assert result["outcome"] == "reserved" and result["starts_on"] == "2027-02-23"
    assert planned(migrated_db)["W07"][0] == "2027-02-23"


def test_every_rule_is_checked_per_person_and_the_rest_still_go_through(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    body = reserve(client, ["W01", "W02", "W03", "W10", "W11", "W12", "NOBODY"])
    results = by_code(body)
    assert body["reserved"] == 1 and results["W01"]["outcome"] == "reserved"
    assert results["W02"]["reason"].startswith("Approved leave 1 Feb 2027 to 20 Feb 2027")
    assert results["W03"]["reason"] == "Residency visa ends 1 Mar 2027"
    assert results["W11"]["reason"] == "Not available (leave or medical)"
    assert results["W12"]["reason"] == "Planned on T-OTH from 1 Feb 2027"
    assert results["W10"]["reason"] == "Not available for this project."  # open-ended: never ending
    assert results["NOBODY"]["reason"] == "Not available for this project."
    assert list(planned(migrated_db)) == ["W01"]


def test_a_leaver_cannot_be_reserved_and_the_same_person_twice_is_refused(
    client: TestClient, migrated_db: Engine
) -> None:
    w = World(migrated_db)
    w.project("T-NEW", date(2027, 2, 12), date(2027, 12, 31), need=3, status="planning")
    w.worker("L01", exit_on=date(2027, 3, 1), exit_reason="resigned")
    w.worker("W01")
    sign_in(client, HR_MANAGER)
    first = by_code(reserve(client, ["L01", "W01"]))
    assert first["L01"]["outcome"] == "refused"
    assert first["L01"]["reason"] == "Leaving the company on 1 Mar 2027 (resigned)"
    again = by_code(reserve(client, ["W01"]))["W01"]
    assert again["outcome"] == "refused" and again["reason"] == "Already planned on this project."


def test_a_second_project_cannot_hold_the_same_person_for_the_same_dates(
    client: TestClient, migrated_db: Engine
) -> None:
    w = scenario(migrated_db)
    w.project("T-TWO", date(2027, 2, 12), date(2027, 12, 31), need=2, status="planning")
    sign_in(client, HR_MANAGER)
    reserve(client, ["W01"])
    other = client.post(
        "/projects/T-TWO/reserve", json={"trade": "test_trade", "employee_codes": ["W01"]}
    ).json()["results"][0]
    assert other["outcome"] == "refused"
    assert other["reason"] in (
        "Already planned on another project for these dates.",
        "Planned on T-NEW from 12 Feb 2027",
    )


def test_release_frees_the_person_and_keeps_the_history(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    reserve(client, ["W01", "W04"])
    released = client.post(f"/projects/{PROJECT}/release", json={"employee_codes": ["W01", "W99"]})
    assert released.status_code == 200
    assert released.json() == {"released": ["W01"], "not_found": ["W99"]}
    assert list(planned(migrated_db)) == ["W04"]
    with migrated_db.connect() as c:
        status = c.execute(
            text(
                """SELECT a.status::text FROM employee_assignments a
                   JOIN employees e ON e.id = a.employee_id WHERE e.employee_code = 'W01'
                   AND a.project_id = (SELECT id FROM projects WHERE code = 'T-NEW')"""
            )
        ).scalar_one()
    assert status == "cancelled"
    assert by_code(reserve(client, ["W01"]))["W01"]["outcome"] == "reserved"  # free again


def test_only_people_who_may_approve_assignments_can_reserve_or_release(
    make_client: Any, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    executive, ceo, manager = make_client(), make_client(), make_client()
    sign_in(executive, HR_EXECUTIVE)
    sign_in(ceo, CEO)
    sign_in(manager, HR_MANAGER)
    payload = {"trade": "test_trade", "employee_codes": ["W01"]}
    assert executive.post(f"/projects/{PROJECT}/reserve", json=payload).status_code == 403
    assert (
        executive.post(f"/projects/{PROJECT}/release", json={"employee_codes": ["W01"]}).status_code
        == 403
    )
    assert ceo.post(f"/projects/{PROJECT}/reserve", json=payload).status_code == 200
    assert manager.post("/projects/NOPE-1/reserve", json=payload).status_code == 404


def test_a_trade_the_project_does_not_need_is_refused(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    response = client.post(
        f"/projects/{PROJECT}/reserve", json={"trade": "mason", "employee_codes": ["W01"]}
    )
    assert response.status_code == 422
    assert (
        client.post(
            f"/projects/{PROJECT}/reserve", json={"trade": "mason", "employee_codes": []}
        ).status_code
        == 422
    )
