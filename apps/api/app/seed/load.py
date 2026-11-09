"""Loads the demo data into Postgres. Runs as the database owner (see Settings.migration_url).

`reset_demo` removes only what this module creates, so the reference data that comes with the
schema (roles, permissions, role mapping, work rules, agents) is never touched.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from argon2 import PasswordHasher
from sqlalchemy import Connection, text
from sqlalchemy.orm import Session

from app.clock import GULF, SimulatedClock
from app.config import ConfigError, Settings
from app.seed.data import (
    ABSCONDED_ON,
    ALL_TRADES,
    APPLICANTS,
    DOC_TYPE_CODE,
    DOC_TYPES,
    EARLY_ENDS,
    GENERATED_CONTRACT_ENDS,
    GENERATED_EXITS,
    LEAVES,
    MOBILIZATION_DONE,
    MOBILIZATION_FIRST_NUMBER,
    NAMED_CONTRACT_ENDS,
    NAMED_EXITS,
    PROJECT_LEADS,
    PROJECTS,
    RECRUITMENT,
    REQUESTS,
    SEED_TODAY,
    SITE_SHIFT_ENDS,
    STAFF,
    TRADE_GROUPS,
)
from app.seed.workers import WorkerSeed, build_workers
from app.services.alerts.engine import run_detectors
from app.services.mobilization import TASK_TEMPLATE, readiness_of

_NAMESPACE = uuid.UUID("6d1f3c0a-5b7e-4d0e-9a52-0c1f7a6b9e11")  # fixed, so ids repeat on reseed


def demo_id(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, f"{kind}:{key}")


DEMO_USERS = (
    ("hr_manager", "Mr Imtiyaz", "noura.demo@constructiq.test"),
    ("hr_executive", "Priya Demo", "priya.demo@constructiq.test"),
    ("ceo", "Mr Sanjay", "layla.demo@constructiq.test"),
)

DEPARTMENTS = (("hr", "Human Resources"), ("operations", "Operations"), ("site", "Site workforce"))

# Everything below is deleted by reset_demo, children before parents.
_RESET_ORDER = (
    "audit_log",
    "notifications",  # emails HR sent to workers point at employees
    "calendar_events",  # events HR typed in point at the person who added them
    "applicant_interviews",  # invitations point at the user who sent them
    "applicants",
    "mobilization_tasks",  # approving a line starts mobilizations; they point at assignments
    "mobilizations",
    "employee_assignments",
    "employee_documents",
    "employee_skills",
    "staffing_request_picks",
    "staffing_request_lines",
    "approval_steps",
    "approval_requests",
    "staffing_requests",
    "recruitment_requests",
    "alerts",
    "conversation_messages",  # chat answers point at agent runs
    "agent_tool_calls",  # a narrator or agent run points at alerts and users
    "agent_runs",
    "conversations",  # a chat belongs to a user (and runs pointed at it)
    "leave_records",
    "user_project_access",
    "project_sites",
    "manpower_requirements",
    "projects",
    "clients",
    # The service account (a migration creates it) is not demo data and stays.
    "user_roles WHERE user_id IN (SELECT id FROM users WHERE is_demo)",
    "users WHERE is_demo",
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
    # The provisional 2027 ban is a demo assumption (the seed adds it); the schema's own rows stay.
    connection.execute(
        text("DELETE FROM work_rules WHERE code = 'midday_ban' AND year = 2027 AND is_provisional")
    )
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
           VALUES (:id, :project_id, :name, :outdoor, '06:00', :shift_end)""",
        [
            {"id": demo_id("site", f"{p.code}:{n}"), "project_id": projects[p.code],
             "name": f"Site {n}", "outdoor": p.outdoor,
             "shift_end": SITE_SHIFT_ENDS.get((p.code, n), "12:30")}
            for p in PROJECTS
            for n in range(1, p.sites + 1)
        ],
    )  # fmt: skip
    # HR's planning assumption for next summer, until MoHRE announces the dates (is_provisional).
    connection.execute(
        text(
            """INSERT INTO work_rules (code, year, starts_on, ends_on, blocked_from, blocked_to,
                                       max_daily_hours, is_provisional)
               VALUES ('midday_ban', 2027, '2027-06-15', '2027-09-15', '12:30', '15:00', 8, true)
               ON CONFLICT (code, year) DO NOTHING"""
        )
    )

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
    _load_staff_and_applicants(connection, departments["site"], trades, projects)
    _raise_alerts(connection, settings)
    return {
        "workers": len(workers),
        "documents": sum(len(w.docs) for w in workers),
        "projects": len(PROJECTS),
        "users": len(DEMO_USERS),
    }


def _load_staff_and_applicants(
    connection: Connection,
    department_id: uuid.UUID,
    trades: dict[str, uuid.UUID],
    projects: dict[str, uuid.UUID],
) -> None:
    """Project staff (key roles), who leads which project, and the demo applicants. They are added
    after the 150 workers so that the prototype-matched list stays as it is."""
    ids = {code: demo_id("employee", code) for code, _, _, _ in STAFF}
    _insert(
        connection,
        """INSERT INTO employees
               (id, employee_code, full_name, email, department_id, primary_trade_id,
                employment_status, availability, joined_on, is_demo)
           VALUES (:id, :code, :name, :email, :department_id, :trade_id,
                   'active', 'available', :joined, true)""",
        [
            {
                "id": ids[code], "code": code, "name": name,
                "email": name.lower().replace(" ", ".") + "@example.test",
                "department_id": department_id, "trade_id": trades[trade],
                "joined": SEED_TODAY - timedelta(days=400 + i * 90),
            }
            for i, (code, name, trade, _level) in enumerate(STAFF)
        ],
    )  # fmt: skip
    _insert(
        connection,
        """INSERT INTO employee_skills (employee_id, trade_id, level, verified)
           VALUES (:employee_id, :trade_id, :level, true)""",
        [
            {"employee_id": ids[code], "trade_id": trades[trade], "level": level}
            for code, _, trade, level in STAFF
        ],
    )
    _insert(
        connection,
        """INSERT INTO employee_documents
               (id, employee_id, doc_type, doc_number, expiry_date, status, is_current, is_demo)
           VALUES (:id, :employee_id, CAST(:doc_type AS document_type), :number, :expiry,
                   'verified', true, true)""",
        [
            {
                "id": demo_id("document", f"{code}:{doc_type}"), "employee_id": ids[code],
                "doc_type": DOC_TYPE_CODE[doc_type], "number": f"STAFF-{code[-3:]}-{k}",
                "expiry": SEED_TODAY + timedelta(days=320 + i * 25 + k * 60),
            }
            for i, (code, _, _, _) in enumerate(STAFF)
            for k, doc_type in enumerate(DOC_TYPES)
        ],
    )  # fmt: skip
    for project, code in PROJECT_LEADS.items():
        connection.execute(
            text("UPDATE projects SET lead_employee_id = :e WHERE id = :p"),
            {"e": ids[code], "p": projects[project]},
        )
    _insert(
        connection,
        """INSERT INTO applicants
               (id, code, full_name, category, years_experience, nationality, location, email,
                skills, summary, documents_ready, available_from, is_demo)
           VALUES (:id, :code, :name, :category, :years, :nationality, :location, :email,
                   :skills, :summary, :ready, :available, true)""",
        [
            {
                "id": demo_id("applicant", code), "code": code, "name": name, "category": category,
                "years": years, "nationality": nationality, "location": location,
                "email": name.lower().replace(" ", ".") + "@example.test",
                "skills": list(skills), "summary": summary, "ready": ready,
                "available": SEED_TODAY + timedelta(days=days),
            }
            for code, name, category, years, nationality, location, skills, summary, ready, days
            in APPLICANTS
        ],
    )  # fmt: skip


def _raise_alerts(connection: Connection, settings: Settings) -> None:
    """The demo starts with the alerts the detectors find in it, as on the seeded date."""
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        run_detectors(session, settings, SimulatedClock(SEED_TODAY), is_demo=True, reason="seed")
        session.commit()


EMAIL_WORKERS = ("EMP-0088", "EMP-0094", "EMP-0107", "EMP-0118", "EMP-0125", "EMP-0142")
# Upcoming leaves for named workers, and what HR has put in the calendar by hand (all fictional).
DEMO_LEAVES = (
    # Not the steel fixers: they are the free pool the RAK-03 / RAK-07 stories count.
    ("EMP-0161", "annual", date(2026, 11, 16), date(2026, 11, 22)),
    ("EMP-0163", "sick", date(2026, 11, 9), date(2026, 11, 11)),
    ("EMP-0171", "annual", date(2026, 12, 14), date(2026, 12, 28)),
)
DEMO_EVENTS = (
    ("Safety induction at Marina Waterfront", date(2026, 11, 12), date(2026, 11, 12), "meeting"),
    ("MoHRE quota submission deadline", date(2026, 11, 19), date(2026, 11, 19), "deadline"),
    ("Monthly HR review with the MD", date(2026, 11, 26), date(2026, 11, 26), "meeting"),
    ("Labour card renewal batch", date(2026, 12, 8), date(2026, 12, 10), "event"),
)


def _load_calendar_and_emails(connection: Connection, ids: dict[str, uuid.UUID]) -> None:
    """Fictional extras so the calendar and the email demo have something to show on day one."""
    for code in EMAIL_WORKERS:
        if code in ids:
            connection.execute(
                text(
                    """UPDATE employees SET email = lower(replace(full_name, ' ', '.'))
                              || '@example.test' WHERE id = :id"""
                ),
                {"id": ids[code]},
            )
    for code, kind, first, last in DEMO_LEAVES:
        if code in ids:
            connection.execute(
                text(
                    """INSERT INTO leave_records
                           (employee_id, leave_type, period, approved, is_demo)
                       VALUES (:e, :k, daterange(:f, :l, '[]'), true, true)
                       ON CONFLICT DO NOTHING"""
                ),
                {"e": ids[code], "k": kind, "f": first, "l": last},
            )
    manager = demo_id("user", "hr_manager")
    _insert(
        connection,
        """INSERT INTO calendar_events (id, title, starts_on, ends_on, kind, created_by, is_demo)
           VALUES (:id, :title, :first, :last, :kind, :by, true)""",
        [
            {"id": demo_id("event", title), "title": title, "first": first, "last": last,
             "kind": kind, "by": manager}
            for title, first, last, kind in DEMO_EVENTS
        ],
    )  # fmt: skip


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
    _load_calendar_and_emails(connection, ids)
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
    _seed_requests(connection, demo_id("user", "hr_executive"), projects, trades)
    _seed_mobilizations(connection, workers, demo_id("user", "hr_manager"))


def _seed_mobilizations(
    connection: Connection, workers: list[WorkerSeed], done_by: uuid.UUID
) -> None:
    """A mobilization for each person who is Mobilizing, with the checklist part-way done."""
    mobilizing = sorted((w for w in workers if w.status == "mobilizing"), key=lambda w: w.code)
    if len(mobilizing) != len(MOBILIZATION_DONE):
        raise ConfigError(
            f"The seed has {len(mobilizing)} mobilizing workers but {len(MOBILIZATION_DONE)} "
            "mobilization plans"
        )
    report_on = SEED_TODAY + timedelta(days=3)  # their assignments start then
    finished = datetime.combine(SEED_TODAY - timedelta(days=1), time(9, 0), tzinfo=UTC)
    for n, (w, done) in enumerate(zip(mobilizing, MOBILIZATION_DONE, strict=True)):
        mob_id = demo_id("mobilization", w.code)
        readiness = readiness_of({title for _, key, title, _ in TASK_TEMPLATE if key in done})
        connection.execute(
            text(
                """INSERT INTO mobilizations
                       (id, mob_no, assignment_id, report_on, status, readiness, is_demo)
                   VALUES (:id, :no, :assignment, :report_on, CAST(:status AS mob_status),
                           CAST(:readiness AS jsonb), true)"""
            ),
            {
                "id": mob_id,
                "no": f"MOB-{SEED_TODAY.year}-{MOBILIZATION_FIRST_NUMBER + n:04d}",
                "assignment": demo_id("assignment", w.code),
                "report_on": report_on,
                "status": "in_progress" if done else "approved",
                "readiness": json.dumps(readiness),
            },
        )
        for department, key, title, days_before in TASK_TEMPLATE:
            is_done = key in done
            connection.execute(
                text(
                    """INSERT INTO mobilization_tasks
                           (id, mobilization_id, department_id, title, due_on, status, owner_id,
                            completed_at)
                       SELECT :id, :mob, d.id, :title, :due, CAST(:status AS task_status), :owner,
                              :completed
                       FROM departments d WHERE d.code = :code"""
                ),
                {
                    "id": demo_id("mobilization_task", f"{w.code}:{key}"),
                    "mob": mob_id,
                    "title": title,
                    "due": report_on - timedelta(days=days_before),
                    "status": "done" if is_done else "open",
                    "owner": done_by if is_done else None,
                    "completed": finished if is_done else None,
                    "code": department,
                },
            )


def _seed_requests(
    connection: Connection,
    requester: uuid.UUID,
    projects: dict[str, uuid.UUID],
    trades: dict[str, uuid.UUID],
) -> None:
    """The open requests the Allocation Board starts with, each with its approval waiting."""
    for n, (project, first, last, priority, note, lines) in enumerate(REQUESTS, start=1):
        request_id = demo_id("request", project)
        request_no = f"SR-2026-{n:04d}"
        # Sent the afternoon before last (3 Nov), then the afternoon of the day before (4 Nov).
        sent = datetime.combine(
            SEED_TODAY - timedelta(days=len(REQUESTS) + 1 - n), time(16, 0), tzinfo=GULF
        )
        connection.execute(
            text(
                """INSERT INTO staffing_requests
                       (id, request_no, project_id, requested_by, needed_from, needed_until,
                        priority, status, source_text, is_demo, created_at)
                   VALUES (:id, :no, :project, :user, :first, :last, :priority, 'submitted',
                           :note, true, :sent)"""
            ),
            {"id": request_id, "no": request_no, "project": projects[project], "user": requester,
             "first": first, "last": last, "priority": priority, "note": note, "sent": sent},
        )  # fmt: skip
        for trade, headcount, level in lines:
            connection.execute(
                text(
                    """INSERT INTO staffing_request_lines
                           (request_id, trade_id, headcount, min_level)
                       VALUES (:request, :trade, :headcount, :level)"""
                ),
                {"request": request_id, "trade": trades[trade], "headcount": headcount,
                 "level": level},
            )  # fmt: skip
        people = sum(line[1] for line in lines)
        approval_id = demo_id("approval", request_no)
        connection.execute(
            text(
                """INSERT INTO approval_requests
                       (id, subject_type, subject_id, requested_by, summary, created_at)
                   VALUES (:id, 'staffing_request', :request, :user, :summary, :sent)"""
            ),
            {"id": approval_id, "request": request_id, "user": requester, "sent": sent,
             "summary": f"{request_no}: {people} people for {project} from {first:%d %b %Y}"},
        )  # fmt: skip
        connection.execute(
            text(
                """INSERT INTO approval_steps (approval_id, step_no, role_id)
                   SELECT :approval, 1, id FROM roles WHERE code = 'hr_manager'"""
            ),
            {"approval": approval_id},
        )
