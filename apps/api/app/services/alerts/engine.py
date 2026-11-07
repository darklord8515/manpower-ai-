"""The detector run: compare what the detectors find with the alerts that exist (ALERT_RUN).

For each alert type, in one pass: raise what is new, update what changed in place, resolve what is
gone ("Condition cleared: ..."), reopen snoozes that have run out, and move untaken alerts up a
level when they have waited too long. Alerts are created, updated and resolved only here; people
can take, assign, snooze and dismiss them (app/services/alerts/service.py), never resolve them.

`run_detectors` does not commit; the caller does. `run_after_change` is for routes: it runs after a
change has been saved, commits its own work, and never fails the request it follows.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import RowMapping, text
from sqlalchemy.orm import Session

from app.clock import Clock
from app.config import Settings
from app.services.alerts.detectors import DETECTORS
from app.services.alerts.findings import CLEARED, SEVERITY_RANK, Finding

log = logging.getLogger(__name__)

LIVE = ("open", "in_progress", "snoozed")


@dataclass
class RunSummary:
    raised: int = 0
    updated: int = 0
    resolved: int = 0
    reopened: int = 0
    escalated: int = 0

    def changed(self) -> bool:
        return bool(self.raised or self.updated or self.resolved or self.reopened or self.escalated)


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def _plain(value: Any) -> Any:
    """What a value looks like after it has been stored as JSON, so old and new compare equal."""
    return json.loads(_json(value))


def audit(
    session: Session,
    action: str,
    alert_id: uuid.UUID | None,
    after: dict[str, Any] | None = None,
    before: dict[str, Any] | None = None,
    user_id: uuid.UUID | None = None,
    entity_type: str = "alert",
) -> None:
    """One audit row for something the system did (no person, no request, so no address)."""
    session.execute(
        text(
            """INSERT INTO audit_log (user_id, role_codes, action, entity_type, entity_id,
                                      before_json, after_json)
               VALUES (:user, :roles, :action, :type, :entity,
                       CAST(:before AS jsonb), CAST(:after AS jsonb))"""
        ),
        {
            "user": user_id,
            "roles": None if user_id else ["system"],
            "action": action,
            "type": entity_type,
            "entity": alert_id,
            "before": _json(before) if before is not None else None,
            "after": _json(after) if after is not None else None,
        },
    )


def _worse(kind: str, new: Finding, old_severity: str, old_facts: dict[str, Any]) -> bool:
    """ALERT_DISMISS: a dismissed condition comes back only if it got worse."""
    if SEVERITY_RANK[new.severity] > SEVERITY_RANK[old_severity]:
        return True
    if kind == "upcoming_shortfall":
        return int(new.facts.get("gap", 0)) > int(old_facts.get("gap", 0))
    if kind == "document_expiry":  # the next threshold: 90 -> 60 -> 30 -> 7 -> expired
        return int(new.facts.get("threshold", 99)) < int(old_facts.get("threshold", 99))
    return False


def _insert(session: Session, f: Finding, now: datetime, is_demo: bool) -> uuid.UUID:
    alert_id = session.execute(
        text(
            """INSERT INTO alerts
                   (type, severity, status, project_id, subject_type, subject_id, title,
                    facts_json, explanation, recommended_actions_json, due_at, dedupe_key,
                    is_demo, created_at, updated_at)
               VALUES (CAST(:type AS alert_type), CAST(:severity AS alert_severity), 'open',
                       :project, :subject_type, :subject_id, :title, CAST(:facts AS jsonb),
                       :explanation, CAST(:actions AS jsonb), :due, :key, :demo, :now, :now)
               RETURNING id"""
        ),
        {
            "type": f.type, "severity": f.severity, "project": f.project_id,
            "subject_type": f.subject_type, "subject_id": f.subject_id, "title": f.title,
            "facts": _json(f.facts), "explanation": f.explanation, "actions": _json(f.actions),
            "due": f.due_at, "key": f.dedupe_key, "demo": is_demo, "now": now,
        },
    ).scalar_one()  # fmt: skip
    audit(
        session, "alert.raised", alert_id,
        after={"type": f.type, "severity": f.severity, "title": f.title, "key": f.dedupe_key},
    )  # fmt: skip
    return alert_id


def _reconcile(
    session: Session, kind: str, findings: list[Finding], now: datetime, is_demo: bool,
    summary: RunSummary,
) -> None:  # fmt: skip
    live: list[RowMapping] = list(
        session.execute(
            text(
                """SELECT id, dedupe_key, severity::text AS severity, status::text AS status,
                          snoozed_until, title, explanation, facts_json,
                          recommended_actions_json, due_at, project_id
                   FROM alerts WHERE type = CAST(:type AS alert_type)
                     AND status IN ('open', 'in_progress', 'snoozed')"""
            ),
            {"type": kind},
        ).mappings()
    )
    found = {f.dedupe_key: f for f in findings}

    for alert in live:
        f = found.pop(alert["dedupe_key"], None)
        if f is None:
            note = f"Condition cleared: {CLEARED[kind]}"
            session.execute(
                text(
                    """UPDATE alerts SET status = 'resolved', resolved_at = :now,
                              resolved_by = NULL, resolution_note = :note, updated_at = :now
                       WHERE id = :id"""
                ),
                {"id": alert["id"], "now": now, "note": note},
            )
            audit(session, "alert.resolved", alert["id"], after={"note": note})
            summary.resolved += 1
            continue
        # Still true: keep the alert up to date in place (ALERT_DEDUPE).
        same = (
            alert["severity"] == f.severity
            and alert["title"] == f.title
            and alert["explanation"] == f.explanation
            and _plain(alert["facts_json"]) == _plain(f.facts)
            and _plain(alert["recommended_actions_json"]) == _plain(f.actions)
            and alert["due_at"] == f.due_at
            and alert["project_id"] == f.project_id
        )
        if not same:
            session.execute(
                text(
                    """UPDATE alerts SET severity = CAST(:severity AS alert_severity),
                              title = :title, explanation = :explanation,
                              facts_json = CAST(:facts AS jsonb),
                              recommended_actions_json = CAST(:actions AS jsonb), due_at = :due,
                              project_id = :project, updated_at = :now
                       WHERE id = :id"""
                ),
                {
                    "id": alert["id"], "severity": f.severity, "title": f.title,
                    "explanation": f.explanation, "facts": _json(f.facts),
                    "actions": _json(f.actions), "due": f.due_at, "project": f.project_id,
                    "now": now,
                },
            )  # fmt: skip
            if alert["severity"] != f.severity:
                audit(
                    session, "alert.severity_changed", alert["id"],
                    before={"severity": alert["severity"]}, after={"severity": f.severity},
                )  # fmt: skip
            summary.updated += 1
        # ALERT_SNOOZE: when the snooze has run out and the condition holds, it is open again.
        if (
            alert["status"] == "snoozed"
            and alert["snoozed_until"] is not None
            and alert["snoozed_until"] <= now
        ):
            session.execute(
                text("UPDATE alerts SET status = 'open', updated_at = :now WHERE id = :id"),
                {"id": alert["id"], "now": now},
            )
            audit(session, "alert.reopened", alert["id"], after={"reason": "snooze ended"})
            summary.reopened += 1

    # What is left is new, unless a person dismissed it and it has not got worse.
    for key, f in found.items():
        dismissed = (
            session.execute(
                text(
                    """SELECT severity::text AS severity, facts_json FROM alerts
                       WHERE dedupe_key = :key AND status = 'dismissed'
                       ORDER BY resolved_at DESC LIMIT 1"""
                ),
                {"key": key},
            )
            .mappings()
            .first()
        )
        if dismissed is not None and not _worse(
            kind, f, dismissed["severity"], _plain(dismissed["facts_json"])
        ):
            continue
        _insert(session, f, now, is_demo)
        summary.raised += 1


def _escalate(session: Session, settings: Settings, now: datetime, summary: RunSummary) -> None:
    """ALERT_ESCALATION: an alert nobody has taken moves up a level after the configured hours."""

    def hours(text_value: str) -> tuple[float, float]:
        first, second = (float(x) for x in text_value.split(","))
        return first, second

    steps = {
        "critical": hours(settings.alert_escalation_critical_hours),
        "action_needed": hours(settings.alert_escalation_action_hours),
    }
    rows = session.execute(
        text(
            """SELECT id, severity::text AS severity, escalation_level,
                      greatest(created_at, coalesce(snoozed_until, created_at)) AS since
               FROM alerts WHERE status = 'open' AND severity IN ('critical', 'action_needed')"""
        )
    ).mappings()
    for a in list(rows):
        first, second = steps[a["severity"]]
        waited = (now - a["since"]).total_seconds() / 3600
        level = 2 if waited >= second else 1 if waited >= first else 0
        if level > a["escalation_level"]:
            session.execute(
                text(
                    """UPDATE alerts SET escalation_level = :level, last_escalated_at = :now,
                              updated_at = :now WHERE id = :id"""
                ),
                {"id": a["id"], "level": level, "now": now},
            )
            audit(
                session, "alert.escalated", a["id"],
                before={"level": a["escalation_level"]}, after={"level": level},
            )  # fmt: skip
            summary.escalated += 1


def run_detectors(
    session: Session,
    settings: Settings,
    clock: Clock,
    *,
    is_demo: bool = False,
    reason: str = "event",
) -> RunSummary:
    """Run every detector and reconcile the alerts. The caller commits."""
    now = clock.now()
    summary = RunSummary()
    for kind, detector in DETECTORS.items():
        _reconcile(session, kind, detector(session, settings, clock), now, is_demo, summary)
    _escalate(session, settings, now, summary)
    if (
        reason != "event"
    ):  # "last ran at ..." follows the scheduled and manual runs (ALERT_LAST_RUN)
        audit(
            session, "alerts.detectors_run", None,
            after={"at": now, "reason": reason, **summary.__dict__},
            entity_type="system",
        )  # fmt: skip
    return summary


def run_after_change(session: Session, settings: Settings, clock: Clock) -> None:
    """After a route has saved a change: bring the alerts up to date, and never fail the request."""
    try:
        run_detectors(session, settings, clock)
        session.commit()
    except Exception:  # noqa: BLE001 - a detector problem must not undo or hide the user's change
        session.rollback()
        log.exception("The alert detectors failed after a change")


def last_run(session: Session) -> datetime | None:
    """When the detectors last ran on schedule or on request (ALERT_LAST_RUN)."""
    value = session.execute(
        text(
            """SELECT max((after_json->>'at')::timestamptz) FROM audit_log
               WHERE action = 'alerts.detectors_run'"""
        )
    ).scalar_one()
    return value if isinstance(value, datetime) else None
