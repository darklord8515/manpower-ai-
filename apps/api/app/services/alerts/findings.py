"""What a detector finds, and the small helpers they share."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any

from app.clock import GULF

SEVERITIES = ("critical", "action_needed", "info")
SEVERITY_RANK = {"info": 0, "action_needed": 1, "critical": 2}

# The types a person may dismiss. The rest can only be snoozed: they clear when the cause is fixed.
DISMISSIBLE = frozenset(
    {"upcoming_shortfall", "ending_without_next", "document_expiry", "midday_ban_conflict"}
)

# "Condition cleared: <this>" on an alert a detector resolves by itself (ALERT_AUTO_RESOLVE).
CLEARED = {
    "upcoming_shortfall": "the gap is covered",
    "ending_without_next": "everyone has a next assignment, or the end date moved out of range",
    "document_expiry": "a renewed document was verified, or the person is no longer employed",
    "mobilization_stuck": "the checklist is done and nothing is overdue",
    "transfer_dependency_broken": "the dates fit again, or the reservation was released",
    "approval_waiting": "the approval was decided",
    "midday_ban_conflict": "the shifts or the rule changed",
}


@dataclass(frozen=True)
class Finding:
    """One condition a detector found. The engine turns it into (or keeps up to date) an alert."""

    type: str
    dedupe_key: str
    severity: str
    title: str
    explanation: str
    facts: dict[str, Any]
    actions: list[dict[str, Any]]
    subject_type: str
    subject_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None  # None = company-wide: visible to `all` scope only
    due_at: datetime | None = None


def day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def at_day(value: date) -> datetime:
    """Midnight Gulf time at the start of a date: a natural due time for a dated condition."""
    return datetime.combine(value, time(0, 0), tzinfo=GULF)
