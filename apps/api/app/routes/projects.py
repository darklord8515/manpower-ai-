"""Projects and the summary behind the Home screens."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile
from app.clock import Clock
from app.db import get_session
from app.routes.documents import expiring
from app.schemas import ExpiryCounts, ProjectRow, Summary, WorkforceCounts

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
    return Summary(today=clock.today(), workforce=workforce, documents=documents, projects=projects)
