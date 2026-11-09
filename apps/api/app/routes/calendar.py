"""The calendar: everything with a date in one place, and the leaves and events HR adds by hand.

It reads leaves, project dates, document and contract dates and mobilization days from where they
already live, so it can never disagree with the screens. Only leaves and HR's own events are written
here, by people allowed to edit workers.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile
from app.clock import Clock
from app.db import get_session
from app.labels import document_label
from app.services import holidays
from app.services.alerts.findings import plural

router = APIRouter(prefix="/calendar", tags=["calendar"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Viewer = Annotated[AuthUser, Depends(require("project:read"))]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]
MAX_SPAN_DAYS = 100

KINDS = (
    "leave", "holiday", "project_start", "project_end", "documents", "contract", "leaving",
    "mobilization", "event", "meeting", "deadline",
)  # fmt: skip


class CalendarEntry(BaseModel):
    id: str  # stable within the answer; "event:<uuid>" and "leave:<uuid>" can be changed
    kind: str  # one of KINDS
    title: str
    detail: str | None = None
    starts: date
    ends: date
    href: str | None = None  # the screen with the full story
    editable: bool = False
    expected: bool = False  # a holiday whose dates are not yet announced


class CalendarView(BaseModel):
    start: date
    end: date
    today: date
    can_edit: bool
    entries: list[CalendarEntry]


def _span(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(422, "The end must be on or after the start")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(422, f"Ask for at most {MAX_SPAN_DAYS} days at a time")


@router.get("")
def calendar(  # noqa: C901 - one list of sources, each a short block
    session: SessionDep,
    clock: ClockDep,
    user: Viewer,
    start: Annotated[date, Query()],
    end: Annotated[date, Query()],
) -> CalendarView:
    _span(start, end)
    out: list[CalendarEntry] = []
    for h in holidays.between(start, end):
        out.append(
            CalendarEntry(
                id=f"holiday:{h.starts.isoformat()}",
                kind="holiday",
                title=h.name,
                detail="Usual dates; confirmed when announced" if h.expected else None,
                starts=h.starts,
                ends=h.ends,
                expected=h.expected,
            )  # fmt: skip
        )
    for p in session.execute(
        text(
            """SELECT code, name, starts_on, ends_on FROM projects
               WHERE status NOT IN ('cancelled') AND (starts_on BETWEEN :s AND :e
                                                      OR ends_on BETWEEN :s AND :e)"""
        ),
        {"s": start, "e": end},
    ).mappings():
        for kind, day_, word in (("project_start", p["starts_on"], "starts"),
                                 ("project_end", p["ends_on"], "ends")):  # fmt: skip
            if day_ and start <= day_ <= end:
                out.append(
                    CalendarEntry(
                        id=f"{kind}:{p['code']}",
                        kind=kind,
                        title=f"{p['name']} {word}",
                        detail=p["code"],
                        starts=day_,
                        ends=day_,
                        href=f"/projects/{p['code']}",
                    )  # fmt: skip
                )
    for ev in session.execute(
        text(
            """SELECT id, title, starts_on, ends_on, kind, note FROM calendar_events
               WHERE starts_on <= :e AND ends_on >= :s ORDER BY starts_on"""
        ),
        {"s": start, "e": end},
    ).mappings():
        out.append(
            CalendarEntry(
                id=f"event:{ev['id']}",
                kind=ev["kind"],
                title=ev["title"],
                detail=ev["note"],
                starts=ev["starts_on"],
                ends=ev["ends_on"],
                editable=user.can("employee:write"),
            )  # fmt: skip
        )
    if user.can("employee:read") and full_profile(user):
        scope_sql, params = employee_scope(user, "employee:read")
        for r in session.execute(
            text(
                f"""SELECT l.id, e.employee_code AS code, e.full_name AS name, l.leave_type,
                           lower(l.period) AS first, (upper(l.period) - 1) AS last
                    FROM leave_records l JOIN employees e ON e.id = l.employee_id
                    WHERE l.period && daterange(:s, :e, '[]') AND ({scope_sql})
                    ORDER BY lower(l.period), e.full_name"""  # noqa: S608
            ),
            {**params, "s": start, "e": end},
        ).mappings():
            out.append(
                CalendarEntry(
                    id=f"leave:{r['id']}",
                    kind="leave",
                    title=f"{r['name']} on leave",
                    detail=f"{r['leave_type']} leave · {r['code']}",
                    starts=r["first"],
                    ends=r["last"],
                    href=f"/workers?worker={r['code']}",
                    editable=user.can("employee:write"),
                )  # fmt: skip
            )
        for r in session.execute(
            text(
                f"""SELECT e.employee_code AS code, e.full_name AS name,
                           e.contract_end_on AS contract, e.exit_on AS exit_on
                    FROM employees e WHERE (e.contract_end_on BETWEEN :s AND :e
                                            OR e.exit_on BETWEEN :s AND :e) AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "s": start, "e": end},
        ).mappings():
            for kind, day_, title in (("contract", r["contract"], "contract ends"),
                                      ("leaving", r["exit_on"], "last day")):  # fmt: skip
                if day_ and start <= day_ <= end:
                    out.append(
                        CalendarEntry(
                            id=f"{kind}:{r['code']}",
                            kind=kind,
                            title=f"{r['name']}: {title}",
                            detail=r["code"],
                            starts=day_,
                            ends=day_,
                            href=f"/workers?worker={r['code']}",
                        )  # fmt: skip
                    )
        # Documents are grouped by day so a busy week stays readable: "3 documents run out".
        for r in session.execute(
            text(
                f"""SELECT d.expiry_date AS day_, count(*) AS n,
                           string_agg(DISTINCT d.doc_type::text, ',') AS types
                    FROM employee_documents d JOIN employees e ON e.id = d.employee_id
                    WHERE d.is_current AND d.expiry_date BETWEEN :s AND :e AND ({scope_sql})
                    GROUP BY d.expiry_date ORDER BY d.expiry_date"""  # noqa: S608
            ),
            {**params, "s": start, "e": end},
        ).mappings():
            kinds = ", ".join(sorted({document_label(t) for t in str(r["types"]).split(",")}))
            out.append(
                CalendarEntry(
                    id=f"documents:{r['day_'].isoformat()}",
                    kind="documents",
                    title=f"{plural(int(r['n']), 'document')} run out",
                    detail=kinds,
                    starts=r["day_"],
                    ends=r["day_"],
                    href="/documents",
                )  # fmt: skip
            )
    if user.can("mobilization:read"):
        for r in session.execute(
            text(
                """SELECT m.mob_no, m.report_on, e.full_name AS name FROM mobilizations m
                   JOIN employee_assignments a ON a.id = m.assignment_id
                   JOIN employees e ON e.id = a.employee_id
                   WHERE m.report_on BETWEEN :s AND :e
                     AND m.status NOT IN ('cancelled', 'completed')"""
            ),
            {"s": start, "e": end},
        ).mappings():
            out.append(
                CalendarEntry(
                    id=f"mobilization:{r['mob_no']}",
                    kind="mobilization",
                    title=f"{r['name']} reports to site",
                    detail=r["mob_no"],
                    starts=r["report_on"],
                    ends=r["report_on"],
                    href=f"/mobilization?mob={r['mob_no']}",
                )  # fmt: skip
            )
    out.sort(key=lambda x: (x.starts, x.kind, x.title))
    return CalendarView(
        start=start, end=end, today=clock.today(), can_edit=user.can("employee:write"), entries=out
    )


# ------------------------------------------------------------------------------ what HR adds


class EventBody(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    starts_on: date
    ends_on: date | None = None
    kind: Literal["event", "meeting", "deadline"] = "event"
    note: str | None = Field(default=None, max_length=500)

    @field_validator("title")
    @classmethod
    def _tidy(cls, value: str) -> str:
        return " ".join(value.split())

    @model_validator(mode="after")
    def _order(self) -> EventBody:
        if self.ends_on is not None and self.ends_on < self.starts_on:
            raise ValueError("The event cannot end before it starts")
        return self


@router.post("/events", status_code=status.HTTP_201_CREATED)
def add_event(
    body: EventBody, request: Request, session: SessionDep, user: Writer
) -> CalendarEntry:
    row = session.execute(
        text(
            """INSERT INTO calendar_events (title, starts_on, ends_on, kind, note, created_by)
               VALUES (:t, :s, :e, :k, :n, :u) RETURNING id"""
        ),
        {"t": body.title, "s": body.starts_on, "e": body.ends_on or body.starts_on,
         "k": body.kind, "n": (body.note or "").strip() or None, "u": user.id},
    ).one()  # fmt: skip
    write_audit(
        session, request, "calendar.event_added", "calendar_event", user, entity_id=row.id,
        after={"title": body.title, "starts_on": body.starts_on},
    )  # fmt: skip
    return CalendarEntry(
        id=f"event:{row.id}", kind=body.kind, title=body.title, detail=body.note,
        starts=body.starts_on, ends=body.ends_on or body.starts_on, editable=True,
    )  # fmt: skip


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_event(
    event_id: uuid.UUID, request: Request, session: SessionDep, user: Writer
) -> Response:
    gone = session.execute(
        text("DELETE FROM calendar_events WHERE id = :i RETURNING title"), {"i": event_id}
    ).first()
    if gone is None:
        raise HTTPException(404, "Event not found")
    write_audit(
        session, request, "calendar.event_removed", "calendar_event", user, entity_id=event_id,
        before={"title": gone.title},
    )  # fmt: skip
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class LeaveBody(BaseModel):
    employee_code: str = Field(min_length=1, max_length=20)
    leave_type: Literal["annual", "sick", "emergency", "unpaid"] = "annual"
    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def _order(self) -> LeaveBody:
        if self.ends_on < self.starts_on:
            raise ValueError("The leave cannot end before it starts")
        if (self.ends_on - self.starts_on).days > 120:
            raise ValueError("A leave can be at most 120 days; split it if it is longer")
        return self


@router.post("/leaves", status_code=status.HTTP_201_CREATED)
def add_leave(
    body: LeaveBody, request: Request, session: SessionDep, user: Writer
) -> CalendarEntry:
    scope_sql, params = employee_scope(user, "employee:write")
    worker = (
        session.execute(
            text(
                f"""SELECT e.id, e.full_name FROM employees e
                    WHERE e.employee_code = :code AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": body.employee_code},
        )
        .mappings()
        .first()
    )
    if worker is None:
        raise HTTPException(404, "Worker not found")
    try:
        row = session.execute(
            text(
                """INSERT INTO leave_records (employee_id, leave_type, period, approved)
                   VALUES (:e, :t, daterange(:s, :f, '[]'), true) RETURNING id"""
            ),
            {"e": worker["id"], "t": body.leave_type, "s": body.starts_on, "f": body.ends_on},
        ).one()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            409, f"{worker['full_name']} already has leave that overlaps those dates"
        ) from error
    write_audit(
        session, request, "leave.added", "leave", user, entity_id=row.id,
        after={"employee": body.employee_code, "from": body.starts_on, "to": body.ends_on},
    )  # fmt: skip
    return CalendarEntry(
        id=f"leave:{row.id}", kind="leave", title=f"{worker['full_name']} on leave",
        detail=f"{body.leave_type} leave · {body.employee_code}", starts=body.starts_on,
        ends=body.ends_on, href=f"/workers?worker={body.employee_code}", editable=True,
    )  # fmt: skip


@router.delete("/leaves/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_leave(
    leave_id: uuid.UUID, request: Request, session: SessionDep, user: Writer
) -> Response:
    scope_sql, params = employee_scope(user, "employee:write")
    gone = session.execute(
        text(
            f"""DELETE FROM leave_records l USING employees e
                WHERE l.id = :i AND e.id = l.employee_id AND ({scope_sql}) RETURNING l.id"""  # noqa: S608
        ),
        {**params, "i": leave_id},
    ).first()
    if gone is None:
        raise HTTPException(404, "Leave not found")
    write_audit(session, request, "leave.removed", "leave", user, entity_id=leave_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
