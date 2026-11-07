"""The seven detectors (docs/rules.md, "The seven detectors").

Each one looks at the data as it is now and returns what is wrong or coming, as findings. It never
writes: the engine compares findings with the alerts that already exist and raises, updates or
resolves them (ALERT_DETECTORS_PYTHON). Every title, explanation and number is made here from the
data; no model is involved. Facts never hold a document number or a phone number
(ALERT_NO_SENSITIVE).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import date, time, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.clock import Clock
from app.config import Settings
from app.labels import document_label
from app.services.alerts.actions import action
from app.services.alerts.findings import Finding, at_day, day, plural
from app.services.forecast import ForecastError, forecast_project

# Detectors look at everything: this is the service account that runs them, not a person.
SYSTEM = AuthUser(
    id=uuid.UUID(int=0),
    email="system@constructiq.local",
    full_name="System",
    employee_id=None,
    roles=("system",),
    permissions={"forecast:read": "all"},
)

Detector = Callable[[Session, Settings, Clock], list[Finding]]

# How far ahead the two "who is leaving" and "the ban is coming" detectors look.
ENDING_LOOKAHEAD_DAYS = 30
BAN_LOOKAHEAD_DAYS = 30
STUCK_REPORT_DAYS = 3


def _codes(people: list[tuple[str, str]], limit: int = 20) -> dict[str, Any]:
    """A short list of who, as codes and names (never phone numbers or document numbers)."""
    return {
        "workers": [{"code": c, "name": n} for c, n in people[:limit]],
        "more": max(len(people) - limit, 0),
    }


# ---------------------------------------------------------------------------------- 1. shortfall


def upcoming_shortfall(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """A project that starts soon and will be short of a trade, after holds and recruitment."""
    today = clock.today()
    projects = (
        session.execute(
            text(
                """SELECT id, code, name, starts_on FROM projects
                   WHERE status IN ('planning', 'active') AND starts_on >= :today
                     AND starts_on <= :last
                   ORDER BY starts_on, code"""
            ),
            {"today": today, "last": today + timedelta(days=settings.forecast_window_days)},
        )
        .mappings()
        .all()
    )
    findings: list[Finding] = []
    for p in projects:
        try:
            forecast = forecast_project(session, SYSTEM, settings, p["code"], today)
        except ForecastError:
            continue
        if forecast is None:
            continue
        start: date = p["starts_on"]
        days = (start - today).days
        for t in forecast.trades:
            gap = t.uncovered_gap
            if gap <= 0:
                continue
            trade = t.trade.lower()
            pending = (
                f", with {t.recruitment_pending} more on the way" if t.recruitment_pending else ""
            )
            findings.append(
                Finding(
                    type="upcoming_shortfall",
                    dedupe_key=f"upcoming_shortfall:{p['code']}:{t.trade_code}:{start.isoformat()}",
                    severity="critical" if days <= 30 else "action_needed",
                    title=f"{p['code']} starts {day(start)}: {gap} {trade} short",
                    explanation=(
                        f"{p['name']} needs {t.needed} {trade} from {day(start)}. "
                        f"{t.already_assigned} are already assigned and {t.deployable} more can be "
                        f"deployed{pending}. That leaves {gap} uncovered, {plural(days, 'day')} "
                        "before the start."
                    ),
                    facts={
                        "project": p["code"],
                        "project_name": p["name"],
                        "trade": t.trade,
                        "trade_code": t.trade_code,
                        "start": start,
                        "days_to_start": days,
                        "needed": t.needed,
                        "already_assigned": t.already_assigned,
                        "deployable": t.deployable,
                        "recruitment_pending": t.recruitment_pending,
                        "gap": gap,
                    },
                    actions=[action("open_forecast", project=p["code"], trade=t.trade_code)],
                    subject_type="project",
                    subject_id=p["id"],
                    project_id=p["id"],
                    due_at=at_day(start),
                )  # fmt: skip
            )
    return findings


# --------------------------------------------------------------------------- 2. ending, no next


def ending_without_next(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """People whose assignment ends soon with nothing planned after, grouped by project and day."""
    today = clock.today()
    rows = session.execute(
        text(
            """SELECT p.id AS pid, p.code, p.name, (upper(a.period) - 1) AS last_day,
                      e.employee_code, e.full_name
               FROM employee_assignments a
               JOIN employees e ON e.id = a.employee_id
               JOIN projects p ON p.id = a.project_id
               WHERE a.status = 'active' AND NOT upper_inf(a.period)
                 AND (upper(a.period) - 1) BETWEEN :today AND :last
                 AND e.employment_status = 'active' AND e.exit_on IS NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM employee_assignments n
                     WHERE n.employee_id = a.employee_id AND n.id <> a.id
                       AND n.status IN ('planned', 'active') AND lower(n.period) >= upper(a.period))
               ORDER BY p.code, last_day, e.full_name"""
        ),
        {"today": today, "last": today + timedelta(days=ENDING_LOOKAHEAD_DAYS)},
    ).mappings()
    groups: dict[tuple[uuid.UUID, str, str, date], list[tuple[str, str]]] = defaultdict(list)
    for r in rows:
        groups[(r["pid"], r["code"], r["name"], r["last_day"])].append(
            (r["employee_code"], r["full_name"])
        )
    findings: list[Finding] = []
    for (pid, code, name, last_day), people in groups.items():
        n = len(people)
        days = (last_day - today).days
        who = "person finishes" if n == 1 else "people finish"
        findings.append(
            Finding(
                type="ending_without_next",
                dedupe_key=f"ending_without_next:{code}:{last_day.isoformat()}",
                severity="action_needed" if days <= 14 else "info",
                title=f"{n} {who} on {code} on {day(last_day)} with no next assignment",
                explanation=(
                    f"{plural(n, 'person', 'people')} on {name} reach their last day on "
                    f"{day(last_day)}, in {plural(days, 'day')}, and nothing is planned for them "
                    "afterwards. Fill a request with them, or check the forecast for who is needed."
                ),
                facts={
                    "project": code,
                    "project_name": name,
                    "end_date": last_day,
                    "days_left": days,
                    "count": n,
                    **_codes(people),
                },
                actions=[action("open_allocation"), action("open_forecast", project=code)],
                subject_type="project",
                subject_id=pid,
                project_id=pid,
                due_at=at_day(last_day),
            )  # fmt: skip
        )
    return findings


# ---------------------------------------------------------------------------- 3. document expiry


def expiry_threshold(days_left: int) -> int:
    """0 when expired, else the next threshold the document has crossed: 7, 30, 60 or 90."""
    if days_left < 0:
        return 0
    for limit in (7, 30, 60):
        if days_left <= limit:
            return limit
    return 90


def document_expiry(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """A current document 90, 60, 30 or 7 days from its end, or past it (people still employed)."""
    today = clock.today()
    rows = session.execute(
        text(
            """SELECT d.id, d.doc_type::text AS type, d.expiry_date, e.employee_code, e.full_name,
                      cur.pid, cur.code AS project
               FROM employee_documents d JOIN employees e ON e.id = d.employee_id
               LEFT JOIN LATERAL (
                   SELECT pr.id AS pid, pr.code FROM employee_assignments a
                   JOIN projects pr ON pr.id = a.project_id
                   WHERE a.employee_id = e.id AND a.status IN ('planned', 'active')
                   ORDER BY a.period LIMIT 1) cur ON TRUE
               WHERE d.is_current AND d.expiry_date IS NOT NULL AND d.expiry_date - :today <= 90
                 AND e.employment_status IN ('active', 'on_leave', 'suspended')
               ORDER BY d.expiry_date, e.full_name"""
        ),
        {"today": today},
    ).mappings()
    findings: list[Finding] = []
    for r in rows:
        days_left = (r["expiry_date"] - today).days
        threshold = expiry_threshold(days_left)
        if threshold == 0:
            severity = "critical" if r["pid"] else "action_needed"
        elif threshold == 7:
            severity = "critical"
        elif threshold == 30:
            severity = "action_needed"
        else:
            severity = "info"
        label = document_label(r["type"]).lower()
        if days_left < 0:
            when = f"expired {plural(-days_left, 'day')} ago"
        elif days_left == 0:
            when = "ends today"
        elif days_left == 1:
            when = "ends tomorrow"
        else:
            when = f"ends in {days_left} days"
        where = (
            f"They are on {r['project']}." if r["project"] else "They have no current assignment."
        )
        findings.append(
            Finding(
                type="document_expiry",
                dedupe_key=f"document_expiry:{r['id']}",
                severity=severity,
                title=f"{r['full_name']}: {label} {when} ({day(r['expiry_date'])})",
                explanation=(
                    f"The {label} of {r['full_name']} ({r['employee_code']}) {when}, on "
                    f"{day(r['expiry_date'])}. {where} Renewal has to be started with the worker."
                ),
                facts={
                    "worker": r["employee_code"],
                    "worker_name": r["full_name"],
                    "document": r["type"],
                    "document_label": document_label(r["type"]),
                    "expiry": r["expiry_date"],
                    "days_left": days_left,
                    "threshold": threshold,
                    "project": r["project"],
                },
                actions=[action("open_worker", worker=r["employee_code"])],
                subject_type="employee_document",
                subject_id=r["id"],
                project_id=r["pid"],
                due_at=at_day(r["expiry_date"]),
            )  # fmt: skip
        )
    return findings


# ------------------------------------------------------------------------ 4. mobilization stuck


def mobilization_stuck(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """A checklist with a task past its due date, or unfinished with the report day close."""
    today = clock.today()
    rows = session.execute(
        text(
            """SELECT m.id, m.mob_no, m.report_on, e.employee_code, e.full_name, p.id AS pid,
                      p.code AS project,
                      count(k.id) FILTER (WHERE k.status <> 'done') AS open_tasks,
                      count(k.id)
                          FILTER (WHERE k.status <> 'done' AND k.due_on < :today) AS overdue,
                      array_agg(k.title ORDER BY k.due_on, k.title)
                          FILTER (WHERE k.status <> 'done') AS open_titles
               FROM mobilizations m
               JOIN employee_assignments a ON a.id = m.assignment_id
               JOIN employees e ON e.id = a.employee_id
               JOIN projects p ON p.id = a.project_id
               LEFT JOIN mobilization_tasks k ON k.mobilization_id = m.id
               WHERE m.status IN ('approved', 'in_progress')
               GROUP BY m.id, e.id, p.id
               HAVING count(k.id) FILTER (WHERE k.status <> 'done' AND k.due_on < :today) > 0
                   OR (count(k.id) FILTER (WHERE k.status <> 'done') > 0
                       AND m.report_on - :today <= :soon)
               ORDER BY m.report_on, m.mob_no"""
        ),
        {"today": today, "soon": STUCK_REPORT_DAYS},
    ).mappings()
    findings: list[Finding] = []
    for r in rows:
        days = (r["report_on"] - today).days
        open_tasks, overdue = int(r["open_tasks"]), int(r["overdue"])
        late = f", {overdue} overdue" if overdue else ""
        findings.append(
            Finding(
                type="mobilization_stuck",
                dedupe_key=f"mobilization_stuck:{r['id']}",
                severity="critical" if days <= 2 else "action_needed",
                title=(
                    f"{r['mob_no']}: {r['full_name']} reports {day(r['report_on'])} with "
                    f"{plural(open_tasks, 'task')} still open{late}"
                ),
                explanation=(
                    f"{r['full_name']} ({r['employee_code']}) reports to {r['project']} on "
                    f"{day(r['report_on'])}, in {plural(days, 'day')}. Still open: "
                    f"{'; '.join(r['open_titles'])}."
                ),
                facts={
                    "mob_no": r["mob_no"],
                    "worker": r["employee_code"],
                    "worker_name": r["full_name"],
                    "project": r["project"],
                    "report_on": r["report_on"],
                    "days_to_report": days,
                    "open_tasks": open_tasks,
                    "overdue": overdue,
                    "open_titles": list(r["open_titles"]),
                },
                actions=[action("open_mobilization", mob_no=r["mob_no"])],
                subject_type="mobilization",
                subject_id=r["id"],
                project_id=r["pid"],
                due_at=at_day(r["report_on"]),
            )  # fmt: skip
        )
    return findings


# ----------------------------------------------------------------------- 5. transfer at risk


def transfer_dependency_broken(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """A reserved transfer whose source project was extended past the day the worker must leave.

    When someone is reserved, the source project's end date is remembered. The transfer is at risk
    when that project now ends later than it did, and later than the handover day (the new job's
    start minus the buffer). People released early on purpose are not flagged.
    """
    buffer = timedelta(days=settings.transfer_buffer_days)
    rows = session.execute(
        text(
            """SELECT tp.id AS tpid, tp.code AS target, sp.code AS source, lower(a.period) AS start,
                      sp.ends_on AS source_end, a.source_project_ends_on AS was,
                      e.employee_code, e.full_name
               FROM employee_assignments a
               JOIN employee_assignments s ON s.id = a.depends_on_assignment_id
               JOIN employees e ON e.id = a.employee_id
               JOIN projects tp ON tp.id = a.project_id
               JOIN projects sp ON sp.id = s.project_id
               WHERE a.status = 'planned' AND s.status IN ('planned', 'active')
                 AND a.source_project_ends_on IS NOT NULL AND sp.ends_on IS NOT NULL
                 AND sp.ends_on > a.source_project_ends_on
               ORDER BY sp.code, tp.code, e.full_name"""
        )
    ).mappings()
    groups: dict[tuple[uuid.UUID, str, str, date], list[tuple[str, str, date]]] = defaultdict(list)
    for r in rows:
        if r["source_end"] > r["start"] - buffer:
            groups[(r["tpid"], r["source"], r["target"], r["start"])].append(
                (r["employee_code"], r["full_name"], r["source_end"])
            )
    findings: list[Finding] = []
    for (tpid, source, target, start), people in groups.items():
        must_finish_by = start - buffer
        source_end = max(p[2] for p in people)
        n = len(people)
        findings.append(
            Finding(
                type="transfer_dependency_broken",
                dedupe_key=f"transfer_dependency:{source}:{target}:{start.isoformat()}",
                severity="critical",
                title=(
                    f"Transfer from {source} to {target} is at risk: {source} now ends "
                    f"{day(source_end)}, after {day(must_finish_by)}"
                ),
                explanation=(
                    f"{plural(n, 'person', 'people')} reserved from {source} for {target} must "
                    f"finish by {day(must_finish_by)} to start on {day(start)}, but {source} now "
                    f"runs until {day(source_end)}. Release the reservation, or change the dates."
                ),
                facts={
                    "source": source,
                    "target": target,
                    "target_start": start,
                    "must_finish_by": must_finish_by,
                    "source_end": source_end,
                    "count": n,
                    **_codes([(c, nm) for c, nm, _ in people]),
                },
                actions=[action("open_forecast", project=target)],
                subject_type="project",
                subject_id=tpid,
                project_id=tpid,
                due_at=at_day(start),
            )  # fmt: skip
        )
    return findings


# ------------------------------------------------------------------------- 6. approval waiting


def approval_waiting(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """An approval nobody has answered for longer than the wait (24 hours; critical at double)."""
    now = clock.now()
    rows = session.execute(
        text(
            """SELECT DISTINCT ON (ar.id) ar.id, ar.created_at, ar.summary, sr.request_no,
                      p.id AS pid, p.code AS project
               FROM approval_requests ar
               JOIN approval_steps s ON s.approval_id = ar.id AND s.decision = 'pending'
               LEFT JOIN staffing_requests sr
                      ON ar.subject_type = 'staffing_request' AND sr.id = ar.subject_id
               LEFT JOIN projects p ON p.id = sr.project_id
               WHERE ar.status = 'pending'
               ORDER BY ar.id, s.step_no"""
        )
    ).mappings()
    findings: list[Finding] = []
    for r in rows:
        waited = (now - r["created_at"]).total_seconds() / 3600
        if waited <= settings.approval_wait_hours:
            continue
        hours = int(waited)
        subject = r["request_no"] or "An approval"
        actions = [action("open_allocation", request=r["request_no"])] if r["request_no"] else []
        findings.append(
            Finding(
                type="approval_waiting",
                dedupe_key=f"approval_waiting:{r['id']}",
                severity="critical"
                if waited > 2 * settings.approval_wait_hours
                else "action_needed",
                title=f"{subject} has waited {plural(hours, 'hour')} for approval",
                explanation=(
                    f"{r['summary']}. It was sent for approval on "
                    f"{day(r['created_at'].date())} and nobody has answered yet, so the workers "
                    "cannot start."
                ),
                facts={
                    "request": r["request_no"],
                    "project": r["project"],
                    "waited_hours": hours,
                    "since": r["created_at"],
                    "summary": r["summary"],
                },
                actions=actions,
                subject_type="approval",
                subject_id=r["id"],
                project_id=r["pid"],
            )  # fmt: skip
        )
    return findings


# ------------------------------------------------------------------------ 7. midday ban conflict


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def shift_conflict(
    start: time, end: time, ban_from: time, ban_to: time, max_hours: float | None
) -> str | None:
    """ "overlaps" if the shift runs into the ban, "too_long" if over the daily cap, else None.

    A shift that ends before it starts crosses midnight and is checked in two pieces (BAN_WINDOW).
    """
    s, e, f, t = _minutes(start), _minutes(end), _minutes(ban_from), _minutes(ban_to)
    pieces = [(s, e)] if e > s else [(s, 1440), (0, e)]
    if any(a < t and b > f for a, b in pieces):
        return "overlaps"
    if max_hours is not None and sum(b - a for a, b in pieces) > max_hours * 60:
        return "too_long"
    return None


def midday_ban_conflict(session: Session, settings: Settings, clock: Clock) -> list[Finding]:
    """An outdoor site whose shift runs into a midday ban, including a provisional one."""
    today = clock.today()
    rules = session.execute(
        text(
            """SELECT year, starts_on, ends_on, blocked_from, blocked_to, max_daily_hours,
                      is_provisional
               FROM work_rules
               WHERE code = 'midday_ban' AND ends_on >= :today
                 AND blocked_from IS NOT NULL AND blocked_to IS NOT NULL
               ORDER BY starts_on"""
        ),
        {"today": today},
    ).mappings()
    findings: list[Finding] = []
    for rule in rules:
        starts, ends = rule["starts_on"], rule["ends_on"]
        days_to_ban = (starts - today).days
        if starts <= today <= ends:
            severity = "critical"
        elif days_to_ban <= BAN_LOOKAHEAD_DAYS:
            severity = "action_needed"
        elif rule["is_provisional"]:
            severity = "info"
        else:
            continue
        max_hours = float(rule["max_daily_hours"]) if rule["max_daily_hours"] is not None else None
        sites: dict[uuid.UUID, dict[str, Any]] = {}
        rows = session.execute(
            text(
                """SELECT s.id AS sid, s.name AS site, p.id AS pid, p.code AS project,
                          a.employee_id,
                          coalesce(a.shift_start, s.default_shift_start) AS shift_start,
                          coalesce(a.shift_end, s.default_shift_end) AS shift_end
                   FROM project_sites s JOIN projects p ON p.id = s.project_id
                   JOIN employee_assignments a
                        ON a.project_id = p.id AND (a.site_id = s.id OR a.site_id IS NULL)
                   WHERE s.outdoor AND a.status IN ('planned', 'active')
                     AND a.period && daterange(:starts, :ends, '[]')
                   ORDER BY p.code, s.name"""
            ),
            {"starts": starts, "ends": ends},
        ).mappings()
        for r in rows:
            if r["shift_start"] is None or r["shift_end"] is None:
                continue
            why = shift_conflict(
                r["shift_start"],
                r["shift_end"],
                rule["blocked_from"],
                rule["blocked_to"],
                max_hours,
            )
            if why is None:
                continue
            site = sites.setdefault(
                r["sid"],
                {"site": r["site"], "pid": r["pid"], "project": r["project"], "people": set(),
                 "shift": (r["shift_start"], r["shift_end"]), "why": why},
            )  # fmt: skip
            site["people"].add(r["employee_id"])
        for sid, s in sites.items():
            shift = f"{s['shift'][0]:%H:%M} to {s['shift'][1]:%H:%M}"
            ban = f"{rule['blocked_from']:%H:%M} to {rule['blocked_to']:%H:%M}"
            provisional = bool(rule["is_provisional"])
            n = len(s["people"])
            reason = (
                f"runs into the midday ban ({ban})"
                if s["why"] == "overlaps"
                else f"is longer than the {rule['max_daily_hours']} hours allowed during the ban"
            )
            note = (
                " These dates are HR's planning assumption until MoHRE announces them."
                if provisional
                else ""
            )
            findings.append(
                Finding(
                    type="midday_ban_conflict",
                    dedupe_key=f"midday_ban:{sid}:{rule['year']}",
                    severity=severity,
                    title=(
                        f"{s['project']} {s['site']}: the {shift} shift {reason.split(' (')[0]} "
                        f"in {rule['year']}{' (provisional)' if provisional else ''}"
                    ),
                    explanation=(
                        f"From {day(starts)} to {day(ends)} outdoor work is not allowed between "
                        f"{ban}. The {shift} shift on {s['project']} {s['site']} {reason}. "
                        f"Up to {plural(n, 'person', 'people')} on {s['project']} work this "
                        f"shift.{note}"
                    ),
                    facts={
                        "project": s["project"],
                        "site": s["site"],
                        "year": rule["year"],
                        "provisional": provisional,
                        "ban_starts": starts,
                        "ban_ends": ends,
                        "ban_window": ban,
                        "shift": shift,
                        "problem": s["why"],
                        "people_up_to": n,
                    },
                    actions=[],
                    subject_type="project_site",
                    subject_id=sid,
                    project_id=s["pid"],
                    due_at=at_day(starts),
                )  # fmt: skip
            )
    return findings


DETECTORS: dict[str, Detector] = {
    "upcoming_shortfall": upcoming_shortfall,
    "ending_without_next": ending_without_next,
    "document_expiry": document_expiry,
    "mobilization_stuck": mobilization_stuck,
    "transfer_dependency_broken": transfer_dependency_broken,
    "approval_waiting": approval_waiting,
    "midday_ban_conflict": midday_ban_conflict,
}
