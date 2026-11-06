"""Putting a person on a project: the one place that writes a planned assignment.

Used by Reserve (a hold from the forecast) and by approving a request line. The database refuses
two live assignments that overlap, so a clash can never be written, whatever the caller forgets.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session


def plan_assignment(
    session: Session,
    *,
    employee_code: str,
    project_id: uuid.UUID,
    first_day: date,
    last_exclusive: date | None,
    approver_id: uuid.UUID,
    from_project: str | None = None,
    after_last: date | None = None,
    request_line_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """A `planned` assignment, linked to the one it depends on when the person is moving.

    `from_project` and `after_last` (the day after their last day there) identify the assignment
    they are leaving, so the "transfer dependency" can be watched later. Raises IntegrityError if
    the person already holds an overlapping live assignment.
    """
    return session.execute(
        text(
            """INSERT INTO employee_assignments
                   (employee_id, project_id, period, status, depends_on_assignment_id,
                    request_line_id, approved_by, approved_at)
               SELECT e.id, :project_id, daterange(:first, :last, '[)'), 'planned',
                      (SELECT a.id FROM employee_assignments a
                       JOIN projects p ON p.id = a.project_id
                       WHERE a.employee_id = e.id AND p.code = :from_project
                         AND a.status IN ('planned', 'active')
                         AND upper(a.period) = :after_last
                       LIMIT 1),
                      :line_id, :approver, now()
               FROM employees e WHERE e.employee_code = :code
               RETURNING id"""
        ),
        {
            "project_id": project_id, "first": first_day, "last": last_exclusive,
            "from_project": from_project, "after_last": after_last, "line_id": request_line_id,
            "approver": approver_id, "code": employee_code,
        },
    ).scalar_one()  # fmt: skip


def adopt_reservation(
    session: Session,
    *,
    employee_code: str,
    project_id: uuid.UUID,
    request_line_id: uuid.UUID,
    approver_id: uuid.UUID,
) -> uuid.UUID | None:
    """Attach a request line to a reservation already held on this project. None if there is none.

    A person reserved from the forecast already holds a planned assignment; approving them on a
    request must not insert a second one (the database would refuse the overlap).
    """
    row = session.execute(
        text(
            """UPDATE employee_assignments a
               SET request_line_id = :line_id, approved_by = :approver, approved_at = now()
               FROM employees e
               WHERE e.id = a.employee_id AND e.employee_code = :code
                 AND a.project_id = :project_id AND a.status = 'planned'
                 AND a.request_line_id IS NULL
               RETURNING a.id"""
        ),
        {
            "line_id": request_line_id, "approver": approver_id, "code": employee_code,
            "project_id": project_id,
        },
    ).scalar_one_or_none()  # fmt: skip
    return uuid.UUID(str(row)) if row is not None else None
