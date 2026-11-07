"""Mobilization: the pipeline of people being mobilized and each person's checklist.

HR ticks tasks off and confirms arrival for every department (the MVP has no Operations or Site
logins). The rules live in app/services/mobilization.py.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.db import get_session
from app.schemas import MobilizationDetail, MobilizationList
from app.services import mobilization
from app.services.mobilization import MobilizationError

router = APIRouter(prefix="/mobilizations", tags=["mobilizations"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Reader = Annotated[AuthUser, Depends(require("mobilization:read"))]
Updater = Annotated[AuthUser, Depends(require("mobilization:update"))]
Arrivals = Annotated[AuthUser, Depends(require("assignment:confirm_arrival"))]


def _fail(error: MobilizationError) -> HTTPException:
    return HTTPException(error.status, error.message)


@router.get("")
def list_mobilizations(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    q: Annotated[str, Query(max_length=100)] = "",
    project: Annotated[str, Query(max_length=20)] = "",
    overdue: bool = False,
) -> MobilizationList:
    return mobilization.mobilization_rows(
        session, user, clock.today(), q=q, project=project, overdue_only=overdue
    )


@router.get("/{mob_no}")
def get_mobilization(
    mob_no: str, session: SessionDep, clock: ClockDep, user: Reader
) -> MobilizationDetail:
    detail = mobilization.mobilization_detail(session, user, mob_no, clock.today())
    if detail is None:  # also when it belongs to someone outside the caller's scope
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mobilization not found")
    return detail


def _tick(
    mob_no: str,
    task_id: uuid.UUID,
    request: Request,
    session: Session,
    clock: Clock,
    user: AuthUser,
    *,
    done: bool,
) -> MobilizationDetail:
    try:
        detail, changed = mobilization.set_task(
            session, user, clock.today(), mob_no, task_id, done=done
        )
    except MobilizationError as error:
        raise _fail(error) from error
    if changed:
        task = next(t for t in detail.tasks if t.id == task_id)
        write_audit(
            session, request,
            "mobilization.task_done" if done else "mobilization.task_reopened",
            "mobilization", user,
            after={
                "mob_no": mob_no, "task": task.title, "worker": detail.worker_code,
                "tasks_done": detail.tasks_done, "tasks_total": detail.tasks_total,
            },
        )  # fmt: skip
    return detail


@router.post("/{mob_no}/tasks/{task_id}/done")
def mark_task_done(
    mob_no: str,
    task_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    user: Updater,
) -> MobilizationDetail:
    return _tick(mob_no, task_id, request, session, clock, user, done=True)


@router.post("/{mob_no}/tasks/{task_id}/reopen")
def reopen_task(
    mob_no: str,
    task_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    user: Updater,
) -> MobilizationDetail:
    return _tick(mob_no, task_id, request, session, clock, user, done=False)


@router.post("/{mob_no}/arrival")
def confirm_arrival(
    mob_no: str, request: Request, session: SessionDep, clock: ClockDep, user: Arrivals
) -> MobilizationDetail:
    try:
        detail = mobilization.confirm_arrival(session, user, clock.today(), mob_no)
    except MobilizationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "mobilization.arrival_confirmed", "mobilization", user,
        after={"mob_no": mob_no, "worker": detail.worker_code, "project": detail.project_code},
    )  # fmt: skip
    return detail
