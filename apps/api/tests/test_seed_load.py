"""Loading the demo data into a real database gives the numbers on the prototype's screens."""

from __future__ import annotations

import pytest
from sqlalchemy import Engine, text

from app.config import AppEnv, ConfigError, Settings
from app.seed.data import SEED_TODAY
from app.seed.load import reset_demo, seed_demo

DEMO = Settings(app_env=AppEnv.TEST, demo_password="a-demo-password-for-tests")  # noqa: S106


def _scalar(engine: Engine, sql: str, **params: object) -> int:
    with engine.connect() as connection:
        return int(connection.execute(text(sql), params).scalar_one())


def _load(engine: Engine) -> None:
    with engine.begin() as connection:
        reset_demo(connection, DEMO)
        seed_demo(connection, DEMO)


def test_demo_data_matches_the_dashboards(migrated_db: Engine) -> None:
    _load(migrated_db)
    assert _scalar(migrated_db, "SELECT count(*) FROM employees WHERE is_demo") == 150
    with migrated_db.connect() as connection:
        by_state = {
            row[0]: row[1]
            for row in connection.execute(
                text("SELECT availability::text, count(*) FROM employees GROUP BY 1")
            )
        }
        deployed = {
            row[0]: row[1]
            for row in connection.execute(
                text(
                    """SELECT p.code, count(*) FROM employee_assignments a
                       JOIN projects p ON p.id = a.project_id
                       JOIN employees e ON e.id = a.employee_id
                       WHERE a.status = 'active' AND e.availability = 'deployed' GROUP BY 1"""
                )
            )
        }
    assert by_state == {"deployed": 112, "mobilizing": 9, "available": 21, "unavailable": 8}
    assert deployed == {
        "RAK-01": 27, "RAK-02": 24, "RAK-03": 18, "RAK-04": 12, "RAK-05": 15, "RAK-06": 16,
    }  # fmt: skip


def test_documents_running_out_match_the_dashboards(migrated_db: Engine) -> None:
    _load(migrated_db)

    def count(low: int, high: int) -> int:
        return _scalar(
            migrated_db,
            """SELECT count(*) FROM employee_documents
               WHERE is_current AND expiry_date - :today BETWEEN :low AND :high""",
            today=SEED_TODAY,
            low=low,
            high=high,
        )

    expired = _scalar(
        migrated_db,
        "SELECT count(*) FROM employee_documents WHERE expiry_date < :today",
        today=SEED_TODAY,
    )
    assert expired == 2
    assert count(0, 30) == 8
    assert count(31, 60) == 11
    assert count(61, 90) == 17


def test_the_three_demo_users_have_their_roles_and_hashed_passwords(migrated_db: Engine) -> None:
    _load(migrated_db)
    with migrated_db.connect() as connection:
        rows = connection.execute(
            text(
                """SELECT u.email, r.code, u.password_hash FROM users u
                   JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
                   WHERE u.is_demo ORDER BY 2"""
            )
        ).all()
    assert [(e, r) for e, r, _ in rows] == [
        ("layla.demo@constructiq.test", "ceo"),
        ("priya.demo@constructiq.test", "hr_executive"),
        ("noura.demo@constructiq.test", "hr_manager"),
    ]
    assert all(h.startswith("$argon2") for _, _, h in rows)
    assert all("a-demo-password" not in h for _, _, h in rows)


def test_reset_removes_demo_data_but_keeps_the_reference_data(migrated_db: Engine) -> None:
    before = _scalar(migrated_db, "SELECT count(*) FROM role_permissions")
    _load(migrated_db)
    with migrated_db.begin() as connection:
        reset_demo(connection, DEMO)
    assert _scalar(migrated_db, "SELECT count(*) FROM employees") == 0
    assert _scalar(migrated_db, "SELECT count(*) FROM users") == 0
    assert _scalar(migrated_db, "SELECT count(*) FROM role_permissions") == before
    assert _scalar(migrated_db, "SELECT count(*) FROM work_rules") == 1


def test_reset_also_clears_mobilizations_started_by_approving_a_request(
    migrated_db: Engine,
) -> None:
    """`make reset-demo` must work after the demo: approving starts mobilizations on assignments."""
    _load(migrated_db)
    with migrated_db.begin() as connection:
        assignment = connection.execute(
            text("SELECT id FROM employee_assignments LIMIT 1")
        ).scalar_one()
        mobilization = connection.execute(
            text(
                """INSERT INTO mobilizations (mob_no, assignment_id, report_on)
                   VALUES ('MOB-2026-9999', :assignment, '2026-11-08') RETURNING id"""
            ),
            {"assignment": assignment},
        ).scalar_one()
        connection.execute(
            text(
                """INSERT INTO mobilization_tasks (mobilization_id, department_id, title)
                   SELECT :mobilization, id, 'Verify visa' FROM departments LIMIT 1"""
            ),
            {"mobilization": mobilization},
        )
    _load(migrated_db)
    assert (
        _scalar(migrated_db, "SELECT count(*) FROM mobilizations WHERE mob_no = 'MOB-2026-9999'")
        == 0
    )
    assert (
        _scalar(migrated_db, "SELECT count(*) FROM mobilization_tasks WHERE title = 'Verify visa'")
        == 0
    )
    assert _scalar(migrated_db, "SELECT count(*) FROM employees") == 150


def test_seeding_twice_gives_the_same_database(migrated_db: Engine) -> None:
    _load(migrated_db)
    first = _scalar(migrated_db, "SELECT count(*) FROM employee_documents")
    _load(migrated_db)
    assert _scalar(migrated_db, "SELECT count(*) FROM employees") == 150
    assert _scalar(migrated_db, "SELECT count(*) FROM employee_documents") == first == 450


def test_seed_and_reset_refuse_to_run_in_production(migrated_db: Engine) -> None:
    production = Settings(app_env=AppEnv.PRODUCTION, demo_password="x")  # noqa: S106
    with migrated_db.begin() as connection, pytest.raises(ConfigError):
        reset_demo(connection, production)
    with migrated_db.begin() as connection, pytest.raises(ConfigError):
        seed_demo(connection, production)


def test_seed_needs_a_demo_password(migrated_db: Engine) -> None:
    with migrated_db.begin() as connection, pytest.raises(ConfigError, match="DEMO_PASSWORD"):
        seed_demo(connection, Settings(app_env=AppEnv.TEST, demo_password=""))
