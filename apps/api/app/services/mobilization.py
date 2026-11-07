"""Mobilization: the checklist that gets an approved person on site.

Approving a worker on a request line creates the mobilization and its department tasks together
(rules MOB_REQUIRES_ASSIGNMENT and MOB_TASKS_ONCE). From there HR ticks the tasks off for every
department (MOB_TASK_UPDATE) and confirms arrival once the checklist is done and the report date
has come (ARRIVAL_CONFIRM, MOB_ARRIVAL_CHECKLIST). The stage of a card is computed here, never
dragged (MOB_STAGE). See docs/rules.md.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

from sqlalchemy import RowMapping, text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.auth.scope import employee_scope
from app.schemas import (
    MobilizationDetail,
    MobilizationList,
    MobilizationRow,
    MobilizationTask,
    MobStage,
)

# (department code, readiness key, task, days before the report date it is due)
TASK_TEMPLATE: tuple[tuple[str, str, str, int], ...] = (
    ("hr", "documents", "Verify residency visa and medical fitness", 7),
    ("operations", "bed", "Assign a camp bed", 3),
    ("operations", "transport", "Arrange transport to site", 3),
    ("site", "ppe", "Issue PPE", 1),
    ("site", "induction", "Site induction", 0),
)
READINESS_KEYS = tuple(key for _, key, _, _ in TASK_TEMPLATE)
_KEY_OF_TITLE = {title: key for _, key, title, _ in TASK_TEMPLATE}
_ORDER_OF_TITLE = {title: n for n, (_, _, title, _) in enumerate(TASK_TEMPLATE)}

# Someone who arrived stays on the board for this long, then lives only on their profile.
RECENT_ARRIVAL_DAYS = 14
OPEN_STATUSES = ("approved", "in_progress")


class MobilizationError(Exception):
    """A change the checklist refuses, with the HTTP status the caller should answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


def next_mob_no(session: Session, year: int) -> str:
    n = session.execute(
        text(
            """SELECT coalesce(max(substring(mob_no FROM '[0-9]+$')::int), 0) + 1
               FROM mobilizations WHERE mob_no ~ ('^MOB-' || :year || '-[0-9]+$')"""
        ),
        {"year": str(year)},
    ).scalar_one()
    return f"MOB-{year}-{int(n):04d}"


def readiness_of(done_titles: set[str]) -> dict[str, bool]:
    """The five readiness items, each true once its task is done."""
    return {key: title in done_titles for title, key in _KEY_OF_TITLE.items()}


def start_mobilization(
    session: Session,
    *,
    assignment_id: uuid.UUID,
    report_on: date,
    today: date,
    approved: bool,
) -> str:
    """One mobilization for an assignment, with its tasks. Returns its number."""
    mob_no = next_mob_no(session, today.year)
    mob_id = session.execute(
        text(
            """INSERT INTO mobilizations (mob_no, assignment_id, report_on, status, readiness)
               VALUES (:no, :assignment, :report_on, CAST(:status AS mob_status),
                       CAST(:readiness AS jsonb))
               RETURNING id"""
        ),
        {
            "no": mob_no,
            "assignment": assignment_id,
            "report_on": report_on,
            "status": "approved" if approved else "pending_approval",
            "readiness": json.dumps(readiness_of(set())),
        },
    ).scalar_one()
    if approved:  # tasks exist from the moment the mobilization is approved
        for department, _key, title, days_before in TASK_TEMPLATE:
            session.execute(
                text(
                    """INSERT INTO mobilization_tasks
                           (mobilization_id, department_id, title, due_on)
                       SELECT :mob, d.id, :title, :due FROM departments d WHERE d.code = :code"""
                ),
                {
                    "mob": mob_id,
                    "title": title,
                    "due": max(report_on - timedelta(days=days_before), today),
                    "code": department,
                },
            )
    return mob_no


# ------------------------------------------------------------------------------------- reading


def stage_of(status: str, done: int, total: int) -> MobStage:
    """MOB_STAGE: where a card sits, from the tasks. Nothing moves a card by hand."""
    if status == "completed":
        return "on_site"
    if total > 0 and done == total:
        return "ready"
    if done > 0:
        return "in_progress"
    return "pending_checklist"


_ROW_SQL = """
SELECT m.id, m.mob_no, m.status::text AS status, m.report_on,
       a.id AS assignment_id, a.arrived_at, e.id AS employee_id, e.employee_code,
       e.full_name, t.name AS trade, p.code AS project_code, p.name AS project_name,
       count(k.id) AS total,
       count(k.id) FILTER (WHERE k.status = 'done') AS done,
       count(k.id) FILTER (WHERE k.status <> 'done' AND k.due_on < :today) AS overdue
FROM mobilizations m
JOIN employee_assignments a ON a.id = m.assignment_id
JOIN employees e ON e.id = a.employee_id
JOIN projects p ON p.id = a.project_id
LEFT JOIN trades t ON t.id = e.primary_trade_id
LEFT JOIN mobilization_tasks k ON k.mobilization_id = m.id
WHERE {where}
GROUP BY m.id, a.id, e.id, t.id, p.id
"""


def _row(r: RowMapping) -> MobilizationRow:
    arrived = r["arrived_at"]
    return MobilizationRow(
        mob_no=r["mob_no"],
        stage=stage_of(r["status"], int(r["done"]), int(r["total"])),
        status=r["status"],
        worker_code=r["employee_code"],
        worker_name=r["full_name"],
        trade=r["trade"],
        project_code=r["project_code"],
        project_name=r["project_name"],
        report_on=r["report_on"],
        tasks_done=int(r["done"]),
        tasks_total=int(r["total"]),
        overdue=int(r["overdue"]),
        arrived_on=arrived.date() if arrived is not None else None,
    )


def mobilization_rows(
    session: Session,
    user: AuthUser,
    today: date,
    *,
    q: str = "",
    project: str = "",
    overdue_only: bool = False,
) -> MobilizationList:
    """The pipeline: everyone being mobilized, plus people who arrived in the last two weeks."""
    scope_sql, params = employee_scope(user, "mobilization:read")
    where = [
        scope_sql,
        "m.status <> 'cancelled'",
        "(m.status <> 'completed' OR a.arrived_at::date >= :recent)",
    ]
    params = {**params, "today": today, "recent": today - timedelta(days=RECENT_ARRIVAL_DAYS)}
    if q.strip():
        where.append(
            """(m.mob_no ILIKE :like OR e.full_name ILIKE :like OR e.employee_code ILIKE :like
                OR p.code ILIKE :like OR p.name ILIKE :like)"""
        )
        params["like"] = f"%{q.strip()}%"
    if project:
        where.append("p.code = :project")
        params["project"] = project
    sql = _ROW_SQL.format(where=" AND ".join(where)) + " ORDER BY m.report_on, m.mob_no"
    rows = [_row(r) for r in session.execute(text(sql), params).mappings()]
    if overdue_only:
        rows = [r for r in rows if r.overdue > 0]
    return MobilizationList(today=today, items=rows)


def _one(
    session: Session, user: AuthUser, permission: str, mob_no: str, today: date
) -> RowMapping | None:
    scope_sql, params = employee_scope(user, permission)
    sql = _ROW_SQL.format(where=f"{scope_sql} AND m.mob_no = :mob_no")
    return (
        session.execute(text(sql), {**params, "mob_no": mob_no, "today": today}).mappings().first()
    )


def _tasks(session: Session, mobilization_id: uuid.UUID, today: date) -> list[MobilizationTask]:
    rows = session.execute(
        text(
            """SELECT k.id, k.title, k.status::text AS status, k.due_on, k.completed_at,
                      d.code AS department, d.name AS department_name, u.full_name AS done_by
               FROM mobilization_tasks k
               JOIN departments d ON d.id = k.department_id
               LEFT JOIN users u ON u.id = k.owner_id
               WHERE k.mobilization_id = :id"""
        ),
        {"id": mobilization_id},
    ).mappings()
    tasks = [
        MobilizationTask(
            id=r["id"],
            department=r["department"],
            department_name=r["department_name"],
            title=r["title"],
            due_on=r["due_on"],
            status=r["status"],
            overdue=r["status"] != "done" and r["due_on"] is not None and r["due_on"] < today,
            done_by=r["done_by"] if r["status"] == "done" else None,
            done_at=r["completed_at"] if r["status"] == "done" else None,
        )
        for r in rows
    ]
    return sorted(tasks, key=lambda t: _ORDER_OF_TITLE.get(t.title, len(_ORDER_OF_TITLE)))


def _update_state(user: AuthUser, status: str) -> tuple[bool, str | None]:
    if not user.can("mobilization:update"):
        return False, "Only HR ticks tasks off."
    if status == "completed":
        return False, "This person has arrived, so the checklist is closed."
    if status == "pending_approval":
        return (
            False,
            "This mobilization waits for approval. The checklist starts once it is approved.",
        )
    if status == "cancelled":
        return False, "This mobilization was cancelled."
    return True, None


def _arrival_state(
    user: AuthUser,
    row: RowMapping,
    tasks: list[MobilizationTask],
    today: date,
) -> tuple[bool, str | None]:
    """ARRIVAL_CONFIRM and MOB_ARRIVAL_CHECKLIST: may this person confirm arrival right now?"""
    if not user.can("assignment:confirm_arrival"):
        return False, "Only HR confirms arrival."
    if row["status"] == "completed":
        return False, f"{row['full_name']} arrived on {_day(row['arrived_at'].date())}."
    if row["status"] not in OPEN_STATUSES:
        return False, f"{row['mob_no']} is {row['status'].replace('_', ' ')}."
    if today < row["report_on"]:
        return (
            False,
            f"Reports on {_day(row['report_on'])}. Arrival can be confirmed from that day.",
        )
    open_tasks = [t for t in tasks if t.status != "done"]
    if open_tasks:
        n = len(open_tasks)
        return (
            False,
            f"Finish the checklist first: {n} {'task is' if n == 1 else 'tasks are'} still open.",
        )
    return True, None


def _detail(session: Session, user: AuthUser, row: RowMapping, today: date) -> MobilizationDetail:
    tasks = _tasks(session, row["id"], today)
    can_update, update_note = _update_state(user, row["status"])
    can_arrive, arrival_note = _arrival_state(user, row, tasks, today)
    return MobilizationDetail(
        **_row(row).model_dump(),
        tasks=tasks,
        can_update=can_update,
        update_note=update_note,
        can_confirm_arrival=can_arrive,
        arrival_note=arrival_note,
    )


def mobilization_detail(
    session: Session, user: AuthUser, mob_no: str, today: date
) -> MobilizationDetail | None:
    row = _one(session, user, "mobilization:read", mob_no, today)
    return None if row is None else _detail(session, user, row, today)


# ------------------------------------------------------------------------------------ changing


def _sync(session: Session, mobilization_id: uuid.UUID) -> None:
    """Keep the readiness snapshot and the status in step with the tasks (MOB_TASK_UPDATE)."""
    done = {
        r[0]
        for r in session.execute(
            text(
                """SELECT title FROM mobilization_tasks
                   WHERE mobilization_id = :id AND status = 'done'"""
            ),
            {"id": mobilization_id},
        )
    }
    session.execute(
        text(
            """UPDATE mobilizations
               SET readiness = CAST(:readiness AS jsonb),
                   status = CAST(:status AS mob_status)
               WHERE id = :id"""
        ),
        {
            "id": mobilization_id,
            "readiness": json.dumps(readiness_of(done)),
            "status": "in_progress" if done else "approved",
        },
    )


def set_task(
    session: Session,
    user: AuthUser,
    today: date,
    mob_no: str,
    task_id: uuid.UUID,
    *,
    done: bool,
) -> tuple[MobilizationDetail, bool]:
    """Mark one task done or open again. Returns the checklist and whether anything changed."""
    row = _one(session, user, "mobilization:update", mob_no, today)
    if row is None:
        raise MobilizationError(404, "Mobilization not found")
    allowed, note = _update_state(user, row["status"])
    if not allowed:
        raise MobilizationError(409, note or "The checklist cannot be changed.")
    task = (
        session.execute(
            text(
                """SELECT status::text AS status FROM mobilization_tasks
                   WHERE id = :id AND mobilization_id = :mob FOR UPDATE"""
            ),
            {"id": task_id, "mob": row["id"]},
        )
        .mappings()
        .first()
    )
    if task is None:
        raise MobilizationError(404, "Task not found")
    changed = (task["status"] == "done") != done
    if changed:
        if done:
            session.execute(
                text(
                    """UPDATE mobilization_tasks
                       SET status = 'done', owner_id = :user, completed_at = now()
                       WHERE id = :id"""
                ),
                {"id": task_id, "user": user.id},
            )
        else:
            session.execute(
                text(
                    """UPDATE mobilization_tasks
                       SET status = 'open', owner_id = NULL, completed_at = NULL
                       WHERE id = :id"""
                ),
                {"id": task_id},
            )
        _sync(session, row["id"])
    fresh = _one(session, user, "mobilization:update", mob_no, today)
    assert fresh is not None
    return _detail(session, user, fresh, today), changed


def confirm_arrival(
    session: Session, user: AuthUser, today: date, mob_no: str
) -> MobilizationDetail:
    """The person is on site: the assignment starts, the mobilization ends, they are Deployed."""
    row = _one(session, user, "assignment:confirm_arrival", mob_no, today)
    if row is None:
        raise MobilizationError(404, "Mobilization not found")
    allowed, note = _arrival_state(user, row, _tasks(session, row["id"], today), today)
    if not allowed:
        raise MobilizationError(409, note or "Arrival cannot be confirmed.")
    arrived = session.execute(
        text(
            """UPDATE employee_assignments SET arrived_at = now(), status = 'active'
               WHERE id = :id AND arrived_at IS NULL AND status IN ('planned', 'active')
               RETURNING id"""
        ),
        {"id": row["assignment_id"]},
    ).first()
    if arrived is None:
        raise MobilizationError(409, f"{row['full_name']}'s arrival was already confirmed.")
    session.execute(
        text("UPDATE mobilizations SET status = 'completed', completed_at = now() WHERE id = :id"),
        {"id": row["id"]},
    )
    session.execute(
        text("UPDATE employees SET availability = 'deployed' WHERE id = :id"),
        {"id": row["employee_id"]},
    )
    fresh = _one(session, user, "assignment:confirm_arrival", mob_no, today)
    assert fresh is not None
    return _detail(session, user, fresh, today)
