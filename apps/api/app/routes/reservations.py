"""Reserve people for a project, and release them again.

A reservation is a `planned` assignment. It is the only thing that holds a person for a project:
the forecast itself holds nobody. Before anything is written, the same forecast HR is looking at
decides who is allowed, so the screen and the rules cannot disagree. The database adds a last
guard: nobody can hold two live assignments that overlap.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.schemas import (
    ReleaseRequest,
    ReleaseResult,
    ReserveRequest,
    ReserveResponse,
    ReserveResult,
)
from app.services.alerts.engine import run_after_change
from app.services.assignments import plan_assignment
from app.services.forecast import ForecastError, forecast_project

router = APIRouter(tags=["reservations"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Approver = Annotated[AuthUser, Depends(require("assignment:approve"))]


@router.post("/projects/{code}/reserve")
def reserve_people(
    code: str,
    body: ReserveRequest,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Approver,
) -> ReserveResponse:
    """Plan the chosen people onto the project. Each person is checked on their own."""
    try:
        forecast = forecast_project(session, user, settings, code, clock.today(), body.start)
    except ForecastError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error
    if forecast is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if forecast.project.status in ("completed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is closed.")
    trade = next((t for t in forecast.trades if t.trade_code == body.trade), None)
    if trade is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "This project does not need that trade."
        )

    # Who the forecast would let in, and why it turns the others away.
    allowed: dict[str, tuple[str | None, date | None]] = {}  # code -> (from project, last day)
    names: dict[str, str] = {}
    for source in trade.sources:
        for worker in source.workers:
            allowed[worker.code] = (source.project_code, source.ends_on)
            names[worker.code] = worker.name
    for late in trade.late_candidates:
        allowed[late.code] = (late.project_code, late.ends_on)
        names[late.code] = late.name
    refused_why = {e.code: e.detail for e in trade.excluded}
    for e in trade.excluded:
        names[e.code] = e.name
    already_here = {r.code for r in trade.reserved}

    project = (
        session.execute(text("SELECT id, ends_on FROM projects WHERE code = :code"), {"code": code})
        .mappings()
        .one()
    )
    last_exclusive = project["ends_on"] + timedelta(days=1) if project["ends_on"] else None

    results: list[ReserveResult] = []
    for employee_code in body.employee_codes:
        name = names.get(employee_code)
        if employee_code in already_here:
            results.append(
                ReserveResult(
                    code=employee_code, name=name or employee_code, outcome="refused",
                    reason="Already planned on this project.",
                )
            )  # fmt: skip
            continue
        if employee_code not in allowed:
            results.append(
                ReserveResult(
                    code=employee_code, name=name or employee_code, outcome="refused",
                    reason=refused_why.get(employee_code, "Not available for this project."),
                )
            )  # fmt: skip
            continue
        from_project, ends_on = allowed[employee_code]
        first_day = max(forecast.start, ends_on + timedelta(days=1)) if ends_on else forecast.start
        try:
            with session.begin_nested():
                plan_assignment(
                    session,
                    employee_code=employee_code,
                    project_id=project["id"],
                    first_day=first_day,
                    last_exclusive=last_exclusive,
                    approver_id=user.id,
                    from_project=from_project,
                    after_last=ends_on + timedelta(days=1) if ends_on else None,
                )
        except IntegrityError:
            results.append(
                ReserveResult(
                    code=employee_code, name=name or employee_code, outcome="refused",
                    reason="Already planned on another project for these dates.",
                )
            )  # fmt: skip
            continue
        results.append(
            ReserveResult(
                code=employee_code, name=name or employee_code, outcome="reserved", reason=None,
                starts_on=first_day, moving_from=from_project, moving_from_ends=ends_on,
            )
        )  # fmt: skip

    reserved = [r.code for r in results if r.outcome == "reserved"]
    write_audit(
        session, request, "project.people_reserved", "project", user, entity_id=project["id"],
        after={
            "trade": body.trade, "reserved": reserved,
            "refused": {r.code: r.reason for r in results if r.outcome == "refused"},
        },
    )  # fmt: skip
    run_after_change(session, settings, clock)
    return ReserveResponse(results=results, reserved=len(reserved))


@router.post("/projects/{code}/release")
def release_people(
    code: str,
    body: ReleaseRequest,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Approver,
) -> ReleaseResult:
    """Undo a reservation. The row is kept as `cancelled`, so the history stays."""
    try:
        forecast = forecast_project(session, user, settings, code, clock.today())
    except ForecastError:
        forecast = None
    visible = (
        session.execute(
            text("SELECT id, status::text AS status FROM projects WHERE code = :c"), {"c": code}
        )
        .mappings()
        .first()
    )
    if visible is None or (forecast is None and user.scope("forecast:read") != "all"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    released = [
        str(r[0])
        for r in session.execute(
            text(
                """UPDATE employee_assignments a SET status = 'cancelled'
                   FROM employees e
                   WHERE e.id = a.employee_id AND a.project_id = :pid AND a.status = 'planned'
                     AND e.employee_code = ANY(:codes)
                   RETURNING e.employee_code"""
            ),
            {"pid": visible["id"], "codes": body.employee_codes},
        )
    ]
    write_audit(
        session, request, "project.reservation_released", "project", user,
        entity_id=visible["id"], after={"released": released},
    )  # fmt: skip
    run_after_change(session, settings, clock)
    return ReleaseResult(
        released=released, not_found=[c for c in body.employee_codes if c not in released]
    )
