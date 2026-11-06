"""Loads the demo data into Postgres. Runs as the database owner (see Settings.migration_url).

`reset_demo` removes only what this module creates, so the reference data that comes with the
schema (roles, permissions, role mapping, work rules, agents) is never touched.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from argon2 import PasswordHasher
from sqlalchemy import Connection, text

from app.config import ConfigError, Settings
from app.seed.data import DOC_TYPE_CODE, PROJECTS, SEED_TODAY
from app.seed.workers import WorkerSeed, build_workers

_NAMESPACE = uuid.UUID("6d1f3c0a-5b7e-4d0e-9a52-0c1f7a6b9e11")  # fixed, so ids repeat on reseed


def demo_id(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, f"{kind}:{key}")


DEMO_USERS = (
    ("hr_manager", "Noura Demo", "noura.demo@constructiq.test"),
    ("hr_executive", "Priya Demo", "priya.demo@constructiq.test"),
    ("ceo", "Layla Demo", "layla.demo@constructiq.test"),
)

DEPARTMENTS = (("hr", "Human Resources"), ("operations", "Operations"), ("site", "Site workforce"))

# Everything below is deleted by reset_demo, children before parents.
_RESET_ORDER = (
    "audit_log",
    "employee_assignments",
    "employee_documents",
    "employee_skills",
    "leave_records",
    "user_project_access",
    "project_sites",
    "manpower_requirements",
    "projects",
    "clients",
    "user_roles",
    "users",
    "employees",
    "trades",
    "departments",
)


def require_not_production(settings: Settings) -> None:
    if settings.is_production:
        raise ConfigError("Demo data is never loaded with APP_ENV=production")


def reset_demo(connection: Connection, settings: Settings) -> None:
    require_not_production(settings)
    connection.execute(text("UPDATE work_rules SET updated_by = NULL"))
    for table in _RESET_ORDER:
        connection.execute(text(f"DELETE FROM {table}"))  # noqa: S608 - fixed list above


def _trade_code(name: str) -> str:
    return name.lower().replace(" ", "_")


def _insert(connection: Connection, sql: str, rows: list[dict[str, Any]]) -> None:
    if rows:
        connection.execute(text(sql), rows)


def seed_demo(connection: Connection, settings: Settings) -> dict[str, int]:
    """Insert the demo data. Call reset_demo first when the database already has some."""
    require_not_production(settings)
    if not settings.demo_password:
        raise ConfigError("DEMO_PASSWORD is not set. Run `make env`, or add it to .env.")
    workers = build_workers()

    departments = {code: demo_id("department", code) for code, _ in DEPARTMENTS}
    _insert(
        connection,
        "INSERT INTO departments (id, code, name) VALUES (:id, :code, :name)",
        [{"id": departments[c], "code": c, "name": n} for c, n in DEPARTMENTS],
    )

    trade_names = sorted({w.trade for w in workers})
    trades = {name: demo_id("trade", name) for name in trade_names}
    _insert(
        connection,
        "INSERT INTO trades (id, code, name) VALUES (:id, :code, :name)",
        [{"id": trades[n], "code": _trade_code(n), "name": n} for n in trade_names],
    )

    projects = {p.code: demo_id("project", p.code) for p in PROJECTS}
    _insert(
        connection,
        """INSERT INTO projects (id, code, name, status, starts_on, ends_on, is_demo)
           VALUES (:id, :code, :name, :status, :starts, :ends, true)""",
        [
            {"id": projects[p.code], "code": p.code, "name": p.name, "status": p.status,
             "starts": p.starts, "ends": p.ends}
            for p in PROJECTS
        ],
    )  # fmt: skip
    _insert(
        connection,
        """INSERT INTO project_sites
               (id, project_id, name, outdoor, default_shift_start, default_shift_end)
           VALUES (:id, :project_id, :name, :outdoor, '06:00', '12:30')""",
        [
            {"id": demo_id("site", f"{p.code}:{n}"), "project_id": projects[p.code],
             "name": f"Site {n}", "outdoor": p.outdoor}
            for p in PROJECTS
            for n in range(1, p.sites + 1)
        ],
    )  # fmt: skip

    hasher = PasswordHasher()
    password_hash = hasher.hash(settings.demo_password)
    users = {code: demo_id("user", code) for code, _, _ in DEMO_USERS}
    _insert(
        connection,
        """INSERT INTO users (id, email, full_name, password_hash, is_demo)
           VALUES (:id, :email, :name, :hash, true)""",
        [{"id": users[c], "email": e, "name": n, "hash": password_hash} for c, n, e in DEMO_USERS],
    )
    connection.execute(
        text(
            """INSERT INTO user_roles (user_id, role_id)
               SELECT :user_id, id FROM roles WHERE code = :role"""
        ),
        [{"user_id": users[c], "role": c} for c, _, _ in DEMO_USERS],
    )

    _load_workers(connection, workers, departments["site"], trades, projects)
    return {
        "workers": len(workers),
        "documents": sum(len(w.docs) for w in workers),
        "projects": len(PROJECTS),
        "users": len(DEMO_USERS),
    }


def _load_workers(
    connection: Connection,
    workers: list[WorkerSeed],
    department_id: uuid.UUID,
    trades: dict[str, uuid.UUID],
    projects: dict[str, uuid.UUID],
) -> None:
    ids = {w.code: demo_id("employee", w.code) for w in workers}
    _insert(
        connection,
        """INSERT INTO employees
               (id, employee_code, full_name, phone, whatsapp_number, department_id,
                primary_trade_id, employment_status, availability, joined_on, is_demo)
           VALUES (:id, :code, :name, :phone, :phone, :department_id, :trade_id,
                   CAST(:employment AS employment_status),
                   CAST(:availability AS availability_state),
                   :joined, true)""",
        [
            {
                "id": ids[w.code], "code": w.code, "name": w.name, "phone": w.phone,
                "department_id": department_id, "trade_id": trades[w.trade],
                "employment": "on_leave" if w.reason == "On leave" else "active",
                "availability": w.status,
                "joined": SEED_TODAY - timedelta(days=300 + (i * 29) % 1200),
            }
            for i, w in enumerate(workers)
        ],
    )  # fmt: skip
    _insert(
        connection,
        """INSERT INTO employee_skills (employee_id, trade_id, level, verified)
           VALUES (:employee_id, :trade_id, :level, true)""",
        [
            {"employee_id": ids[w.code], "trade_id": trades[w.trade], "level": w.level}
            for w in workers
        ],
    )
    _insert(
        connection,
        """INSERT INTO employee_documents
               (id, employee_id, doc_type, doc_number, expiry_date, status, is_current, is_demo)
           VALUES (:id, :employee_id, CAST(:doc_type AS document_type), :number, :expiry,
                   CAST(:status AS document_status), true, true)""",
        [
            {
                "id": demo_id("document", f"{w.code}:{d.type}"), "employee_id": ids[w.code],
                "doc_type": DOC_TYPE_CODE[d.type], "number": d.number, "expiry": d.until,
                "status": "expired" if d.until < SEED_TODAY else "verified",
            }
            for w in workers
            for d in w.docs
        ],
    )  # fmt: skip
    _insert(
        connection,
        """INSERT INTO employee_assignments (id, employee_id, project_id, period, status, is_demo)
           VALUES (:id, :employee_id, :project_id, daterange(:starts, NULL, '[)'),
                   CAST(:status AS assignment_status), true)""",
        [
            {
                "id": demo_id("assignment", w.code), "employee_id": ids[w.code],
                "project_id": projects[w.project],
                "starts": SEED_TODAY + timedelta(days=3)
                if w.status == "mobilizing"
                else SEED_TODAY - timedelta(days=40 + int(w.code[-3:]) % 220),
                "status": "planned" if w.status == "mobilizing" else "active",
            }
            for w in workers
            if w.project and w.status in ("deployed", "mobilizing")
        ],
    )  # fmt: skip
