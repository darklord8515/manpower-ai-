"""HR writes to a worker from the profile: a document-renewal request, or their own words.

The message is built here (the recipient is the address HR keeps on the worker, never one typed into
the request), shown to HR first on request, and handed to n8n to send. Every send is logged against
the worker and in the audit log.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

import httpx2 as httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.services import mail

router = APIRouter(prefix="/workers", tags=["workers"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]
RENEWAL_WINDOW_DAYS = 90


def mail_transport() -> httpx.BaseTransport | None:
    """The way to reach n8n. Tests replace it with a canned one."""
    return None


class EmailBody(BaseModel):
    template: Literal["document_renewal", "custom"]
    subject: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=1500)

    @model_validator(mode="after")
    def _custom_needs_words(self) -> EmailBody:
        if self.template == "custom" and not (self.subject or "").strip():
            raise ValueError("Add a subject")
        if self.template == "custom" and not (self.message or "").strip():
            raise ValueError("Write the message")
        return self


class EmailPreview(BaseModel):
    to: str
    subject: str
    body: str


class EmailSent(EmailPreview):
    sent: bool = True


def _compose(
    session: Session, clock: Clock, user: AuthUser, code: str, body: EmailBody
) -> tuple[str, EmailPreview]:
    scope_sql, params = employee_scope(user, "employee:write")
    worker = (
        session.execute(
            text(
                f"""SELECT e.id, e.full_name, e.email FROM employees e
                    WHERE e.employee_code = :code AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": code},
        )
        .mappings()
        .first()
    )
    if worker is None:
        raise HTTPException(404, "Worker not found")
    if not worker["email"]:
        raise HTTPException(
            422, f"{worker['full_name']} has no email address. Add it with Edit details first."
        )
    first = str(worker["full_name"]).split()[0]
    if body.template == "document_renewal":
        today: date = clock.today()
        documents = [
            {"type": r["type"], "expiry": r["expiry"]}
            for r in session.execute(
                text(
                    """SELECT d.doc_type::text AS type, d.expiry_date AS expiry
                       FROM employee_documents d
                       WHERE d.employee_id = :e AND d.is_current AND d.expiry_date IS NOT NULL
                         AND d.expiry_date <= :until ORDER BY d.expiry_date"""
                ),
                {"e": worker["id"], "until": today + timedelta(days=RENEWAL_WINDOW_DAYS)},
            ).mappings()
        ]
        if not documents:
            raise HTTPException(
                422,
                f"None of {worker['full_name']}'s documents run out in the next "
                f"{RENEWAL_WINDOW_DAYS} days. Write your own message instead.",
            )
        subject, text_body = mail.renewal(first, user.full_name, documents, today)
    else:
        subject, text_body = mail.custom(
            first, user.full_name, body.subject or "", body.message or ""
        )
    return str(worker["id"]), EmailPreview(to=worker["email"], subject=subject, body=text_body)


@router.post("/{code}/email/preview")
def preview_email(
    code: str, body: EmailBody, session: SessionDep, clock: ClockDep, user: Writer
) -> EmailPreview:
    """What would be sent, word for word. Nothing is sent."""
    return _compose(session, clock, user, code, body)[1]


@router.post("/{code}/email")
def send_email(
    code: str,
    body: EmailBody,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
    transport: Annotated[httpx.BaseTransport | None, Depends(mail_transport)],
) -> EmailSent:
    """Send it. The result says plainly whether the mail account accepted it."""
    employee_id, preview = _compose(session, clock, user, code, body)
    event = "document.renewal_request" if body.template == "document_renewal" else "hr.message"
    payload = json.dumps({"to": preview.to, "subject": preview.subject, "by": user.full_name})
    try:
        mail.deliver(
            settings,
            mail.Message(preview.to, preview.subject, preview.body),
            user.full_name,
            transport,
        )
    except mail.MailError as error:
        session.execute(
            text(
                """INSERT INTO notifications (employee_id, channel, event, payload, delivered)
                   VALUES (:e, 'email', :event, CAST(:p AS jsonb), false)"""
            ),
            {"e": employee_id, "event": event, "p": payload},
        )
        session.commit()
        raise HTTPException(502, str(error)) from error
    session.execute(
        text(
            """INSERT INTO notifications (employee_id, channel, event, payload, sent_at, delivered)
               VALUES (:e, 'email', :event, CAST(:p AS jsonb), now(), true)"""
        ),
        {"e": employee_id, "event": event, "p": payload},
    )
    write_audit(
        session, request, "worker.emailed", "employee", user, entity_id=uuid.UUID(employee_id),
        after={"template": body.template, "subject": preview.subject},
    )  # fmt: skip
    return EmailSent(**preview.model_dump())
