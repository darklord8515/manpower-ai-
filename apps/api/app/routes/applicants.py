"""Applicants (demo data for now): who applied, how well they fit, and the interview invitation.

The match percentage is worked out in services/applicants.py, never by a model. Inviting someone
builds the message here, shows it first on request, and sends it through n8n like every other email.
Applicants are company-wide, so only people whose permission covers everything can use this page.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

import httpx2 as httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import GULF, Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.routes.worker_mail import mail_transport
from app.services import applicants as engine
from app.services import mail
from app.services.alerts.findings import day, plural

router = APIRouter(prefix="/applicants", tags=["applicants"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Reader = Annotated[AuthUser, Depends(require("staffing:read"))]
Writer = Annotated[AuthUser, Depends(require("staffing:create"))]
Transport = Annotated[httpx.BaseTransport | None, Depends(mail_transport)]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ApplicantRow(BaseModel):
    code: str
    name: str
    category: str
    years: int
    nationality: str | None
    location: str | None
    percent: int
    tier: Literal["strong", "good", "partial"]
    status: str


class ApplicantList(BaseModel):
    items: list[ApplicantRow]
    categories: list[str]
    strong: int
    good: int
    summary: str  # worded here, from the counts
    demo: bool = True


class InterviewRow(BaseModel):
    starts_at: datetime
    mode: str
    venue: str
    sent_to: str
    delivered: bool


class ApplicantDetail(ApplicantRow):
    email: str | None
    skills: list[str]
    summary: str | None
    documents_ready: bool
    available_from: date | None
    matched: list[str]
    missing: list[str]
    reasons: list[str]
    interviews: list[InterviewRow]
    can_invite: bool
    demo: bool = True


class InterviewBody(BaseModel):
    day: date
    at: time
    mode: Literal["online", "offline"]
    venue: str = Field(min_length=3, max_length=300)  # a link for online, an address for offline
    note: str | None = Field(default=None, max_length=600)
    send_to: str | None = Field(default=None, max_length=200)


class InterviewPreview(BaseModel):
    to: str
    subject: str
    body: str


class InterviewSent(InterviewPreview):
    sent: bool = True


def _scoped(user: AuthUser) -> None:
    if user.scope("staffing:read") != "all":
        raise HTTPException(403, "Applicants are open to HR and the MD, not project teams.")


def _match(row: dict[str, object], today: date) -> engine.Match:
    return engine.score(
        str(row["category"]), int(row["years_experience"]), list(row["skills"]),  # type: ignore[arg-type]
        bool(row["documents_ready"]), row["available_from"],  # type: ignore[arg-type]
        today,
    )  # fmt: skip


def _row(row: dict[str, object], match: engine.Match) -> ApplicantRow:
    return ApplicantRow(
        code=str(row["code"]), name=str(row["full_name"]), category=str(row["category"]),
        years=int(row["years_experience"]), nationality=row["nationality"],  # type: ignore[arg-type]
        location=row["location"], percent=match.percent, tier=match.tier,  # type: ignore[arg-type]
        status=str(row["status"]),
    )  # fmt: skip


@router.get("")
def list_applicants(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    category: Annotated[str, Query(max_length=40)] = "",
    min_match: Annotated[int, Query(ge=0, le=100)] = 0,
) -> ApplicantList:
    _scoped(user)
    today = clock.today()
    rows = [
        dict(r)
        for r in session.execute(text("SELECT * FROM applicants ORDER BY full_name")).mappings()
    ]
    scored = sorted(
        ((r, _match(r, today)) for r in rows),
        key=lambda pair: (-pair[1].percent, pair[0]["full_name"]),
    )
    shown = [
        _row(r, m)
        for r, m in scored
        if (not category or r["category"] == category) and m.percent >= min_match
    ]
    strong = sum(1 for _, m in scored if m.tier == "strong")
    good = sum(1 for _, m in scored if m.tier == "good")
    summary = (
        f"{plural(strong, 'applicant')} match at 90% or more and "
        f"{plural(good, 'applicant')} at 80% to 89%, out of {len(scored)}."
    )
    return ApplicantList(
        items=shown, categories=sorted({str(r["category"]) for r in rows}),
        strong=strong, good=good, summary=summary,
    )  # fmt: skip


def _load(session: Session, code: str) -> dict[str, object]:
    row = (
        session.execute(text("SELECT * FROM applicants WHERE code = :c"), {"c": code})
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Applicant not found")
    return dict(row)


@router.get("/{code}")
def get_applicant(code: str, session: SessionDep, clock: ClockDep, user: Reader) -> ApplicantDetail:
    _scoped(user)
    row = _load(session, code)
    match = _match(row, clock.today())
    interviews = [
        InterviewRow(
            starts_at=i["starts_at"],
            mode=i["mode"],
            venue=i["venue"],
            sent_to=i["sent_to"],
            delivered=i["delivered"],
        )  # fmt: skip
        for i in session.execute(
            text(
                """SELECT starts_at, mode, venue, sent_to, delivered FROM applicant_interviews
                   WHERE applicant_id = :a ORDER BY created_at DESC"""
            ),
            {"a": row["id"]},
        ).mappings()
    ]
    return ApplicantDetail(
        **_row(row, match).model_dump(), email=row["email"], skills=list(row["skills"]),  # type: ignore[arg-type]
        summary=row["summary"], documents_ready=bool(row["documents_ready"]),  # type: ignore[arg-type]
        available_from=row["available_from"], matched=match.matched, missing=match.missing,  # type: ignore[arg-type]
        reasons=match.reasons, interviews=interviews, can_invite=user.can("staffing:create"),
    )  # fmt: skip


def _compose(
    session: Session, clock: Clock, user: AuthUser, code: str, body: InterviewBody
) -> tuple[dict[str, object], datetime, InterviewPreview]:
    row = _load(session, code)
    to = (body.send_to or str(row["email"] or "")).strip()
    if not to or not _EMAIL.match(to):
        raise HTTPException(422, "Add a valid email address to send the invitation to.")
    starts = datetime.combine(body.day, body.at, tzinfo=GULF)
    if starts <= clock.now():
        raise HTTPException(422, "Choose a time in the future for the interview.")
    if body.mode == "online" and not body.venue.strip().lower().startswith("http"):
        raise HTTPException(422, "For an online interview, paste the meeting link (https://...).")
    when = f"{day(body.day)} at {body.at:%H:%M}"
    subject, text_body = mail.interview(
        str(row["full_name"]).split()[0],
        user.full_name,
        str(row["category"]),
        when,
        body.mode,
        body.venue.strip(),
        body.note,
    )
    return row, starts, InterviewPreview(to=to, subject=subject, body=text_body)


@router.post("/{code}/interview/preview")
def preview_interview(
    code: str, body: InterviewBody, session: SessionDep, clock: ClockDep, user: Writer
) -> InterviewPreview:
    _scoped(user)
    return _compose(session, clock, user, code, body)[2]


@router.post("/{code}/interview")
def invite(
    code: str,
    body: InterviewBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
    transport: Transport,
) -> InterviewSent:
    _scoped(user)
    row, starts, preview = _compose(session, clock, user, code, body)
    delivered = True
    failure: str | None = None
    try:
        mail.deliver(
            settings, mail.Message(preview.to, preview.subject, preview.body), user.full_name,
            transport,
        )  # fmt: skip
    except mail.MailError as error:
        delivered, failure = False, str(error)
    session.execute(
        text(
            """INSERT INTO applicant_interviews
                   (applicant_id, starts_at, mode, venue, note, sent_to, sent_by, delivered)
               VALUES (:a, :s, :m, :v, :n, :to, :by, :d)"""
        ),
        {"a": row["id"], "s": starts, "m": body.mode, "v": body.venue.strip(), "n": body.note,
         "to": preview.to, "by": user.id, "d": delivered},
    )  # fmt: skip
    if delivered:
        session.execute(
            text("UPDATE applicants SET status = 'interview_sent' WHERE id = :a"), {"a": row["id"]}
        )
    write_audit(
        session, request, "applicant.interview_sent" if delivered else "applicant.interview_failed",
        "applicant", user, entity_id=uuid.UUID(str(row["id"])),
        after={"to": preview.to, "at": starts.isoformat(), "mode": body.mode},
    )  # fmt: skip
    if failure is not None:
        raise HTTPException(502, failure)
    return InterviewSent(**preview.model_dump())


class StatusBody(BaseModel):
    status: Literal["new", "shortlisted", "rejected"]


@router.post("/{code}/status")
def set_status(
    code: str, body: StatusBody, request: Request, session: SessionDep, clock: ClockDep,
    user: Writer,
) -> ApplicantDetail:  # fmt: skip
    _scoped(user)
    row = _load(session, code)
    session.execute(
        text("UPDATE applicants SET status = :s WHERE id = :a"), {"s": body.status, "a": row["id"]}
    )
    write_audit(
        session, request, "applicant.status", "applicant", user,
        entity_id=uuid.UUID(str(row["id"])), before={"status": row["status"]},
        after={"status": body.status},
    )  # fmt: skip
    return get_applicant(code, session, clock, user)
