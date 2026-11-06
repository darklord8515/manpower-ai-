"""Staffing requests and the Allocation Board.

The HR Executive raises a request and prepares who goes on each line; the HR Manager approves
(nobody approves a request they raised). The rules live in app/services/allocation.py.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.schemas import (
    ApproveBody,
    ApproveResponse,
    CancelBody,
    LineCandidates,
    NewRequest,
    PicksRequest,
    PicksResponse,
    RejectBody,
    RemovePick,
    RequestDetail,
    RequestRow,
    RestorePick,
)
from app.services import allocation
from app.services.allocation import AllocationError, Line

router = APIRouter(prefix="/requests", tags=["requests"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Reader = Annotated[AuthUser, Depends(require("staffing:read"))]
Creator = Annotated[AuthUser, Depends(require("staffing:create"))]
Approver = Annotated[AuthUser, Depends(require("staffing:approve"))]


def _chosen(result: PicksResponse) -> list[str]:
    return [r.code for r in result.results if r.outcome == "chosen"]


def _fail(error: AllocationError) -> HTTPException:
    return HTTPException(error.status, error.message)


def _lines(session: Session, user: AuthUser, request_no: str) -> list[Line]:
    lines = allocation.fetch_lines(session, request_no)
    if not lines or not allocation.visible(user, lines[0].project_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    return lines


def _line(session: Session, user: AuthUser, request_no: str, line_id: uuid.UUID) -> Line:
    for line in _lines(session, user, request_no):
        if line.line_id == line_id:
            return line
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Line not found")


@router.get("")
def list_requests(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    request_status: Annotated[str | None, Query(alias="status", max_length=20)] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
    q: Annotated[str, Query(max_length=100)] = "",
) -> list[RequestRow]:
    where = ["TRUE"]
    params: dict[str, Any] = {}
    scope = user.scope("staffing:read")
    if scope in ("project", "site"):
        where.append("r.project_id = ANY(:scope_projects)")
        params["scope_projects"] = list(user.whole_projects)
    elif scope != "all":
        where.append("FALSE")
    if request_status:
        where.append("r.status::text = :status")
        params["status"] = request_status
    if project:
        where.append("p.code = :project")
        params["project"] = project
    if q.strip():
        where.append(
            """(r.request_no ILIKE :like OR p.name ILIKE :like OR p.code ILIKE :like OR EXISTS (
                 SELECT 1 FROM staffing_request_lines l JOIN trades t ON t.id = l.trade_id
                 WHERE l.request_id = r.id AND t.name ILIKE :like))"""
        )
        params["like"] = f"%{q.strip()}%"
    return allocation.request_rows(session, " AND ".join(where), params, clock.today())


@router.post("", status_code=status.HTTP_201_CREATED)
def raise_request(
    body: NewRequest,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> RequestDetail:
    """Raise a request: one project, the dates, and how many of which trade."""
    today = clock.today()
    if body.needed_from < today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The start date cannot be in the past."
        )
    project = (
        session.execute(
            text("SELECT id, status::text AS status, ends_on FROM projects WHERE code = :c"),
            {"c": body.project},
        )
        .mappings()
        .first()
    )
    if project is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown project: {body.project}"
        )
    scope = user.scope("staffing:create")
    if scope != "all" and project["id"] not in user.whole_projects:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if project["status"] in ("completed", "cancelled"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This project is closed.")
    if body.needed_until and project["ends_on"] and body.needed_until > project["ends_on"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"The project ends on {project['ends_on']:%d %b %Y}; ask for people up to then.",
        )
    trades = {
        r["code"]: r["id"]
        for r in session.execute(
            text("SELECT id, code FROM trades WHERE code = ANY(:codes)"),
            {"codes": [line.trade for line in body.lines]},
        ).mappings()
    }
    unknown = [line.trade for line in body.lines if line.trade not in trades]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown trade: {', '.join(unknown)}"
        )
    request_id: uuid.UUID | None = None
    for _ in range(3):  # two people raising at once could pick the same number
        try:
            request_id = session.execute(
                text(
                    """INSERT INTO staffing_requests
                           (request_no, project_id, requested_by, needed_from, needed_until,
                            priority, status, source_text)
                       SELECT 'SR-' || :year || '-' || lpad(
                                  (coalesce(max(substring(request_no FROM '[0-9]+$')::int), 0)
                                   + 1)::text, 4, '0'),
                              :project, :user, :needed_from, :needed_until, :priority,
                              'submitted', :note
                       FROM staffing_requests
                       WHERE request_no ~ ('^SR-' || :year || '-[0-9]+$')
                       RETURNING id"""
                ),
                {
                    "year": str(today.year), "project": project["id"], "user": user.id,
                    "needed_from": body.needed_from, "needed_until": body.needed_until,
                    "priority": body.priority, "note": body.source_text,
                },
            ).scalar_one()  # fmt: skip
            break
        except IntegrityError:
            session.rollback()
    if request_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another request was raised at the same time. Try again."
        )
    for line in body.lines:
        session.execute(
            text(
                """INSERT INTO staffing_request_lines (request_id, trade_id, headcount, min_level)
                   VALUES (:request, :trade, :headcount, :min_level)"""
            ),
            {"request": request_id, "trade": trades[line.trade], "headcount": line.headcount,
             "min_level": line.min_level},
        )  # fmt: skip
    request_no = session.execute(
        text("SELECT request_no FROM staffing_requests WHERE id = :id"), {"id": request_id}
    ).scalar_one()
    people = sum(line.headcount for line in body.lines)
    approval_id = session.execute(
        text(
            """INSERT INTO approval_requests (subject_type, subject_id, requested_by, summary)
               VALUES ('staffing_request', :id, :user, :summary) RETURNING id"""
        ),
        {"id": request_id, "user": user.id,
         "summary": f"{request_no}: {people} {'person' if people == 1 else 'people'} for "
                    f"{body.project} from {body.needed_from:%d %b %Y}"},
    ).scalar_one()  # fmt: skip
    session.execute(
        text(
            """INSERT INTO approval_steps (approval_id, step_no, role_id)
               SELECT :approval, 1, id FROM roles WHERE code = 'hr_manager'"""
        ),
        {"approval": approval_id},
    )
    write_audit(
        session, request, "request.created", "staffing_request", user, entity_id=request_id,
        after={"request_no": request_no, "project": body.project, "people": people},
    )  # fmt: skip
    detail = allocation.request_detail(session, settings, user, request_no, today)
    assert detail is not None
    return detail


@router.get("/{request_no}")
def get_request(
    request_no: str, session: SessionDep, clock: ClockDep, settings: SettingsDep, user: Reader
) -> RequestDetail:
    detail = allocation.request_detail(session, settings, user, request_no, clock.today())
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    return detail


@router.get("/{request_no}/lines/{line_id}/candidates")
def line_candidates(
    request_no: str,
    line_id: uuid.UUID,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
    q: Annotated[str, Query(max_length=100)] = "",
    min_level: Annotated[int | None, Query(ge=1, le=5)] = None,
    documents_valid: bool = False,
) -> LineCandidates:
    """The people HR could choose for this line, and who is left out and why."""
    line = _line(session, user, request_no, line_id)
    return allocation.candidates(
        session, settings, line, clock.today(), q, min_level, documents_valid
    )


@router.post("/{request_no}/lines/{line_id}/picks")
def add_picks(
    request_no: str,
    line_id: uuid.UUID,
    body: PicksRequest,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> PicksResponse:
    line = _line(session, user, request_no, line_id)
    try:
        result = allocation.add_picks(
            session, settings, user, line, body.employee_codes, clock.today()
        )
    except AllocationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "request.people_chosen", "staffing_request", user,
        entity_id=line.request_id,
        after={"line": line.trade, "chosen": _chosen(result)},
    )  # fmt: skip
    return result


@router.post("/{request_no}/lines/{line_id}/picks/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_pick(
    request_no: str,
    line_id: uuid.UUID,
    body: RemovePick,
    request: Request,
    session: SessionDep,
    user: Creator,
) -> None:
    line = _line(session, user, request_no, line_id)
    try:
        allocation.remove_pick(session, line, body.employee_code, body.reason)
    except AllocationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "request.person_removed", "staffing_request", user,
        entity_id=line.request_id,
        after={"line": line.trade, "person": body.employee_code, "reason": body.reason},
    )  # fmt: skip


@router.post("/{request_no}/lines/{line_id}/picks/restore")
def restore_pick(
    request_no: str,
    line_id: uuid.UUID,
    body: RestorePick,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> PicksResponse:
    line = _line(session, user, request_no, line_id)
    try:
        result = allocation.restore_pick(
            session, settings, user, line, body.employee_code, clock.today()
        )
    except AllocationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "request.person_restored", "staffing_request", user,
        entity_id=line.request_id, after={"line": line.trade, "person": body.employee_code},
    )  # fmt: skip
    return result


@router.post("/{request_no}/lines/{line_id}/suggest")
def suggest_people(
    request_no: str,
    line_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> PicksResponse:
    """Fill the open places with the best cleared people. Rules, not AI."""
    line = _line(session, user, request_no, line_id)
    try:
        result = allocation.suggest(session, settings, user, line, clock.today())
    except AllocationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "request.people_suggested", "staffing_request", user,
        entity_id=line.request_id,
        after={"line": line.trade, "suggested": _chosen(result)},
    )  # fmt: skip
    return result


@router.post("/{request_no}/lines/{line_id}/approve")
def approve_line(
    request_no: str,
    line_id: uuid.UUID,
    body: ApproveBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Approver,
) -> ApproveResponse:
    """Approve the chosen people (or, with preview, show exactly what approving would do)."""
    line = _line(session, user, request_no, line_id)
    try:
        result = allocation.approve_line(
            session, settings, user, line, body.employee_codes, clock.today(), body.preview
        )
    except AllocationError as error:
        raise _fail(error) from error
    if not body.preview and result.ok:
        write_audit(
            session, request, "request.line_approved", "staffing_request", user,
            entity_id=line.request_id,
            after={
                "line": line.trade,
                "people": [p.code for p in result.people],
                "mobilizations": [p.mob_no for p in result.people],
                "request_status": result.request_status_after,
            },
        )  # fmt: skip
    return result


@router.post("/{request_no}/lines/{line_id}/reject")
def reject_line(
    request_no: str,
    line_id: uuid.UUID,
    body: RejectBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Approver,
) -> RequestDetail:
    line = _line(session, user, request_no, line_id)
    try:
        new_status = allocation.reject_line(session, user, line, body.reason, clock.today())
    except AllocationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "request.line_rejected", "staffing_request", user,
        entity_id=line.request_id,
        after={"line": line.trade, "reason": body.reason, "request_status": new_status},
    )  # fmt: skip
    detail = allocation.request_detail(session, settings, user, request_no, clock.today())
    assert detail is not None
    return detail


@router.post("/{request_no}/cancel")
def cancel_request(
    request_no: str,
    body: CancelBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> RequestDetail:
    lines = _lines(session, user, request_no)
    try:
        allocation.cancel_request(session, user, lines, body.reason)
    except AllocationError as error:
        raise _fail(error) from error
    write_audit(
        session, request, "request.cancelled", "staffing_request", user,
        entity_id=lines[0].request_id, after={"reason": body.reason},
    )  # fmt: skip
    detail = allocation.request_detail(session, settings, user, request_no, clock.today())
    assert detail is not None
    return detail
