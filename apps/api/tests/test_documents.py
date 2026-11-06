"""Documents by expiry window: filters, honest tab counts, the job they hurt, and the export."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in


def expiring(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/documents/expiring", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_tab_counts_and_rows_match_the_dashboard(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    body = expiring(client, window="d30")
    assert body["counts"] == {"expired": 2, "d30": 8, "d60": 11, "d90": 17}
    assert len(body["items"]) == 8
    assert [i["days_left"] for i in body["items"]] == sorted(i["days_left"] for i in body["items"])
    assert len(expiring(client, window="expired")["items"]) == 2


def test_the_tab_counts_follow_the_filters_so_a_tab_never_promises_hidden_rows(
    client: TestClient,
) -> None:
    sign_in(client, HR_MANAGER)
    sanjeev = expiring(client, window="d30", q="Sanjeev")
    assert [i["worker_name"] for i in sanjeev["items"]] == ["Sanjeev Rana"]
    assert sanjeev["counts"] == {"expired": 0, "d30": 1, "d60": 0, "d90": 0}
    for window in ("expired", "d30", "d60", "d90"):
        body = expiring(client, window=window, type="residency_visa")
        assert len(body["items"]) == body["counts"][window]
        assert all(i["type"] == "residency_visa" for i in body["items"])


def test_filtering_by_project_and_by_a_type_nobody_holds(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    rak01 = expiring(client, window="d30", project="RAK-01")  # the tabs are separate buckets
    assert rak01["items"] and all(i["project"] == "RAK-01" for i in rak01["items"])
    assert expiring(client, window="d90", project="NOPE-9")["items"] == []
    assert expiring(client, window="d90", type="passport")["items"] == []
    # an unknown type is ignored, never put into SQL
    assert len(expiring(client, window="d30", type="x'; DROP TABLE users;--")["items"]) == 8


def test_a_document_that_ends_before_the_job_says_so(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    rows = {i["worker_code"]: i for i in expiring(client, window="d30")["items"]}
    sanjeev = rows["EMP-0088"]  # visa ends 12 Nov; he is on RAK-01 until 31 Aug 2027
    assert sanjeev["project"] == "RAK-01" and sanjeev["job_ends"] == "2027-08-31"
    assert sanjeev["ends_before_job"] is True
    free = [i for i in expiring(client, window="d90")["items"] if i["project"] is None]
    assert free and all(i["job_ends"] is None and i["ends_before_job"] is False for i in free)


def test_a_document_that_outlasts_the_job_is_not_flagged(
    client: TestClient, migrated_db: Engine
) -> None:
    with migrated_db.begin() as c:
        c.execute(
            text(
                """UPDATE employee_assignments
                   SET period = daterange(lower(period), '2026-11-10', '[)')
                   WHERE employee_id = (SELECT id FROM employees
                                        WHERE employee_code = 'EMP-0088')"""
            )
        )
    sign_in(client, HR_MANAGER)
    row = next(i for i in expiring(client, window="d30")["items"] if i["worker_code"] == "EMP-0088")
    assert row["job_ends"] == "2026-11-09"  # the job ends 9 Nov; the visa runs to 12 Nov
    assert row["ends_before_job"] is False


def test_the_export_follows_the_filters_has_no_numbers_and_is_audited(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_MANAGER)
    response = client.get(
        "/documents/export.csv", params={"window": "d30", "type": "residency_visa"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "documents-d30.csv" in response.headers["content-disposition"]
    lines = response.content.decode("utf-8-sig").strip().splitlines()
    assert lines[0] == (
        "Code,Name,Trade,Project,Phone,Document,Expires,Days left,Job ends,Ends before the job"
    )
    assert len(lines) == 1 + len(expiring(client, window="d30", type="residency_visa")["items"])
    assert "784-" not in response.text  # no Emirates ID number, ever
    sanjeev = next(line for line in lines if line.startswith("EMP-0088"))
    assert "Residency visa" in sanjeev and sanjeev.endswith("2027-08-31,Yes")
    with migrated_db.connect() as c:
        audited = c.execute(
            text("SELECT count(*) FROM audit_log WHERE action = 'documents.exported'")
        ).scalar_one()
    assert audited == 1


def test_everyone_with_document_access_can_read_and_nobody_else(
    make_client: Any, migrated_db: Engine
) -> None:
    executive, ceo, logistics, anonymous = (
        make_client(),
        make_client(),
        make_client(),
        make_client(),
    )
    sign_in(executive, HR_EXECUTIVE)
    sign_in(ceo, CEO)
    add_user(migrated_db, "logistics@constructiq.test", "logistics_coordinator")
    sign_in(logistics, "logistics@constructiq.test")
    assert executive.get("/documents/expiring").status_code == 200
    assert ceo.get("/documents/expiring").status_code == 200
    assert logistics.get("/documents/expiring").status_code == 403
    assert logistics.get("/documents/export.csv").status_code == 403
    assert anonymous.get("/documents/export.csv").status_code == 401


def test_a_project_manager_only_sees_documents_of_their_own_people(
    client: TestClient, migrated_db: Engine
) -> None:
    add_user(migrated_db, "pm@constructiq.test", "project_manager", projects=("RAK-03",))
    sign_in(client, "pm@constructiq.test")
    body = expiring(client, window="d90")
    assert body["items"] and {i["project"] for i in body["items"]} == {"RAK-03"}
    assert sum(body["counts"].values()) < 38
