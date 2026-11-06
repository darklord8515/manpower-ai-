"""Starting a mobilization: the checklist that gets an approved person on site.

Approving a worker on a request line creates the mobilization and its department tasks together
(rules MOB_REQUIRES_ASSIGNMENT and MOB_TASKS_ONCE). The checklist screen that ticks tasks off is a
later slice; what is created here is what that screen will show.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

# (department code, task, days before the report date it is due)
TASK_TEMPLATE: tuple[tuple[str, str, int], ...] = (
    ("hr", "Verify residency visa and medical fitness", 7),
    ("operations", "Assign a camp bed", 3),
    ("operations", "Arrange transport to site", 3),
    ("site", "Issue PPE", 1),
    ("site", "Site induction", 0),
)


def next_mob_no(session: Session, year: int) -> str:
    n = session.execute(
        text(
            """SELECT coalesce(max(substring(mob_no FROM '[0-9]+$')::int), 0) + 1
               FROM mobilizations WHERE mob_no ~ ('^MOB-' || :year || '-[0-9]+$')"""
        ),
        {"year": str(year)},
    ).scalar_one()
    return f"MOB-{year}-{int(n):04d}"


def start_mobilization(
    session: Session,
    *,
    assignment_id: uuid.UUID,
    report_on: date,
    today: date,
    approved: bool,
    documents_ok: bool,
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
            "readiness": json.dumps(
                {
                    "documents": documents_ok,
                    "bed": False,
                    "transport": False,
                    "ppe": False,
                    "induction": False,
                }
            ),
        },
    ).scalar_one()
    if approved:  # tasks exist from the moment the mobilization is approved
        for department, title, days_before in TASK_TEMPLATE:
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
