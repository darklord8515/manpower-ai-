"""The Action Center: alerts to read, take, assign, snooze and dismiss.

Detectors raise, update and resolve alerts (app/services/alerts); people never resolve one by hand.
Every route declares its permission, and alerts are scoped like the data they describe.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.schemas import (
    AlertDetail,
    AlertList,
    AlertSeverity,
    AlertSummary,
    AlertType,
    AssignBody,
    Assignee,
    BulkBody,
    BulkResult,
    DismissBody,
    RunResult,
    SnoozeBody,
)
from app.services.alerts import service
from app.services.alerts.engine import run_detectors
from app.services.alerts.service import AlertError

router = APIRouter(prefix="/alerts", tags=["alerts"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Reader = Annotated[AuthUser, Depends(require("alert:read"))]
Actor = Annotated[AuthUser, Depends(require("alert:act"))]
Detector = Annotated[AuthUser, Depends(require("alert:detect"))]


def _fail(error: AlertError) -> HTTPException:
    return HTTPException(error.status, error.message)


def _detail(session: Session, user: AuthUser, alert_id: uuid.UUID) -> AlertDetail:
    detail = service.detail(session, user, alert_id)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    return detail


def _audit(
    session: Session, request: Request, user: AuthUser, alert_id: uuid.UUID, done: dict[str, Any]
) -> None:
    write_audit(
        session, request, done["action"], "alert", user, entity_id=alert_id, after=done["after"]
    )


@router.get("")
def list_alerts(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    view: Literal["open", "snoozed", "cleared"] = "open",
    severity: AlertSeverity | None = None,
    kind: Annotated[AlertType | None, Query(alias="type")] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
    mine: bool = False,
    q: Annotated[str, Query(max_length=100)] = "",
) -> AlertList:
    return service.list_alerts(
        session, user, clock.now(), view=view, severity=severity, kind=kind, project=project,
        mine=mine, q=q,
    )  # fmt: skip


@router.get("/summary")
def alert_summary(session: SessionDep, clock: ClockDep, user: Reader) -> AlertSummary:
    """What the bell and the MD/CEO tile show."""
    return service.summary(session, user, clock.now())


@router.get("/assignees")
def alert_assignees(session: SessionDep, user: Actor) -> list[Assignee]:
    return service.assignees(session)


@router.post("/run")
def run_now(
    session: SessionDep, clock: ClockDep, settings: SettingsDep, user: Detector
) -> RunResult:
    """The scheduled run (n8n, 07:00 and 18:00): bring every alert up to date with the data."""
    summary = run_detectors(session, settings, clock, reason="schedule")
    session.commit()
    return RunResult(
        raised=summary.raised, updated=summary.updated, resolved=summary.resolved,
        reopened=summary.reopened, escalated=summary.escalated,
    )  # fmt: skip


@router.post("/bulk")
def bulk_change(
    body: BulkBody, request: Request, session: SessionDep, clock: ClockDep, user: Actor
) -> BulkResult:
    """Snooze or assign several alerts at once. Dismissing is one at a time: each needs a reason."""
    try:
        done = service.bulk(
            session, user, body.ids, body.action, clock.now(), body.until, body.user_id
        )
    except AlertError as error:
        raise _fail(error) from error
    for alert_id, what in done:
        _audit(session, request, user, alert_id, what)
    return BulkResult(changed=len(done))


@router.get("/{alert_id}")
def get_alert(alert_id: uuid.UUID, session: SessionDep, user: Reader) -> AlertDetail:
    return _detail(session, user, alert_id)


@router.post("/{alert_id}/take")
def take_alert(
    alert_id: uuid.UUID, request: Request, session: SessionDep, user: Actor
) -> AlertDetail:
    try:
        done = service.take(session, user, alert_id)
    except AlertError as error:
        raise _fail(error) from error
    _audit(session, request, user, alert_id, done)
    return _detail(session, user, alert_id)


@router.post("/{alert_id}/assign")
def assign_alert(
    alert_id: uuid.UUID, body: AssignBody, request: Request, session: SessionDep, user: Actor
) -> AlertDetail:
    try:
        done = service.assign(session, user, alert_id, body.user_id)
    except AlertError as error:
        raise _fail(error) from error
    _audit(session, request, user, alert_id, done)
    return _detail(session, user, alert_id)


@router.post("/{alert_id}/snooze")
def snooze_alert(
    alert_id: uuid.UUID,
    body: SnoozeBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    user: Actor,
) -> AlertDetail:
    try:
        done = service.snooze(session, user, alert_id, body.until, clock.now())
    except AlertError as error:
        raise _fail(error) from error
    _audit(session, request, user, alert_id, done)
    return _detail(session, user, alert_id)


@router.post("/{alert_id}/dismiss")
def dismiss_alert(
    alert_id: uuid.UUID,
    body: DismissBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    user: Actor,
) -> AlertDetail:
    try:
        done = service.dismiss(session, user, alert_id, body.reason, clock.now())
    except AlertError as error:
        raise _fail(error) from error
    _audit(session, request, user, alert_id, done)
    return _detail(session, user, alert_id)
