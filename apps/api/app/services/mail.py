"""Emails HR sends from the app. The words are written here in Python; n8n only delivers them.

The API posts the finished message to an n8n webhook (authenticated with a shared key). n8n's Send
Email node sends it from the company's mail account, so the sender, its credentials and any later
change of provider live in n8n and never in this code. No document number or phone number is ever
put in a message.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx2 as httpx

from app.config import Settings
from app.labels import document_label
from app.services.alerts.findings import day, plural

WEBHOOK = "/webhook/hamra-send-email"
SIGN_OFF = "Alhamra Construction & Development"
TIMEOUT_SECONDS = 25.0


class MailError(Exception):
    """The message could not be handed over or sent. Worded for whoever pressed the button."""


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    body: str


def _when(days: int) -> str:
    if days < 0:
        return f"expired {plural(-days, 'day')} ago"
    return "expires today" if days == 0 else f"expires in {plural(days, 'day')}"


def renewal(
    first_name: str, sender: str, documents: list[dict[str, Any]], today: date
) -> tuple[str, str]:
    """Ask a worker for the documents that are expired or about to be (type and expiry each)."""
    lines = [
        f"- {document_label(d['type'])}: {day(d['expiry'])} ({_when((d['expiry'] - today).days)})"
        for d in documents
    ]
    subject = f"Please renew your {'document' if len(lines) == 1 else 'documents'}"
    body = (
        f"Hello {first_name},\n\n"
        "HR needs your updated documents so that your work and your stay stay in order:\n\n"
        + "\n".join(lines)
        + "\n\nPlease send the renewed documents, or bring them to the HR office, this week. "
        "Reply to this email if you have a question or need help with the renewal.\n\n"
        f"Thank you,\n{sender}\nHR, {SIGN_OFF}"
    )
    return subject, body


def custom(first_name: str, sender: str, subject: str, message: str) -> tuple[str, str]:
    body = f"Hello {first_name},\n\n{message.strip()}\n\nThank you,\n{sender}\nHR, {SIGN_OFF}"
    return subject.strip(), body


def deliver(
    settings: Settings, message: Message, sender_name: str,
    transport: httpx.BaseTransport | None = None,
) -> None:  # fmt: skip
    """Hand the message to n8n and wait for it to say it was sent. Raises MailError otherwise."""
    if not settings.n8n_hmac_secret:
        raise MailError("Email is not set up on this server (the n8n key is missing).")
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            response = client.post(
                f"{settings.n8n_base_url.rstrip('/')}{WEBHOOK}",
                json={
                    "to": message.to,
                    "subject": message.subject,
                    "text": message.body,
                    "from_name": "HAMRA AI",
                    "sent_by": sender_name,
                },
                headers={"X-Hamra-Key": settings.n8n_hmac_secret},
            )
    except httpx.HTTPError as error:
        raise MailError(
            "The mail service could not be reached. Check that n8n is running."
        ) from error
    if response.status_code == 403:
        raise MailError("n8n refused the key. Run `make n8n-setup` to connect them again.")
    if response.status_code == 404:
        raise MailError("The email workflow is not active in n8n. Run `make n8n-setup`.")
    if response.status_code >= 400:
        raise MailError(f"The email was not sent: n8n answered {response.status_code}.")
