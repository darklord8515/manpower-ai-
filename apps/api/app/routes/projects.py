"""Projects and the summary behind the Home screens."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, authenticated, get_clock, require
from app.auth.scope import employee_scope, full_profile
from app.clock import Clock
from app.db import get_session
from app.routes.documents import expiring
from app.schemas import (
    ExpiryCounts,
    ExpiryWeek,
    NewProject,
    ProjectRow,
    Summary,
    Trade,
    WorkforceCounts,
)

router = APIRouter(tags=["projects"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]


def _projects(session: Session, user: AuthUser) -> list[ProjectRow]:
    """Only projects the caller may see. project:read with a project or site scope means the
    projects they hold access rows for."""
    scope = user.scope("project:read")
    params: dict[str, object] = {}
    visible = "TRUE"
    if scope in ("project", "site"):
        visible = "pr.id = ANY(:projects)"
        params["projects"] = list(user.whole_projects)
    elif scope != "all":
        visible = "FALSE"
    rows = session.execute(
        text(
            f"""SELECT pr.code, pr.name, pr.status::text AS status, pr.starts_on AS starts,
                       pr.ends_on AS ends,
                       COALESCE((SELECT sum(m.headcount) FROM manpower_requirements m
                                 WHERE m.project_id = pr.id), 0) AS planned,
                       (SELECT count(*) FROM employee_assignments a
                        JOIN employees e ON e.id = a.employee_id
                        WHERE a.project_id = pr.id AND a.status = 'active'
                          AND e.availability = 'deployed') AS deployed
                FROM projects pr WHERE {visible} ORDER BY pr.code"""  # noqa: S608
        ),
        params,
    ).mappings()
    return [
        ProjectRow(
            code=r["code"], name=r["name"], status=r["status"], starts=r["starts"],
            ends=r["ends"], planned=int(r["planned"]), deployed=int(r["deployed"]),
        )
        for r in rows
    ]  # fmt: skip


@router.get("/projects")
def list_projects(
    session: SessionDep, user: Annotated[AuthUser, Depends(require("project:read"))]
) -> list[ProjectRow]:
    return _projects(session, user)


def _insert_project(session: Session, body: NewProject) -> tuple[uuid.UUID, str]:
    """Insert the project under the next free RAK-NN code. Returns (id, code)."""
    for _ in range(3):  # two people adding at once could pick the same number
        try:
            row = session.execute(
                text(
                    """INSERT INTO projects (code, name, status, starts_on, ends_on, description)
                       SELECT 'RAK-' || lpad(
                                  (coalesce(max(substring(code FROM 5)::int), 0) + 1)::text,
                                  2, '0'),
                              :name, 'planning', :starts, :ends, :description
                       FROM projects WHERE code ~ '^RAK-[0-9]+$'
                       RETURNING id, code"""
                ),
                {"name": body.name, "starts": body.starts_on, "ends": body.ends_on,
                 "description": body.description},
            ).one()  # fmt: skip
            return row[0], str(row[1])
        except IntegrityError:
            session.rollback()
    raise HTTPException(
        status.HTTP_409_CONFLICT, "Another project was added at the same time. Try again."
    )


@router.get("/trades")
def list_trades(
    session: SessionDep, _user: Annotated[AuthUser, Depends(authenticated())]
) -> list[Trade]:
    """The trades a project can ask for (the Add-project form's choices)."""
    rows = session.execute(text("SELECT code, name FROM trades ORDER BY name")).mappings()
    return [Trade(code=r["code"], name=r["name"]) for r in rows]


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(
    body: NewProject,
    request: Request,
    session: SessionDep,
    user: Annotated[AuthUser, Depends(require("project:write"))],
) -> ProjectRow:
    """A new project in planning, with the trades it needs. HR runs the forecast next."""
    codes = [line.trade for line in body.lines]
    known = {
        r["code"]: r["id"]
        for r in session.execute(
            text("SELECT id, code FROM trades WHERE code = ANY(:codes)"), {"codes": codes}
        ).mappings()
    }
    unknown = [c for c in codes if c not in known]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown trade: {', '.join(unknown)}"
        )
    project_id, project_code = _insert_project(session, body)
    session.execute(
        text(
            """INSERT INTO project_sites (project_id, name, outdoor, default_shift_start,
                                          default_shift_end)
               VALUES (:project_id, :name, :outdoor, '06:00', '12:30')"""
        ),
        {"project_id": project_id, "name": body.site_name or body.name, "outdoor": body.outdoor},
    )
    for line in body.lines:
        session.execute(
            text(
                """INSERT INTO manpower_requirements (project_id, trade_id, headcount, period)
                   VALUES (:project_id, :trade_id, :headcount, daterange(:starts, :ends, '[]'))"""
            ),
            {"project_id": project_id, "trade_id": known[line.trade], "headcount": line.headcount,
             "starts": line.starts_on or body.starts_on, "ends": line.ends_on or body.ends_on},
        )  # fmt: skip
    write_audit(session, request, "project.created", "project", user, entity_id=project_id)
    return next(p for p in _projects(session, user) if p.code == project_code)


@router.get("/summary")
def summary(
    session: SessionDep,
    clock: ClockDep,
    user: Annotated[AuthUser, Depends(require("employee:read"))],
) -> Summary:
    scope_sql, params = employee_scope(user, "employee:read")
    by_status = {
        r[0]: int(r[1])
        for r in session.execute(
            text(
                f"""SELECT e.availability::text, count(*) FROM employees e
                    WHERE ({scope_sql}) GROUP BY 1"""  # noqa: S608
            ),
            params,
        )
    }
    workforce = WorkforceCounts(
        total=sum(by_status.values()),
        deployed=by_status.get("deployed", 0),
        mobilizing=by_status.get("mobilizing", 0),
        available=by_status.get("available", 0),
        unavailable=by_status.get("unavailable", 0),
    )
    documents = (
        expiring(session, clock, user).counts
        if full_profile(user)
        else ExpiryCounts(expired=0, d30=0, d60=0, d90=0)
    )
    projects = _projects(session, user) if user.can("project:read") else []
    today = clock.today()
    return Summary(
        today=today,
        workforce=workforce,
        documents=documents,
        expiry_by_week=_expiry_by_week(session, user, today),
        short_total=sum(max(p.planned - p.deployed, 0) for p in projects if p.status == "active"),
        projects=projects,
    )


def _expiry_by_week(session: Session, user: AuthUser, today: date) -> list[ExpiryWeek]:
    weeks = [ExpiryWeek(week_start=today + timedelta(days=7 * i), count=0) for i in range(13)]
    if not full_profile(user):
        return weeks
    scope_sql, params = employee_scope(user, "employee:read")
    rows = session.execute(
        text(
            f"""SELECT (d.expiry_date - :today) / 7 AS week, count(*)
                FROM employee_documents d JOIN employees e ON e.id = d.employee_id
                WHERE d.is_current AND d.expiry_date - :today BETWEEN 0 AND 90 AND ({scope_sql})
                GROUP BY 1"""
        ),
        {**params, "today": today},
    )
    for week, count in rows:
        weeks[int(week)].count = int(count)
    return weeks
