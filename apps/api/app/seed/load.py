"""Loads the demo data into Postgres. Runs as the database owner (see Settings.migration_url).

`reset_demo` removes only what this module creates, so the reference data that comes with the
schema (roles, permissions, role mapping, work rules, agents) is never touched.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from argon2 import PasswordHasher
from sqlalchemy import Connection, text

from app.config import ConfigError, Settings
from app.seed.data import (
    ABSCONDED_ON,
    ALL_TRADES,
    DOC_TYPE_CODE,
    EARLY_ENDS,
    GENERATED_CONTRACT_ENDS,
    GENERATED_EXITS,
    LEAVES,
    NAMED_CONTRACT_ENDS,
    NAMED_EXITS,
    PROJECTS,
    RECRUITMENT,
    SEED_TODAY,
    TRADE_GROUPS,
)
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
    "recruitment_requests",
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


def singular_trade(plural: str) -> str:
    return plural[:-1] if plural.endswith("s") else plural


def _trade_code(name: str) -> str:
    return name.lower().replace(" ", "_")


def _insert(connection: Connection, sql: str, rows: list[dict[str, Any]]) -> None:
    if rows:
        connection.execute(text(sql), rows)


def _pick(workers: list[WorkerSeed], project: str, trade: str, used: set[str]) -> WorkerSeed:
    """The first generated, deployed worker on `project` with `trade` not already used.

    Generated workers only (EMP-0501 up): the named demo workers keep the stories they were given.
    """
    for w in sorted(workers, key=lambda w: w.code):
        if (
            w.status == "deployed"
            and w.project == project
            and w.trade == trade
            and w.code >= "EMP-0501"
            and w.code not in used
        ):
            used.add(w.code)
            return w
    raise ConfigError(f"The seed has no free {trade} on {project}")


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

    trade_names = sorted(ALL_TRADES)
    trades = {name: demo_id("trade", name) for name in trade_names}
    _insert(
        connection,
        "INSERT INTO trades (id, code, name, category) VALUES (:id, :code, :name, :category)",
        [
            {"id": trades[n], "code": _trade_code(n), "name": n, "category": TRADE_GROUPS[n]}
            for n in trade_names
        ],
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

    _insert(
        connection,
        """INSERT INTO manpower_requirements (project_id, trade_id, headcount, period)
           VALUES (:project_id, :trade_id, :headcount, daterange(:starts, :ends, '[]'))""",
        [
            {"project_id": projects[p.code], "trade_id": trades[singular_trade(name)],
             "headcount": planned, "starts": p.starts, "ends": p.ends}
            for p in PROJECTS
            for name, planned, _deployed in p.trades
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
    # Who is leaving, and whose contract ends, is chosen first so nobody gets two stories.
    used: set[str] = set()
    contract_ends: dict[str, date] = dict(NAMED_CONTRACT_ENDS)
    exits: dict[str, tuple[date, str]] = dict(NAMED_EXITS)
    for project, trade, ends in GENERATED_CONTRACT_ENDS:
        contract_ends[_pick(workers, project, trade, used).code] = ends
    for project, trade, left, reason in GENERATED_EXITS:
        exits[_pick(workers, project, trade, used).code] = (left, reason)
    absconded = next(
        w.code
        for w in sorted(workers, key=lambda w: w.code)
        if w.reason == "On leave" and w.code >= "EMP-0501"
    )
    exits[absconded] = (ABSCONDED_ON, "absconded")
    _insert(
        connection,
        """INSERT INTO employees
               (id, employee_code, full_name, phone, whatsapp_number, department_id,
                primary_trade_id, employment_status, availability, joined_on,
                contract_end_on, exit_on, exit_reason, is_demo)
           VALUES (:id, :code, :name, :phone, :phone, :department_id, :trade_id,
                   CAST(:employment AS employment_status),
                   CAST(:availability AS availability_state),
                   :joined, :contract_end, :exit_on, CAST(:exit_reason AS exit_reason), true)""",
        [
            {
                "id": ids[w.code], "code": w.code, "name": w.name, "phone": w.phone,
                "department_id": department_id, "trade_id": trades[w.trade],
                "employment": (
                    "absconded"
                    if w.code == absconded
                    else "on_leave" if w.reason == "On leave" else "active"
                ),
                "availability": w.status,
                "joined": SEED_TODAY - timedelta(days=300 + (i * 29) % 1200),
                "contract_end": contract_ends.get(w.code),
                "exit_on": exits[w.code][0] if w.code in exits else None,
                "exit_reason": exits[w.code][1] if w.code in exits else None,
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
    # Everyone is on their project until it ends, unless released early (EARLY_ENDS).
    last_day = {p.code: p.ends for p in PROJECTS}
    early = {_pick(workers, p, t, used).code: d for p, t, d in EARLY_ENDS}
    _insert(
        connection,
        """INSERT INTO employee_assignments (id, employee_id, project_id, period, status, is_demo)
           VALUES (:id, :employee_id, :project_id, daterange(:starts, :ends, '[]'),
                   CAST(:status AS assignment_status), true)""",
        [
            {
                "id": demo_id("assignment", w.code), "employee_id": ids[w.code],
                "project_id": projects[w.project],
                "ends": early.get(w.code, last_day[w.project]),
                "starts": SEED_TODAY + timedelta(days=3)
                if w.status == "mobilizing"
                else SEED_TODAY - timedelta(days=40 + int(w.code[-3:]) % 220),
                "status": "planned" if w.status == "mobilizing" else "active",
            }
            for w in workers
            if w.project and w.status in ("deployed", "mobilizing")
        ],
    )  # fmt: skip
    leave_rows: list[dict[str, Any]] = []
    for project, trade, first_day, last_day_of_leave in LEAVES:
        w = _pick(workers, project, trade, used)
        leave_rows.append(
            {"id": demo_id("leave", w.code), "employee_id": ids[w.code],
             "first": first_day, "last": last_day_of_leave}
        )  # fmt: skip
    _insert(
        connection,
        """INSERT INTO leave_records (id, employee_id, leave_type, period, approved, is_demo)
           VALUES (:id, :employee_id, 'annual', daterange(:first, :last, '[]'), true, true)""",
        leave_rows,
    )
    starts = {p.code: p.starts for p in PROJECTS}
    requester = demo_id("user", "hr_manager")
    _insert(
        connection,
        """INSERT INTO recruitment_requests
               (id, request_no, project_id, trade_id, headcount, needed_by, reason, status,
                requested_by, source, expected_arrival, replaces_employee_id, is_demo)
           VALUES (:id, :no, :project_id, :trade_id, :headcount, :needed_by, :reason,
                   CAST(:status AS recruitment_status), :requested_by,
                   CAST(:source AS recruit_source), :arrival, :replaces, true)""",
        [
            {
                "id": demo_id("recruitment", f"{project}:{trade}"),
                "no": f"RR-2026-{n:04d}",
                "project_id": projects[project], "trade_id": trades[trade],
                "headcount": headcount,
                # A project that has not started needs people a month before it does; one that is
                # already running needs them when they arrive.
                "needed_by": (
                    arrival if starts[project] <= SEED_TODAY else arrival - timedelta(days=30)
                ),
                "reason": f"Planned hiring of {headcount} {trade.lower()} for {project}",
                "status": stage, "requested_by": requester, "source": source,
                "arrival": arrival,
                "replaces": ids[replaces] if replaces else None,
            }
            for n, (project, trade, headcount, stage, source, arrival, replaces) in enumerate(
                RECRUITMENT, start=1
            )
        ],
    )  # fmt: skip
