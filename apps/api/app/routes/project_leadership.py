"""A project's lead and key roles, its Excel lists, and mailing them to the lead in one click.

Who may do what: anyone who can read the project sees the leadership; assigning a lead, adding the
suggested roles and sending an email need `project:write` (HR). Every number and date comes from
services/leadership.py and the forecast; the email goes to the lead HR has saved, never to an
address typed into the request, and is shown first. No document or phone number is ever in a file or
a message.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Annotated, Any, Literal

import httpx2 as httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.exports import XLSX_TYPE, xlsx_bytes, xlsx_download
from app.routes import project_overview
from app.routes.projects import _projects  # pyright: ignore[reportPrivateUsage]
from app.routes.worker_mail import mail_transport
from app.services import leadership, mail
from app.services.alerts.findings import day
from app.services.forecast import ForecastError, forecast_project

router = APIRouter(tags=["projects"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Reader = Annotated[AuthUser, Depends(require("project:read"))]
Writer = Annotated[AuthUser, Depends(require("project:write"))]
Transport = Annotated[httpx.BaseTransport | None, Depends(mail_transport)]


class LeadPerson(BaseModel):
    code: str
    name: str
    email: str | None


class LeadCandidate(BaseModel):
    code: str
    name: str
    level: int | None
    busy_on: str | None
    busy_until: date | None


class KeyRoleRow(BaseModel):
    trade: str
    recommended: int
    planned: int
    people_free: int
    missing: int


class Leadership(BaseModel):
    lead: LeadPerson | None
    free: list[LeadCandidate]
    busy: list[LeadCandidate]
    advice: str
    crew: int
    key_roles: list[KeyRoleRow]
    can_edit: bool


class AssignLead(BaseModel):
    employee_code: str = Field(min_length=3, max_length=20)


class KeyRolesAdded(BaseModel):
    added: list[str]
    leadership: Leadership


EmailKind = Literal["staff", "recruitment"]


class EmailBody(BaseModel):
    kind: EmailKind


class EmailPreview(BaseModel):
    to: str
    to_name: str
    subject: str
    body: str
    attachment: str
    rows: int


class EmailSent(EmailPreview):
    sent: bool = True


def _head(session: Session, user: AuthUser, code: str) -> Any:
    if not any(p.code == code for p in _projects(session, user)):
        raise HTTPException(404, "Project not found")
    return (
        session.execute(
            text(
                """SELECT id, code, name, starts_on, ends_on, lead_employee_id
                   FROM projects WHERE code = :code"""
            ),
            {"code": code},
        )
        .mappings()
        .one()
    )


def _lead(session: Session, head: Any) -> LeadPerson | None:
    if head["lead_employee_id"] is None:
        return None
    r = (
        session.execute(
            text("SELECT employee_code, full_name, email FROM employees WHERE id = :e"),
            {"e": head["lead_employee_id"]},
        )
        .mappings()
        .first()
    )
    return (
        None
        if r is None
        else LeadPerson(code=r["employee_code"], name=r["full_name"], email=r["email"])
    )


def _view(
    session: Session, user: AuthUser, settings: Settings, clock: Clock, head: Any
) -> Leadership:
    options = leadership.lead_options(
        session, head, clock.today(), settings.recruit_lead_days_local,
        settings.recruit_lead_days_overseas,
    )  # fmt: skip
    crew = leadership.crew_of(session, head["id"])

    def person(c: leadership.Candidate) -> LeadCandidate:
        return LeadCandidate(
            code=c.code, name=c.name, level=c.level, busy_on=c.busy_on, busy_until=c.busy_until
        )

    roles = [
        KeyRoleRow(
            trade=k.trade,
            recommended=k.recommended,
            planned=k.planned,
            people_free=k.people_free,
            missing=max(k.recommended - k.planned, 0),
        )  # fmt: skip
        for k in leadership.key_roles(session, head["id"])
    ]
    return Leadership(
        lead=_lead(session, head), free=[person(c) for c in options.free],
        busy=[person(c) for c in options.busy], advice=options.advice, crew=crew,
        key_roles=roles, can_edit=user.can("project:write"),
    )  # fmt: skip


@router.get("/projects/{code}/leadership")
def get_leadership(
    code: str, session: SessionDep, clock: ClockDep, settings: SettingsDep, user: Reader
) -> Leadership:
    return _view(session, user, settings, clock, _head(session, user, code))


@router.put("/projects/{code}/lead")
def assign_lead(
    code: str,
    body: AssignLead,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
) -> Leadership:
    head = _head(session, user, code)
    wanted = body.employee_code.strip().upper()
    options = leadership.lead_options(
        session, head, clock.today(), settings.recruit_lead_days_local,
        settings.recruit_lead_days_overseas,
    )  # fmt: skip
    current = _lead(session, head)
    if current is None or current.code != wanted:
        busy = next((c for c in options.busy if c.code == wanted), None)
        if busy is not None:
            until = f" until {day(busy.busy_until)}" if busy.busy_until else ""
            raise HTTPException(
                409,
                f"{busy.name} already leads {busy.busy_on}{until}, which overlaps this project. "
                "Choose someone who is free, or change that project's lead first.",
            )
        if not any(c.code == wanted for c in options.free):
            raise HTTPException(
                422, f"{wanted} is not a project manager who can lead this project."
            )
    row = session.execute(
        text("SELECT id FROM employees WHERE employee_code = :c"), {"c": wanted}
    ).one()
    session.execute(
        text("UPDATE projects SET lead_employee_id = :e WHERE id = :p"),
        {"e": row.id, "p": head["id"]},
    )
    write_audit(
        session, request, "project.lead_assigned", "project", user, entity_id=head["id"],
        before={"lead": current.code if current else None}, after={"lead": wanted},
    )  # fmt: skip
    return _view(session, user, settings, clock, _head(session, user, code))


@router.delete("/projects/{code}/lead")
def clear_lead(
    code: str,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
) -> Leadership:
    head = _head(session, user, code)
    current = _lead(session, head)
    session.execute(
        text("UPDATE projects SET lead_employee_id = NULL WHERE id = :p"), {"p": head["id"]}
    )
    write_audit(
        session, request, "project.lead_cleared", "project", user, entity_id=head["id"],
        before={"lead": current.code if current else None},
    )  # fmt: skip
    return _view(session, user, settings, clock, _head(session, user, code))


@router.post("/projects/{code}/key-roles/add")
def add_key_roles(
    code: str,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
) -> KeyRolesAdded:
    """Put the suggested key roles into the project's plan, so the forecast covers them."""
    head = _head(session, user, code)
    if head["starts_on"] is None or head["ends_on"] is None:
        raise HTTPException(422, "Set the project's start and end dates first.")
    added: list[str] = []
    for role in leadership.key_roles(session, head["id"]):
        missing = role.recommended - role.planned
        if missing <= 0:
            continue
        session.execute(
            text(
                """INSERT INTO manpower_requirements (project_id, trade_id, headcount, period)
                   SELECT :p, t.id, :n, daterange(:s, :e, '[]') FROM trades t WHERE t.name = :t"""
            ),
            {
                "p": head["id"],
                "n": missing,
                "s": head["starts_on"],
                "e": head["ends_on"],
                "t": role.trade,
            },
        )
        added.append(f"{missing} {role.trade}")
    if added:
        write_audit(
            session, request, "project.key_roles_added", "project", user, entity_id=head["id"],
            after={"added": added},
        )  # fmt: skip
    else:
        session.commit()
    return KeyRolesAdded(
        added=added, leadership=_view(session, user, settings, clock, _head(session, user, code))
    )


# ------------------------------------------------------------------------------------ Excel


def _staff_sheets(
    session: Session, clock: Clock, user: AuthUser, head: Any, code: str
) -> tuple[list[Any], int]:
    if not user.can("employee:read"):
        raise HTTPException(403, "Your role cannot read the people on a project.")
    overview = project_overview.project_overview(code, session, clock, user)
    lead = _lead(session, head)
    info = [
        ("Project", f"{overview.code} {overview.name}"),
        ("Status", overview.status),
        ("Starts", day(overview.starts) if overview.starts else ""),
        ("Ends", day(overview.ends) if overview.ends else ""),
        ("Project lead", lead.name if lead else "Not assigned"),
        ("People planned or deployed", overview.staff_total),
        ("Made on", day(clock.today())),
    ]
    people = [
        [
            p.code,
            p.name,
            p.trade,
            p.level,
            (p.status or "").replace("_", " "),
            p.site,
            p.starts,
            p.ends,
        ]
        for p in overview.staff
    ]
    sheets = [
        ("Project", ["", ""], info),
        ("People", ["Code", "Name", "Trade", "Level", "Status", "Site", "Starts", "Ends"], people),
    ]
    return sheets, overview.staff_total


def _recruitment_sheets(
    session: Session, clock: Clock, user: AuthUser, settings: Settings, code: str
) -> tuple[list[Any], list[str]]:
    try:
        forecast = forecast_project(session, user, settings, code, clock.today())
    except ForecastError as error:
        raise HTTPException(422, str(error)) from error
    if forecast is None:
        raise HTTPException(404, "Project not found")
    rows: list[list[object]] = []
    lines: list[str] = []
    for t in forecast.trades:
        a = t.advice
        rows.append(
            [t.trade, t.needed, t.already_assigned, t.deployable, t.gap, a.recruit_count,
             a.recruit_by, a.recruit_by_overseas, a.headline]
        )  # fmt: skip
        if a.recruit_count > 0 and a.recruit_by and a.recruit_by_overseas:
            lines.append(
                f"{a.recruit_count} {t.trade}: locally by {day(a.recruit_by)}, or overseas by "
                f"{day(a.recruit_by_overseas)}"
            )
    header = ["Trade", "Needed", "Already assigned", "Free now", "Short", "To recruit",
              "Locally by", "Overseas by", "Advice"]  # fmt: skip
    return [("Recruitment", header, rows)], lines


def _filename(code: str, what: str, today: date) -> str:
    return f"{code}-{what}-{today:%Y-%m-%d}.xlsx"


@router.get("/projects/{code}/staff.xlsx")
def download_staff(code: str, session: SessionDep, clock: ClockDep, user: Reader) -> Response:
    head = _head(session, user, code)
    sheets, _ = _staff_sheets(session, clock, user, head, code)
    return xlsx_download(_filename(code, "people", clock.today()), sheets)


@router.get("/projects/{code}/recruitment.xlsx")
def download_recruitment(
    code: str, session: SessionDep, clock: ClockDep, settings: SettingsDep, user: Reader
) -> Response:
    _head(session, user, code)
    if not user.can("forecast:read"):
        raise HTTPException(403, "Your role cannot read the forecast.")
    sheets, _ = _recruitment_sheets(session, clock, user, settings, code)
    return xlsx_download(_filename(code, "recruitment", clock.today()), sheets)


# ----------------------------------------------------------------------------------- email


def _compose(
    session: Session, clock: Clock, user: AuthUser, settings: Settings, code: str, kind: EmailKind
) -> tuple[Any, EmailPreview, bytes, str]:
    head = _head(session, user, code)
    lead = _lead(session, head)
    if lead is None:
        raise HTTPException(422, "Assign a project lead first: the list goes to them.")
    if not lead.email:
        raise HTTPException(
            422, f"{lead.name} has no email address. Add it with Edit details on their profile."
        )
    first = lead.name.split()[0]
    project = f"{head['code']} {head['name']}"
    if kind == "staff":
        sheets, count = _staff_sheets(session, clock, user, head, code)
        dates = (
            f"{day(head['starts_on'])} to {day(head['ends_on'])}"
            if head["starts_on"] and head["ends_on"]
            else "dates not set"
        )
        if count == 0:
            raise HTTPException(422, "Nobody is planned or deployed on this project yet.")
        subject, body = mail.project_staff(first, user.full_name, project, dates, count)
        name, rows = _filename(code, "people", clock.today()), count
        data = xlsx_bytes(sheets)
    else:
        if not user.can("forecast:read"):
            raise HTTPException(403, "Your role cannot read the forecast.")
        sheets, lines = _recruitment_sheets(session, clock, user, settings, code)
        if not lines:
            raise HTTPException(422, "Nothing needs recruiting for this project right now.")
        subject, body = mail.recruitment_needs(first, user.full_name, project, lines)
        name, rows = _filename(code, "recruitment", clock.today()), len(lines)
        data = xlsx_bytes(sheets)
    preview = EmailPreview(
        to=lead.email, to_name=lead.name, subject=subject, body=body, attachment=name, rows=rows
    )
    return head, preview, data, lead.code


@router.post("/projects/{code}/email/preview")
def preview_email(
    code: str, body: EmailBody, session: SessionDep, clock: ClockDep, settings: SettingsDep,
    user: Writer,
) -> EmailPreview:  # fmt: skip
    """What would be sent, and to whom. Nothing is sent."""
    return _compose(session, clock, user, settings, code, body.kind)[1]


@router.post("/projects/{code}/email")
def send_email(
    code: str,
    body: EmailBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
    transport: Transport,
) -> EmailSent:
    head, preview, data, lead_code = _compose(session, clock, user, settings, code, body.kind)
    event = "project.staff_list" if body.kind == "staff" else "project.recruitment_list"
    payload = json.dumps(
        {"to": preview.to, "subject": preview.subject, "by": user.full_name,
         "attachment": preview.attachment, "project": head["code"]}
    )  # fmt: skip
    lead_id = session.execute(
        text("SELECT id FROM employees WHERE employee_code = :c"), {"c": lead_code}
    ).scalar_one()
    try:
        mail.deliver(
            settings, mail.Message(preview.to, preview.subject, preview.body), user.full_name,
            transport, attachment=(preview.attachment, data, XLSX_TYPE),
        )  # fmt: skip
    except mail.MailError as error:
        session.execute(
            text(
                """INSERT INTO notifications (employee_id, channel, event, payload, delivered)
                   VALUES (:e, 'email', :event, CAST(:p AS jsonb), false)"""
            ),
            {"e": lead_id, "event": event, "p": payload},
        )
        session.commit()
        raise HTTPException(502, str(error)) from error
    session.execute(
        text(
            """INSERT INTO notifications (employee_id, channel, event, payload, sent_at, delivered)
               VALUES (:e, 'email', :event, CAST(:p AS jsonb), now(), true)"""
        ),
        {"e": lead_id, "event": event, "p": payload},
    )
    write_audit(
        session, request, "project.emailed", "project", user, entity_id=head["id"],
        after={"kind": body.kind, "to_lead": lead_code, "file": preview.attachment},
    )  # fmt: skip
    return EmailSent(**preview.model_dump())
