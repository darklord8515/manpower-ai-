"""Adding a project: who may, what is checked, and that the forecast works straight away."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in


def body(**changes: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "name": "Al Hamra Marina Towers",
        "starts_on": "2027-04-01",
        "ends_on": "2028-03-31",
        "lines": [
            {"trade": "mason", "headcount": 12},
            {"trade": "carpenter", "headcount": 6, "starts_on": "2027-06-01"},
        ],
    }
    data.update(changes)
    return data


def test_hr_adds_a_project_and_gets_the_next_code(client: TestClient, migrated_db: Engine) -> None:
    sign_in(client, HR_MANAGER)
    created = client.post("/projects", json=body())
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["code"] == "RAK-08"  # the seed ends at RAK-07
    assert (project["status"], project["planned"], project["deployed"]) == ("planning", 18, 0)
    assert project["starts"] == "2027-04-01" and project["ends"] == "2028-03-31"
    assert client.post("/projects", json=body(name="Second project")).json()["code"] == "RAK-09"
    with migrated_db.connect() as c:
        lines = c.execute(
            text(
                """SELECT t.code, m.headcount, lower(m.period)::text, upper(m.period)::text
                   FROM manpower_requirements m JOIN trades t ON t.id = m.trade_id
                   JOIN projects p ON p.id = m.project_id WHERE p.code = 'RAK-08' ORDER BY 1"""
            )
        ).all()
        sites = c.execute(
            text(
                "SELECT count(*) FROM project_sites s JOIN projects p ON p.id = s.project_id "
                "WHERE p.code = 'RAK-08'"
            )
        ).scalar_one()
        audited = c.execute(
            text("SELECT count(*) FROM audit_log WHERE action = 'project.created'")
        ).scalar_one()
    assert lines == [
        ("carpenter", 6, "2027-06-01", "2028-04-01"),  # its own start; ends with the project
        ("mason", 12, "2027-04-01", "2028-04-01"),  # the project's dates ('[]' stores the next day)
    ]
    assert sites == 1 and audited == 2


def test_the_new_project_has_a_forecast_straight_away(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    code = client.post("/projects", json=body()).json()["code"]
    forecast = client.get(f"/projects/{code}/forecast")
    assert forecast.status_code == 200
    trades = {t["trade_code"]: t for t in forecast.json()["trades"]}
    assert set(trades) == {"mason", "carpenter"} and trades["mason"]["needed"] == 12


def test_the_hr_executive_may_add_a_project_but_the_ceo_may_not(
    make_client: Any, migrated_db: Engine
) -> None:
    executive, ceo = make_client(), make_client()
    sign_in(executive, HR_EXECUTIVE)
    sign_in(ceo, CEO)
    assert executive.post("/projects", json=body()).status_code == 201
    assert ceo.post("/projects", json=body()).status_code == 403
    add_user(migrated_db, "pm@constructiq.test", "project_manager")
    manager = make_client()
    sign_in(manager, "pm@constructiq.test")
    assert manager.post("/projects", json=body()).status_code == 403


def test_a_signed_out_visitor_cannot_add_a_project(client: TestClient) -> None:
    assert client.post("/projects", json=body()).status_code == 401


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"name": "  "}, "name"),
        ({"name": "ab"}, "name"),
        ({"ends_on": "2027-03-01"}, "end date"),
        ({"lines": []}, "lines"),
        ({"lines": [{"trade": "mason", "headcount": 0}]}, "headcount"),
        ({"lines": [{"trade": "mason", "headcount": 501}]}, "headcount"),
        (
            {"lines": [{"trade": "mason", "headcount": 1}, {"trade": "mason", "headcount": 2}]},
            "once",
        ),
        (
            {"lines": [{"trade": "mason", "headcount": 1, "starts_on": "2027-01-01"}]},
            "inside",
        ),
        (
            {"lines": [{"trade": "mason", "headcount": 1, "ends_on": "2028-06-01"}]},
            "inside",
        ),
        (
            {
                "lines": [
                    {
                        "trade": "mason",
                        "headcount": 1,
                        "starts_on": "2027-09-01",
                        "ends_on": "2027-08-01",
                    }
                ]
            },
            "end date",
        ),
    ],
)
def test_bad_projects_are_refused_with_a_reason(
    client: TestClient, migrated_db: Engine, changes: dict[str, Any], message: str
) -> None:
    sign_in(client, HR_MANAGER)
    response = client.post("/projects", json=body(**changes))
    assert response.status_code == 422, response.text
    assert message in response.text
    with migrated_db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM projects")).scalar_one() == 7  # nothing saved


def test_an_unknown_trade_is_named(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    response = client.post("/projects", json=body(lines=[{"trade": "wizard", "headcount": 1}]))
    assert response.status_code == 422 and "Unknown trade: wizard" in response.text


def test_the_trade_list_for_the_form(client: TestClient) -> None:
    assert client.get("/trades").status_code == 401
    sign_in(client, HR_MANAGER)
    trades = client.get("/trades").json()
    assert [t["name"] for t in trades] == sorted(t["name"] for t in trades)
    assert {"code": "steel_fixer", "name": "Steel fixer"} in trades and len(trades) == 8
