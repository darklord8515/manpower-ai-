"""The API against a real, seeded Postgres: login, permissions, scope and masking."""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.exports import csv_cell
from app.seed.data import SEED_TODAY
from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, PASSWORD, add_user, sign_in

# --------------------------------------------------------------------------- sign in


def test_every_data_route_needs_a_login(client: TestClient) -> None:
    for path in ("/auth/me", "/workers", "/workers/EMP-0088", "/documents/expiring",
                 "/projects", "/summary"):  # fmt: skip
        assert client.get(path).status_code == 401, path
    assert client.post("/auth/logout").status_code == 401


def test_wrong_password_and_unknown_email_look_the_same(client: TestClient) -> None:
    wrong = client.post("/auth/login", json={"email": HR_MANAGER, "password": "nope"})
    unknown = client.post("/auth/login", json={"email": "nobody@constructiq.test", "password": "x"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert "set-cookie" not in wrong.headers


def test_signing_in_sets_a_locked_down_cookie_and_returns_the_user(client: TestClient) -> None:
    response = client.post("/auth/login", json={"email": HR_MANAGER, "password": PASSWORD})
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    me = response.json()
    assert me["roles"] == ["hr_manager"] and me["landing"] == "hr"
    assert "employee:read_sensitive" in me["permissions"]
    assert "password" not in response.text.lower()
    assert client.get("/auth/me").json()["email"] == HR_MANAGER


def test_the_ceo_lands_on_the_executive_home(client: TestClient) -> None:
    sign_in(client, CEO)
    assert client.get("/auth/me").json()["landing"] == "executive"


def test_five_wrong_passwords_lock_the_email_even_for_the_right_password(
    client: TestClient,
) -> None:
    for _ in range(5):
        client.post("/auth/login", json={"email": HR_EXECUTIVE, "password": "wrong"})
    right = client.post("/auth/login", json={"email": HR_EXECUTIVE, "password": PASSWORD})
    assert right.status_code == 429


def test_a_request_from_another_site_is_refused(client: TestClient) -> None:
    body = {"email": HR_MANAGER, "password": PASSWORD}
    evil = client.post("/auth/login", json=body, headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    ok = client.post("/auth/login", json=body, headers={"Origin": "http://localhost:3000"})
    assert ok.status_code == 200


def test_signing_out_ends_the_session_and_everything_is_audited(
    client: TestClient, migrated_db: Engine
) -> None:
    client.post("/auth/login", json={"email": HR_MANAGER, "password": "wrong"})
    sign_in(client, HR_MANAGER)
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401
    with migrated_db.connect() as c:
        actions = [  # the seed also logs the alerts it raised; this test is about signing in
            r[0]
            for r in c.execute(
                text("SELECT action FROM audit_log WHERE action LIKE 'auth.%' ORDER BY id")
            )
        ]
    assert actions == ["auth.login_failed", "auth.login", "auth.logout"]


def test_a_deactivated_user_cannot_use_an_existing_session(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_EXECUTIVE)
    with migrated_db.begin() as c:
        c.execute(text("UPDATE users SET is_active = false WHERE email = :e"), {"e": HR_EXECUTIVE})
    assert client.get("/workers").status_code == 401


# --------------------------------------------------------------------------- demo role switcher


def test_the_demo_role_switcher_signs_in_through_a_normal_session(client: TestClient) -> None:
    response = client.post("/auth/demo-login", json={"role": "ceo"})
    assert response.status_code == 200
    assert client.get("/auth/me").json()["roles"] == ["ceo"]
    # It is an ordinary session: the CEO still cannot do what the CEO role may not.
    assert client.get("/workers").status_code == 200


def test_the_demo_role_switcher_only_offers_the_mvp_roles(client: TestClient) -> None:
    assert client.post("/auth/demo-login", json={"role": "super_admin"}).status_code == 404
    assert client.post("/auth/demo-login", json={"role": "nonsense"}).status_code == 404


def test_the_demo_role_switcher_is_not_found_when_demo_mode_is_off(
    make_client: Callable[..., TestClient],
) -> None:
    client = make_client(demo_mode=False)
    assert client.post("/auth/demo-login", json={"role": "ceo"}).status_code == 404
    assert client.get("/auth/me").status_code == 401


# --------------------------------------------------------------------------- workers and scope


def test_hr_sees_all_150_workers_with_documents_counted_from_the_demo_date(
    client: TestClient,
) -> None:
    sign_in(client, HR_MANAGER)
    page = client.get("/workers", params={"limit": 5, "sort": "docs"}).json()
    assert page["total"] == 150 and len(page["items"]) == 5
    # Two documents are already expired, then the first to run out is 3 days away (8 Nov 2026).
    assert [w["next_document"]["days_left"] for w in page["items"]][:3] == [-11, -4, 3]
    assert page["items"][2]["next_document"]["expiry"] == "2026-11-08"


def test_workers_can_be_searched_filtered_and_sorted(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    assert client.get("/workers", params={"q": "sanjeev"}).json()["total"] == 1
    assert client.get("/workers", params={"status": "available"}).json()["total"] == 21
    assert client.get("/workers", params={"project": "RAK-03"}).json()["total"] == 19
    soon = client.get("/workers", params={"expiring_within": 30, "limit": 200}).json()
    assert soon["total"] >= 9 and all(w["next_document"]["days_left"] <= 30 for w in soon["items"])
    names = [
        w["name"]
        for w in client.get("/workers", params={"dir": "desc", "limit": 5}).json()["items"]
    ]
    assert names == sorted(names, reverse=True)
    assert client.get("/workers", params={"sort": "salary"}).status_code == 422
    assert client.get("/workers", params={"limit": 5000}).status_code == 422


def test_hostile_search_text_is_treated_as_plain_text(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_MANAGER)
    for attack in ("'; DROP TABLE x;--", "%' OR '1'='1", "\\"):
        response = client.get("/workers", params={"q": attack, "trade": attack, "project": attack})
        assert response.status_code == 200 and response.json()["total"] == 0
    with migrated_db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM employees")).scalar_one() == 150


def test_a_project_manager_only_sees_workers_on_their_projects(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "pm@constructiq.test", "project_manager", projects=("RAK-03",))
    sign_in(client, "pm@constructiq.test")
    page = client.get("/workers", params={"limit": 200}).json()
    assert page["total"] == 19 and {w["project"] for w in page["items"]} == {"RAK-03"}
    # A worker on another project, or on none, does not exist as far as this user can tell.
    assert client.get("/workers/EMP-0088").status_code == 404
    assert client.get("/workers/EMP-0142").status_code == 404
    assert client.get("/summary").json()["workforce"]["total"] == 19
    assert [p["code"] for p in client.get("/projects").json()] == ["RAK-03"]


def test_a_project_manager_with_no_projects_sees_nobody(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "pm2@constructiq.test", "project_manager")
    sign_in(client, "pm2@constructiq.test")
    assert client.get("/workers").json()["total"] == 0
    assert client.get("/projects").json() == []


def test_an_employee_sees_only_themselves_and_has_no_project_access(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "anil@constructiq.test", "employee", employee_code="EMP-0142")
    sign_in(client, "anil@constructiq.test")
    page = client.get("/workers").json()
    assert page["total"] == 1 and page["items"][0]["code"] == "EMP-0142"
    assert client.get("/workers/EMP-0107").status_code == 404
    assert client.get("/projects").status_code == 403  # no project:read for this role
    own = client.get("/workers/EMP-0142").json()
    assert all((d["number"] or "").startswith("••••") for d in own["documents"])
    assert all(d["can_reveal"] for d in own["documents"])  # may reveal their own numbers...
    assert client.post("/workers/EMP-0142/documents/residency_visa/reveal").status_code == 200
    assert client.post("/workers/EMP-0107/documents/residency_visa/reveal").status_code == 404


def test_a_role_without_the_permission_is_forbidden_not_hidden(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "nobody@constructiq.test", "service_n8n")
    sign_in(client, "nobody@constructiq.test")
    assert client.get("/workers").status_code == 403
    assert client.get("/projects").status_code == 403


def test_logistics_gets_only_name_code_trade_and_phone(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "logistics@constructiq.test", "logistics_coordinator")
    sign_in(client, "logistics@constructiq.test")
    page = client.get("/workers", params={"limit": 3}).json()
    assert page["total"] == 150
    for worker in page["items"]:
        assert worker["name"] and worker["code"] and worker["trade"] and worker["phone"]
        assert worker["level"] is None and worker["status"] is None
        assert worker["project"] is None and worker["next_document"] is None
    detail = client.get("/workers/EMP-0088").json()
    assert detail["documents"] == [] and detail["assignments"] == []
    assert client.get("/documents/expiring").status_code == 403
    assert client.get("/summary").json()["documents"] == {
        "expired": 0,
        "d30": 0,
        "d60": 0,
        "d90": 0,
    }


def test_personal_data_is_never_cached(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    response = client.get("/workers")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


# --------------------------------------------------------------------------- masking


def _profile(client: TestClient, code: str = "EMP-0088") -> dict[str, Any]:
    return client.get(f"/workers/{code}").json()


def test_profile_numbers_are_masked_for_everyone_and_only_revealed_on_request(
    make_client: Callable[..., TestClient], migrated_db: Engine
) -> None:
    manager, executive, ceo = make_client(), make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(executive, HR_EXECUTIVE)
    sign_in(ceo, CEO)
    for who in (manager, ceo, executive):
        numbers = [d["number"] for d in _profile(who)["documents"]]
        assert all(n and n.startswith("•••• ") and len(n) == 9 for n in numbers)
    assert all(d["can_reveal"] for d in _profile(manager)["documents"])
    assert not any(d["can_reveal"] for d in _profile(executive)["documents"])

    revealed = manager.post("/workers/EMP-0088/documents/residency_visa/reveal")
    assert revealed.status_code == 200
    assert re.fullmatch(r"784-198\d-\d{7}-\d", revealed.json()["number"])
    assert revealed.headers["cache-control"] == "no-store"
    assert executive.post("/workers/EMP-0088/documents/residency_visa/reveal").status_code == 403
    assert manager.post("/workers/EMP-9999/documents/residency_visa/reveal").status_code == 404
    assert manager.post("/workers/EMP-0088/documents/nonsense/reveal").status_code == 404
    with migrated_db.connect() as c:
        rows = c.execute(
            text(
                "SELECT role_codes, entity_type FROM audit_log "
                "WHERE action = 'document.number_revealed'"
            )
        ).all()
    assert len(rows) == 1 and rows[0][1] == "employee_document"  # only the allowed one is logged


def test_facets_count_the_directory_for_the_filter_chips(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    facets = client.get("/workers/facets").json()
    by_status = {f["value"]: f["count"] for f in facets["statuses"]}
    assert by_status == {"deployed": 112, "available": 21, "mobilizing": 9, "unavailable": 8}
    assert sum(f["count"] for f in facets["trades"]) == 150
    assert {f["value"] for f in facets["projects"]} >= {"RAK-01", "RAK-03"}
    assert facets["documents"]["expired"] == 2


def test_facets_for_a_narrow_projection_reveal_no_status_or_project(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "logistics@constructiq.test", "logistics_coordinator")
    sign_in(client, "logistics@constructiq.test")
    facets = client.get("/workers/facets").json()
    assert sum(f["count"] for f in facets["trades"]) == 150
    assert facets["statuses"] == [] and facets["projects"] == []
    assert facets["documents"] == {"expired": 0, "expiring_30": 0}


def test_the_profile_names_documents_that_end_before_the_job_does(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    risks = _profile(client)["risks"]  # EMP-0088: residency visa ends 12 Nov 2026, on RAK-01
    visa = [r for r in risks if r["document_type"] == "residency_visa"]
    assert visa and visa[0]["kind"] == "ends_before_assignment"
    assert "RAK-01" in visa[0]["message"] and "12 Nov 2026" in visa[0]["message"]
    expired = client.get("/documents/expiring", params={"window": "expired"}).json()["items"][0]
    kinds = [r["kind"] for r in _profile(client, expired["worker_code"])["risks"]]
    assert "expired" in kinds


def _code_where(engine: Engine, condition: str) -> str:
    with engine.connect() as c:
        sql = f"SELECT employee_code FROM employees WHERE {condition}"  # noqa: S608
        return str(c.execute(text(sql)).scalar_one())


def test_contracts_and_exits_show_up_as_risks_in_the_profile(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_MANAGER)
    ends = _profile(client, _code_where(migrated_db, "contract_end_on = '2026-12-31'"))
    assert ends["contract_end_on"] == "2026-12-31"
    contract = [r for r in ends["risks"] if r["kind"] == "contract_ends"]
    assert (
        contract and contract[0]["severity"] == "warning" and contract[0]["document_type"] is None
    )
    assert contract[0]["message"] == (
        "Contract ends 31 Dec 2026, before the job on RAK-01 ends (31 Aug 2027)."
    )

    resigned = _profile(client, "EMP-0125")  # Suresh Nair
    assert (resigned["exit_on"], resigned["exit_reason"]) == ("2027-01-31", "resigned")
    leaving = [r for r in resigned["risks"] if r["kind"] == "leaving"]
    assert leaving[0]["message"] == "Leaving the company on 31 Jan 2027 (resigned)."

    gone = _profile(client, _code_where(migrated_db, "employment_status = 'absconded'"))
    assert gone["employment_status"] == "absconded"
    assert [r["message"] for r in gone["risks"] if r["kind"] == "absconded"] == [
        "Left without notice on 30 Oct 2026."
    ]


def test_a_planned_transfer_says_where_the_person_is_moving_from(
    client: TestClient, migrated_db: Engine
) -> None:
    with migrated_db.begin() as c:
        # Finish the current job on 31 Jan, then plan the move. The database refuses overlaps.
        c.execute(
            text(
                """UPDATE employee_assignments
                   SET period = daterange(lower(period), '2027-02-01', '[)')
                   WHERE employee_id = (SELECT id FROM employees WHERE employee_code = 'EMP-0088')
                     AND status = 'active'"""
            )
        )
        c.execute(
            text(
                """INSERT INTO employee_assignments
                       (employee_id, project_id, period, status, depends_on_assignment_id)
                   SELECT e.id, p.id, daterange('2027-02-12', NULL, '[)'), 'planned', a.id
                   FROM employees e
                   JOIN employee_assignments a ON a.employee_id = e.id AND a.status = 'active'
                   JOIN projects p ON p.code = 'RAK-07'
                   WHERE e.employee_code = 'EMP-0088'"""
            )
        )
    sign_in(client, HR_MANAGER)
    moves = [a for a in _profile(client)["assignments"] if a["project_code"] == "RAK-07"]
    assert moves[0]["status"] == "planned" and moves[0]["moving_from"] == "RAK-01"
    assert moves[0]["moving_from_ends"] == "2027-01-31"


def test_the_directory_can_be_exported_without_numbers_and_is_audited(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_MANAGER)
    response = client.get("/workers/export.csv", params={"status": "available"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    body = response.content.decode("utf-8-sig")  # Excel needs the BOM; here we read past it
    lines = body.strip().splitlines()
    assert lines[0] == "Code,Name,Trade,Level,Status,Project,Phone,Next document,Expires"
    assert len(lines) == 1 + 21
    assert "784-" not in body
    with migrated_db.connect() as c:
        assert (
            c.execute(
                text("SELECT count(*) FROM audit_log WHERE action = 'workers.exported'")
            ).scalar_one()
            == 1
        )


def test_a_spreadsheet_formula_in_a_cell_is_defused() -> None:
    assert csv_cell("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert csv_cell("+1") == "'+1" and csv_cell("@x") == "'@x" and csv_cell("-2") == "'-2"
    assert csv_cell("Mason") == "Mason" and csv_cell(None) == ""


# --------------------------------------------------------------------------- documents and projects


def test_documents_running_out_match_the_dashboards_for_hr(client: TestClient) -> None:
    sign_in(client, HR_EXECUTIVE)
    body = client.get("/documents/expiring", params={"window": "d30"}).json()
    assert body["counts"] == {"expired": 2, "d30": 8, "d60": 11, "d90": 17}
    assert len(body["items"]) == 8
    assert [i["days_left"] for i in body["items"]] == sorted(i["days_left"] for i in body["items"])
    assert body["items"][1]["worker_code"] == "EMP-0088" and body["items"][1]["days_left"] == 7
    for window, expected in (("expired", 2), ("d60", 11), ("d90", 17)):
        assert (
            len(client.get("/documents/expiring", params={"window": window}).json()["items"])
            == expected
        )
    filtered = client.get("/documents/expiring", params={"window": "d30", "q": "sanjeev"}).json()
    assert [i["worker_code"] for i in filtered["items"]] == ["EMP-0088"]
    assert "number" not in body["items"][0]  # the list never carries document numbers


def test_projects_and_the_summary_match_the_ceo_dashboard(client: TestClient) -> None:
    sign_in(client, CEO)
    summary = client.get("/summary").json()
    assert summary["today"] == SEED_TODAY.isoformat()
    assert summary["workforce"] == {
        "total": 150, "deployed": 112, "mobilizing": 9, "available": 21, "unavailable": 8,
    }  # fmt: skip
    assert summary["documents"] == {"expired": 2, "d30": 8, "d60": 11, "d90": 17}
    projects = {p["code"]: p for p in summary["projects"]}
    assert len(projects) == 7
    assert (projects["RAK-03"]["planned"], projects["RAK-03"]["deployed"]) == (26, 18)
    assert (projects["RAK-01"]["planned"], projects["RAK-01"]["deployed"]) == (30, 27)
    assert projects["RAK-07"]["status"] == "planning" and projects["RAK-07"]["deployed"] == 0
    assert client.get("/projects").json() == summary["projects"]


def test_the_real_clock_is_used_when_the_simulated_one_is_off(
    make_client: Callable[..., TestClient],
) -> None:
    client = make_client(simulated_clock=False)
    sign_in(client, HR_MANAGER)
    assert client.get("/summary").json()["today"] == date.today().isoformat()


def test_the_sign_in_page_can_ask_whether_demo_accounts_are_on(
    make_client: Callable[..., TestClient],
) -> None:
    assert make_client().get("/auth/config").json() == {"demo_mode": True}
    assert make_client(demo_mode=False).get("/auth/config").json() == {"demo_mode": False}


def test_a_locked_out_email_is_told_how_long_to_wait(client: TestClient) -> None:
    for _ in range(5):
        client.post("/auth/login", json={"email": HR_EXECUTIVE, "password": "wrong"})
    blocked = client.post("/auth/login", json={"email": HR_EXECUTIVE, "password": PASSWORD})
    assert blocked.status_code == 429
    assert 800 <= int(blocked.headers["retry-after"]) <= 901  # about 15 minutes


def test_the_summary_has_a_90_day_weekly_series_and_the_shortfall(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    summary = client.get("/summary").json()
    weeks = summary["expiry_by_week"]
    assert len(weeks) == 13 and weeks[0]["week_start"] == SEED_TODAY.isoformat()
    assert weeks[1]["week_start"] == "2026-11-12"
    assert sum(w["count"] for w in weeks) == 36  # 8 + 11 + 17 running out within 90 days
    assert (
        summary["short_total"] == 3 + 0 + 8 + 0 + 1 + 6
    )  # planned minus deployed, active projects


def test_the_shortfall_is_zero_for_a_narrow_projection(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "logistics2@constructiq.test", "logistics_coordinator")
    sign_in(client, "logistics2@constructiq.test")
    weeks = client.get("/summary").json()["expiry_by_week"]
    assert all(w["count"] == 0 for w in weeks)
