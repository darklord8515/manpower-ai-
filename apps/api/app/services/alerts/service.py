"""What people do with alerts: read them, take one, assign it, snooze it, dismiss it.

Nobody resolves an alert by hand: only the detectors do, when the condition is gone
(ALERT_DETECTORS_PYTHON). Every action needs `alert:act`, is checked here (ALERT_SNOOZE,
ALERT_DISMISS) and is written to the audit log with the alert's id (ALERT_AUDIT, by the route).
Alerts are filtered like the data they describe (ALERT_SCOPE).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import RowMapping, text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.schemas import (
    AlertAction,
    AlertCounts,
    AlertDetail,
    AlertHistory,
    AlertList,
    AlertRow,
    AlertSummary,
    Assignee,
)
from app.services.alerts.actions import allowed
from app.services.alerts.engine import last_run
from app.services.alerts.findings import DISMISSIBLE, day

ESCALATED_TO = {1: "HR Manager", 2: "Operations Manager"}
SNOOZE_MAX_DAYS = 7
SNOOZE_MAX_HOURS_CRITICAL = 24
LIVE = ("open", "in_progress")
LIST_LIMIT = 300
CLEARED_DAYS = 30

_SEVERITY_ORDER = "CASE a.severity WHEN 'critical' THEN 0 WHEN 'action_needed' THEN 1 ELSE 2 END"
_SELECT = """
SELECT a.id, a.type::text AS type, a.severity::text AS severity, a.status::text AS status,
       a.title, p.code AS project, a.created_at, a.due_at, u.full_name AS assignee,
       a.assigned_to, a.escalation_level, a.snoozed_until, a.resolved_at, a.resolution_note,
       a.explanation, a.facts_json, a.recommended_actions_json, a.narrated_by_run, a.dedupe_key
FROM alerts a LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN users u ON u.id = a.assigned_to
"""


class AlertError(Exception):
    """A change the alert rules refuse, with the HTTP status the caller should answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _scope(user: AuthUser) -> tuple[str, dict[str, Any]]:
    scope = user.scope("alert:read")
    if scope == "all":
        return "TRUE", {}
    if scope in ("project", "site"):  # company-wide alerts (no project) need `all` scope
        return "a.project_id = ANY(:scope_projects)", {"scope_projects": list(user.whole_projects)}
    return "FALSE", {}


def _row(r: RowMapping) -> AlertRow:
    return AlertRow(
        id=r["id"], type=r["type"], severity=r["severity"], status=r["status"], title=r["title"],
        project=r["project"], raised_at=r["created_at"], due_at=r["due_at"],
        assignee=r["assignee"], assignee_id=r["assigned_to"],
        escalation_level=r["escalation_level"],
        escalated_to=ESCALATED_TO.get(r["escalation_level"]),
        snoozed_until=r["snoozed_until"], resolved_at=r["resolved_at"],
        resolution_note=r["resolution_note"],
    )  # fmt: skip


def _counts(rows: list[Any]) -> AlertCounts:
    by = {r[0]: int(r[1]) for r in rows}
    return AlertCounts(
        critical=by.get("critical", 0), action_needed=by.get("action_needed", 0),
        info=by.get("info", 0),
    )  # fmt: skip


# -------------------------------------------------------------------------------------- reading


def list_alerts(
    session: Session,
    user: AuthUser,
    now: datetime,
    *,
    view: str = "open",
    severity: str | None = None,
    kind: str | None = None,
    project: str | None = None,
    mine: bool = False,
    q: str = "",
) -> AlertList:
    scope_sql, params = _scope(user)
    where = [scope_sql]
    if kind:
        where.append("a.type = CAST(:kind AS alert_type)")
        params["kind"] = kind
    if project:
        where.append("p.code = :project")
        params["project"] = project
    if mine:
        where.append("a.assigned_to = :me")
        params["me"] = user.id
    if q.strip():
        where.append("(a.title ILIKE :like OR p.code ILIKE :like)")
        params["like"] = f"%{q.strip()}%"
    shared = " AND ".join(f"({w})" for w in where)

    counts = _counts(
        list(
            session.execute(
                text(
                    f"""SELECT a.severity::text, count(*) FROM alerts a
                        LEFT JOIN projects p ON p.id = a.project_id
                        WHERE {shared} AND a.status IN ('open', 'in_progress') GROUP BY 1"""  # noqa: S608
                ),
                params,
            )
        )
    )
    snoozed = int(
        session.execute(
            text(
                f"""SELECT count(*) FROM alerts a LEFT JOIN projects p ON p.id = a.project_id
                    WHERE {shared} AND a.status = 'snoozed'"""  # noqa: S608
            ),
            params,
        ).scalar_one()
    )

    conditions = [shared]
    order = f"{_SEVERITY_ORDER}, a.due_at NULLS LAST, a.created_at"
    if view == "snoozed":
        conditions.append("a.status = 'snoozed'")
        order = "a.snoozed_until, a.created_at"
    elif view == "cleared":
        conditions.append("a.status IN ('resolved', 'dismissed') AND a.resolved_at >= :since")
        params["since"] = now - timedelta(days=CLEARED_DAYS)
        order = "a.resolved_at DESC"
    else:
        conditions.append("a.status IN ('open', 'in_progress')")
    if severity:
        conditions.append("a.severity = CAST(:severity AS alert_severity)")
        params["severity"] = severity
    rows = session.execute(
        text(f"{_SELECT} WHERE {' AND '.join(conditions)} ORDER BY {order} LIMIT {LIST_LIMIT}"),  # noqa: S608
        params,
    ).mappings()
    return AlertList(
        items=[_row(r) for r in rows],
        counts=counts,
        snoozed=snoozed,
        last_run=last_run(session),
        now=now,
        can_act=user.can("alert:act"),
    )


def summary(session: Session, user: AuthUser, now: datetime) -> AlertSummary:
    """The bell and the CEO tile: how many need attention, and the five most urgent."""
    scope_sql, params = _scope(user)
    counts = _counts(
        list(
            session.execute(
                text(
                    f"""SELECT a.severity::text, count(*) FROM alerts a
                        WHERE ({scope_sql}) AND a.status IN ('open', 'in_progress') GROUP BY 1"""  # noqa: S608
                ),
                params,
            )
        )
    )
    top = session.execute(
        text(
            f"""{_SELECT} WHERE ({scope_sql}) AND a.status IN ('open', 'in_progress')
                AND a.severity IN ('critical', 'action_needed')
                ORDER BY {_SEVERITY_ORDER}, a.due_at NULLS LAST, a.created_at LIMIT 5"""  # noqa: S608
        ),
        params,
    ).mappings()
    mine = int(
        session.execute(
            text(
                f"""SELECT count(*) FROM alerts a WHERE ({scope_sql}) AND a.assigned_to = :me
                    AND a.status IN ('open', 'in_progress')"""  # noqa: S608
            ),
            {**params, "me": user.id},
        ).scalar_one()
    )
    return AlertSummary(
        counts=counts,
        needs_attention=counts.critical + counts.action_needed,
        top=[_row(r) for r in top],
        mine=mine,
        last_run=last_run(session),
        now=now,
        can_act=user.can("alert:act"),
    )


def _history_words(action: str, after: dict[str, Any]) -> str:
    match action:
        case "alert.raised":
            return "Raised"
        case "alert.severity_changed":
            return f"Severity changed to {str(after.get('severity', '')).replace('_', ' ')}"
        case "alert.escalated":
            return f"Escalated to {ESCALATED_TO.get(int(after.get('level', 0)), 'a manager')}"
        case "alert.resolved":
            return str(after.get("note") or "Resolved")
        case "alert.reopened":
            return "Reopened: the snooze ended and the condition still holds"
        case "alert.taken":
            return "Taken"
        case "alert.assigned":
            return f"Assigned to {after.get('assignee', 'someone')}"
        case "alert.snoozed":
            until = after.get("until")
            return (
                f"Snoozed until {day(datetime.fromisoformat(str(until)).date())}"
                if until
                else "Snoozed"
            )
        case "alert.dismissed":
            return f"Dismissed: {after.get('reason', '')}"
        case "alert.narrated":
            return "Worded by AI from the facts"
        case _:
            return action.removeprefix("alert.").replace("_", " ").capitalize()


def detail(session: Session, user: AuthUser, alert_id: uuid.UUID) -> AlertDetail | None:
    scope_sql, params = _scope(user)
    row = (
        session.execute(
            text(f"{_SELECT} WHERE a.id = :id AND ({scope_sql})"),  # noqa: S608
            {**params, "id": alert_id},
        )
        .mappings()
        .first()
    )
    if row is None:  # also when it belongs to a project outside the caller's scope
        return None
    history = session.execute(
        text(
            """SELECT l.at, u.full_name AS who, l.action, l.after_json
               FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
               WHERE l.entity_type = 'alert' AND l.entity_id = :id
               ORDER BY l.at DESC, l.id DESC"""
        ),
        {"id": alert_id},
    ).mappings()
    can_act = user.can("alert:act")
    return AlertDetail(
        **_row(row).model_dump(),
        explanation=row["explanation"],
        narrated=row["narrated_by_run"] is not None,
        facts=json.loads(json.dumps(row["facts_json"])),
        actions=[
            AlertAction(**a)
            for a in allowed(user, row["recommended_actions_json"])
            if row["status"] in ("open", "in_progress", "snoozed")
        ],
        can_act=can_act and row["status"] in ("open", "in_progress", "snoozed"),
        can_dismiss=can_act
        and row["type"] in DISMISSIBLE
        and row["status"] in ("open", "in_progress", "snoozed"),
        history=[
            AlertHistory(
                at=h["at"], by=h["who"] or "System",
                what=_history_words(h["action"], h["after_json"] or {}),
            )
            for h in history
        ],
    )  # fmt: skip


def python_title(session: Session, alert_id: uuid.UUID) -> str:
    """The alert's title as Python worded it, even after the narrator has reworded it.

    The Home insight must be written by Python only (INSIGHT_PYTHON_ONLY); the narrator keeps the
    template it replaced in its run, and this is where the insight finds it.
    """
    title = session.execute(
        text(
            """SELECT coalesce(r.output_json #>> '{template,title}', a.title)
               FROM alerts a LEFT JOIN agent_runs r ON r.id = a.narrated_by_run WHERE a.id = :id"""
        ),
        {"id": alert_id},
    ).scalar_one_or_none()
    return str(title or "")


def assignees(session: Session) -> list[Assignee]:
    """The people an alert can be given to: everyone who may act on alerts."""
    rows = session.execute(
        text(
            """SELECT DISTINCT u.id, u.full_name, r.name AS role
               FROM users u JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles r ON r.id = ur.role_id
               JOIN role_permissions rp ON rp.role_id = r.id
               JOIN permissions p ON p.id = rp.permission_id AND p.code = 'alert:act'
               WHERE u.is_active ORDER BY u.full_name"""
        )
    ).mappings()
    return [Assignee(id=r["id"], name=r["full_name"], role=r["role"]) for r in rows]


# ------------------------------------------------------------------------------------ changing


def _load(session: Session, user: AuthUser, alert_id: uuid.UUID) -> RowMapping:
    scope_sql, params = _scope(user)
    row = (
        session.execute(
            text(f"{_SELECT} WHERE a.id = :id AND ({scope_sql}) FOR UPDATE OF a"),  # noqa: S608
            {**params, "id": alert_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise AlertError(404, "Alert not found")
    return row


def _live(row: RowMapping) -> None:
    if row["status"] not in ("open", "in_progress", "snoozed"):
        raise AlertError(409, f"This alert is already {row['status']}.")


def take(session: Session, user: AuthUser, alert_id: uuid.UUID) -> dict[str, Any]:
    row = _load(session, user, alert_id)
    _live(row)
    if row["status"] == "in_progress" and row["assigned_to"] not in (None, user.id):
        raise AlertError(409, f"{row['assignee']} is already working on this.")
    session.execute(
        text(
            """UPDATE alerts SET status = 'in_progress', assigned_to = :me, snoozed_until = NULL,
                      updated_at = now() WHERE id = :id"""
        ),
        {"id": alert_id, "me": user.id},
    )
    return {"action": "alert.taken", "after": {"assignee": user.full_name}}


def _check_assignee(session: Session, user_id: uuid.UUID) -> Assignee:
    for a in assignees(session):
        if a.id == user_id:
            return a
    raise AlertError(422, "That person cannot work on alerts.")


def assign(session: Session, user: AuthUser, alert_id: uuid.UUID, to: uuid.UUID) -> dict[str, Any]:
    row = _load(session, user, alert_id)
    _live(row)
    person = _check_assignee(session, to)
    session.execute(
        text(
            """UPDATE alerts SET status = 'in_progress', assigned_to = :to, snoozed_until = NULL,
                      updated_at = now() WHERE id = :id"""
        ),
        {"id": alert_id, "to": to},
    )
    return {"action": "alert.assigned", "after": {"assignee": person.name}}


def _check_snooze(row: RowMapping, until: datetime, now: datetime) -> None:
    if until <= now:
        raise AlertError(422, "Choose a time in the future.")
    limit = (
        timedelta(hours=SNOOZE_MAX_HOURS_CRITICAL)
        if row["severity"] == "critical"
        else timedelta(days=SNOOZE_MAX_DAYS)
    )
    if until - now > limit:
        raise AlertError(
            422,
            "A critical alert can be snoozed for 24 hours at most."
            if row["severity"] == "critical"
            else f"An alert can be snoozed for {SNOOZE_MAX_DAYS} days at most.",
        )


def snooze(
    session: Session, user: AuthUser, alert_id: uuid.UUID, until: datetime, now: datetime
) -> dict[str, Any]:
    row = _load(session, user, alert_id)
    _live(row)
    _check_snooze(row, until, now)
    session.execute(
        text(
            """UPDATE alerts SET status = 'snoozed', snoozed_until = :until, updated_at = now()
               WHERE id = :id"""
        ),
        {"id": alert_id, "until": until},
    )
    return {"action": "alert.snoozed", "after": {"until": until}}


def dismiss(
    session: Session, user: AuthUser, alert_id: uuid.UUID, reason: str, now: datetime
) -> dict[str, Any]:
    row = _load(session, user, alert_id)
    _live(row)
    if row["type"] not in DISMISSIBLE:
        raise AlertError(
            409, "This alert can only be snoozed. It clears by itself when the cause is fixed."
        )
    session.execute(
        text(
            """UPDATE alerts SET status = 'dismissed', resolved_at = :now, resolved_by = :me,
                      resolution_note = :reason, snoozed_until = NULL, updated_at = now()
               WHERE id = :id"""
        ),
        {"id": alert_id, "me": user.id, "reason": reason, "now": now},
    )
    return {"action": "alert.dismissed", "after": {"reason": reason}}


def bulk(
    session: Session,
    user: AuthUser,
    ids: list[uuid.UUID],
    action: str,
    now: datetime,
    until: datetime | None,
    to: uuid.UUID | None,
) -> list[tuple[uuid.UUID, dict[str, Any]]]:
    """Snooze or assign several at once: all of them, or none (one refusal stops the lot)."""
    if action == "snooze" and until is None:
        raise AlertError(422, "Choose until when to snooze.")
    if action == "assign" and to is None:
        raise AlertError(422, "Choose who to assign them to.")
    done: list[tuple[uuid.UUID, dict[str, Any]]] = []
    try:
        for alert_id in dict.fromkeys(ids):
            if action == "snooze":
                assert until is not None
                done.append((alert_id, snooze(session, user, alert_id, until, now)))
            else:
                assert to is not None
                done.append((alert_id, assign(session, user, alert_id, to)))
    except AlertError:
        session.rollback()
        raise
    return done
