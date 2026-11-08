"""HR edits a worker: only what is sent changes, every field is checked, every change is audited."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, sign_in

CODE = "EMP-0142"


@pytest.fixture
def desk(make_client: Callable[..., TestClient]) -> tuple[TestClient, TestClient, TestClient]:
    manager, executive, ceo = make_client(), make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(executive, HR_EXECUTIVE)
    sign_in(ceo, CEO)
    return manager, executive, ceo


def one(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as c:
        return c.execute(text(sql), params).scalar_one()


def test_hr_changes_only_what_is_sent_and_it_is_audited(
    desk: tuple[TestClient, TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _, _ = desk
    before = manager.get(f"/workers/{CODE}").json()
    sent = {"designation": "Lead steel fixer", "phone": "+971 50 123 4567", "level": 5}
    response = manager.patch(f"/workers/{CODE}", json=sent)
    assert response.status_code == 200, response.text
    after = response.json()
    assert (
        after["level"] == 5
        and after["name"] == before["name"]
        and after["trade"] == before["trade"]
    )
    assert one(
        migrated_db, "SELECT designation FROM employees WHERE employee_code = :c", c=CODE
    ) == ("Lead steel fixer")
    audit = one(
        migrated_db,
        """SELECT after_json::text FROM audit_log WHERE action = 'employee.edited'
           ORDER BY id DESC LIMIT 1""",
    )
    assert "Lead steel fixer" in audit and "level" in audit


def test_a_trade_change_keeps_a_skill_row_for_the_new_trade(
    desk: tuple[TestClient, TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _, _ = desk
    response = manager.patch(f"/workers/{CODE}", json={"trade": "mason", "level": 2})
    assert response.status_code == 200, response.text
    assert response.json()["trade"] == "Mason" and response.json()["level"] == 2


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({}, "Nothing to change"),
        ({"phone": "call me"}, "phone number"),
        ({"full_name": None}, "cannot be empty"),
        ({"trade": "astronaut"}, "no trade called astronaut"),
        ({"level": 9}, "less than or equal to 5"),
        ({"exit_on": None, "exit_reason": "resigned"}, "needs a leaving date"),
    ],
)
def test_bad_edits_are_refused_with_a_reason(
    desk: tuple[TestClient, TestClient, TestClient], body: dict[str, Any], message: str
) -> None:
    response = desk[0].patch(f"/workers/{CODE}", json=body)
    assert response.status_code == 422
    assert message in response.text


def test_dates_cannot_come_before_the_day_they_joined(
    desk: tuple[TestClient, TestClient, TestClient], migrated_db: Engine
) -> None:
    with migrated_db.begin() as c:
        c.execute(
            text("UPDATE employees SET joined_on = '2026-01-10' WHERE employee_code = :c"),
            {"c": CODE},
        )
    manager, _, _ = desk
    bad = manager.patch(f"/workers/{CODE}", json={"contract_end_on": "2025-12-31"})
    assert bad.status_code == 422 and "10 Jan 2026" in bad.text
    ok = manager.patch(f"/workers/{CODE}", json={"contract_end_on": "2027-06-30"})
    assert ok.status_code == 200 and ok.json()["contract_end_on"] == "2027-06-30"
    cleared = manager.patch(f"/workers/{CODE}", json={"contract_end_on": None})
    assert cleared.json()["contract_end_on"] is None


def test_a_leaving_date_and_reason_go_in_together_and_come_out_together(
    desk: tuple[TestClient, TestClient, TestClient],
) -> None:
    manager, _, _ = desk
    done = manager.patch(
        f"/workers/{CODE}", json={"exit_on": "2027-03-01", "exit_reason": "resigned"}
    )
    assert done.status_code == 200
    assert (done.json()["exit_on"], done.json()["exit_reason"]) == ("2027-03-01", "resigned")
    gone = manager.patch(f"/workers/{CODE}", json={"exit_on": None})
    assert (gone.json()["exit_on"], gone.json()["exit_reason"]) == (None, None)


def test_the_executive_may_edit_and_the_md_may_not(
    desk: tuple[TestClient, TestClient, TestClient], migrated_db: Engine
) -> None:
    _, executive, ceo = desk
    assert executive.patch(f"/workers/{CODE}", json={"designation": "Foreman"}).status_code == 200
    assert ceo.patch(f"/workers/{CODE}", json={"designation": "Boss"}).status_code == 403
    assert (
        one(migrated_db, "SELECT designation FROM employees WHERE employee_code = :c", c=CODE)
        == "Foreman"
    )
    assert (
        ceo.patch(
            f"/workers/{CODE}/documents/residency_visa", json={"expiry_date": "2030-01-01"}
        ).status_code
        == 403
    )


def test_an_unknown_worker_is_not_found(desk: tuple[TestClient, TestClient, TestClient]) -> None:
    assert desk[0].patch("/workers/EMP-9999", json={"designation": "x"}).status_code == 404


def test_a_document_expiry_can_be_corrected_and_is_audited(
    desk: tuple[TestClient, TestClient, TestClient], migrated_db: Engine
) -> None:
    manager, _, _ = desk
    response = manager.patch(
        f"/workers/{CODE}/documents/residency_visa", json={"expiry_date": "2028-02-01"}
    )
    assert response.status_code == 200, response.text
    visa = next(d for d in response.json()["documents"] if d["type"] == "residency_visa")
    assert visa["expiry"] == "2028-02-01"
    assert "2028-02-01" in one(
        migrated_db,
        """SELECT after_json::text FROM audit_log WHERE action = 'document.expiry_edited'
           ORDER BY id DESC LIMIT 1""",
    )
    assert (
        manager.patch(
            f"/workers/{CODE}/documents/library_card", json={"expiry_date": "2028-02-01"}
        ).status_code
        == 404
    )


def test_a_renewed_expired_document_goes_back_to_be_checked(
    desk: tuple[TestClient, TestClient, TestClient], migrated_db: Engine
) -> None:
    with migrated_db.begin() as c:
        c.execute(
            text(
                """UPDATE employee_documents SET status = 'expired', expiry_date = '2026-10-01'
                   WHERE doc_type = 'medical_fitness' AND is_current AND employee_id =
                   (SELECT id FROM employees WHERE employee_code = :c)"""
            ),
            {"c": CODE},
        )
    manager, _, _ = desk
    assert (
        manager.patch(
            f"/workers/{CODE}/documents/medical_fitness", json={"expiry_date": "2027-10-01"}
        ).status_code
        == 200
    )
    assert (
        one(
            migrated_db,
            """SELECT d.status::text FROM employee_documents d
               JOIN employees e ON e.id = d.employee_id
           WHERE e.employee_code = :c AND d.doc_type = 'medical_fitness' AND d.is_current""",
            c=CODE,
        )
        == "pending_check"
    )
