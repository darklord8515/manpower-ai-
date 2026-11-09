"""One project at a glance: where it is, when, how staffed and who is on it."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope
from app.clock import Clock
from app.db import get_session
from app.routes.projects import _projects  # pyright: ignore[reportPrivateUsage]
from app.schemas import (
    OverviewPerson,
    OverviewSite,
    OverviewTrade,
    ProjectOverview,
)

router = APIRouter(tags=["projects"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Reader = Annotated[AuthUser, Depends(require("project:read"))]
STAFF_LIMIT = 200


def progress_of(status: str, starts: date | None, ends: date | None, today: date) -> int | None:
    """How much of the planned period has passed, as a percentage. Python's, never a model's."""
    if status == "completed":
        return 100
    if starts is None or ends is None or ends <= starts:
        return None
    if today <= starts:
        return 0
    return min(100, round(100 * (today - starts).days / (ends - starts).days))


@router.get("/projects/{code}/overview")
def project_overview(
    code: str, session: SessionDep, clock: ClockDep, user: Reader
) -> ProjectOverview:
    today = clock.today()
    # Only projects the caller may see; one that exists but is out of scope is "not found".
    row = next((p for p in _projects(session, user) if p.code == code), None)
    if row is None:
        raise HTTPException(404, "Project not found")
    head = (
        session.execute(
            text(
                """SELECT p.id, p.description, c.name AS client FROM projects p
                   LEFT JOIN clients c ON c.id = p.client_id WHERE p.code = :code"""
            ),
            {"code": code},
        )
        .mappings()
        .one()
    )
    pid = head["id"]
    sites = [
        OverviewSite(
            name=s["name"],
            emirate=s["emirate"],
            latitude=float(s["latitude"]) if s["latitude"] is not None else None,
            longitude=float(s["longitude"]) if s["longitude"] is not None else None,
            outdoor=s["outdoor"],
        )  # fmt: skip
        for s in session.execute(
            text(
                """SELECT name, emirate, latitude, longitude, outdoor FROM project_sites
                   WHERE project_id = :p ORDER BY name"""
            ),
            {"p": pid},
        ).mappings()
    ]
    by_trade = {
        r["trade"]: r
        for r in session.execute(
            text(
                """SELECT t.name AS trade,
                          COALESCE(sum(m.headcount), 0) AS planned
                   FROM manpower_requirements m JOIN trades t ON t.id = m.trade_id
                   WHERE m.project_id = :p GROUP BY t.name"""
            ),
            {"p": pid},
        ).mappings()
    }
    live = {
        (r["trade"], r["state"]): int(r["n"])
        for r in session.execute(
            text(
                """SELECT t.name AS trade, e.availability::text AS state, count(*) AS n
                   FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
                   JOIN trades t ON t.id = e.primary_trade_id
                   WHERE a.project_id = :p AND a.status IN ('planned', 'active')
                     AND e.availability IN ('deployed', 'mobilizing')
                   GROUP BY t.name, e.availability"""
            ),
            {"p": pid},
        ).mappings()
    }
    names = sorted(set(by_trade) | {t for t, _ in live})
    trades = [
        OverviewTrade(
            trade=name,
            planned=int(by_trade[name]["planned"]) if name in by_trade else 0,
            deployed=live.get((name, "deployed"), 0),
            mobilizing=live.get((name, "mobilizing"), 0),
            gap=max(
                (int(by_trade[name]["planned"]) if name in by_trade else 0)
                - live.get((name, "deployed"), 0),
                0,
            ),
        )  # fmt: skip
        for name in names
    ]

    staff: list[OverviewPerson] = []
    total = 0
    if user.can("employee:read"):
        scope_sql, params = employee_scope(user, "employee:read")
        rows = (
            session.execute(
                text(
                    f"""SELECT e.employee_code AS code, e.full_name AS name, t.name AS trade,
                               es.level, e.availability::text AS status,
                               lower(a.period) AS starts, (upper(a.period) - 1) AS ends,
                               s.name AS site
                        FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
                        JOIN trades t ON t.id = e.primary_trade_id
                        LEFT JOIN employee_skills es
                          ON es.employee_id = e.id AND es.trade_id = e.primary_trade_id
                        LEFT JOIN project_sites s ON s.id = a.site_id
                        WHERE a.project_id = :p AND a.status IN ('planned', 'active')
                          AND ({scope_sql})
                        ORDER BY e.full_name"""  # noqa: S608
                ),
                {**params, "p": pid},
            )
            .mappings()
            .all()
        )
        total = len(rows)
        staff = [
            OverviewPerson(
                code=r["code"],
                name=r["name"],
                trade=r["trade"],
                level=r["level"],
                status=r["status"],
                starts=r["starts"],
                ends=r["ends"],
                site=r["site"],
            )  # fmt: skip
            for r in rows[:STAFF_LIMIT]
        ]
    mobilizing = sum(t.mobilizing for t in trades)
    return ProjectOverview(
        code=row.code, name=row.name, status=row.status, description=head["description"],
        client=head["client"], starts=row.starts, ends=row.ends,
        progress=progress_of(row.status, row.starts, row.ends, today),
        days_left=(row.ends - today).days if row.ends and row.status == "active" else None,
        planned=row.planned, deployed=row.deployed, mobilizing=mobilizing,
        gap=max(row.planned - row.deployed, 0), sites=sites, trades=trades, staff=staff,
        staff_total=total,
    )  # fmt: skip
