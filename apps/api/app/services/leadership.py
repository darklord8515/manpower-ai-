"""A project's leadership: who leads it, and which key roles it needs.

Every number and date here is worked out in Python (rules LEAD_FREE_BY_DATES, KEY_ROLES_BY_CREW).
The lead is a company employee whose trade is Project manager. A person can lead one project at a
time: they are free for a new project only if none of the projects they lead overlaps its dates.
Key roles (site engineer, supervisor, safety officer ...) are trades like any other, so once they
are added to the plan the manpower forecast covers them, and says when to recruit if nobody is free.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

LEAD_TRADE = "Project manager"
STAFF_CATEGORY = "Staff"
# (trade, one per N people in the crew (0 = exactly one), at least this many once there is a crew)
KEY_ROLE_RULES: tuple[tuple[str, int, int], ...] = (
    ("Project manager", 0, 1),
    ("Site engineer", 25, 1),
    ("Supervisor", 10, 1),
    ("Safety officer", 30, 1),
    ("QA/QC inspector", 40, 1),
    ("Surveyor", 50, 0),
    ("Storekeeper", 40, 1),
)


def _day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


def recommended(crew: int) -> dict[str, int]:
    """How many of each key role a crew of this size needs. Zero crew needs none."""
    if crew <= 0:
        return {trade: 0 for trade, _, _ in KEY_ROLE_RULES}
    out: dict[str, int] = {}
    for trade, per, minimum in KEY_ROLE_RULES:
        out[trade] = 1 if per == 0 else max(minimum, math.ceil(crew / per))
    return out


@dataclass(frozen=True)
class KeyRole:
    trade: str
    recommended: int
    planned: int
    people_free: int  # employees with this trade who are available now


def crew_of(session: Session, project_id: Any) -> int:
    """People the project plans in its crew trades (the largest line per trade, summed)."""
    return int(
        session.execute(
            text(
                """SELECT COALESCE(sum(m), 0) FROM (
                       SELECT max(r.headcount) AS m FROM manpower_requirements r
                       JOIN trades t ON t.id = r.trade_id
                       WHERE r.project_id = :p AND COALESCE(t.category, '') <> :staff
                       GROUP BY t.id) x"""
            ),
            {"p": project_id, "staff": STAFF_CATEGORY},
        ).scalar_one()
    )


def key_roles(session: Session, project_id: Any) -> list[KeyRole]:
    need = recommended(crew_of(session, project_id))
    planned = {
        r["name"]: int(r["n"])
        for r in session.execute(
            text(
                """SELECT t.name, max(r.headcount) AS n FROM manpower_requirements r
                   JOIN trades t ON t.id = r.trade_id WHERE r.project_id = :p GROUP BY t.name"""
            ),
            {"p": project_id},
        ).mappings()
    }
    free = {
        r["name"]: int(r["n"])
        for r in session.execute(
            text(
                """SELECT t.name, count(*) AS n FROM employees e
                   JOIN trades t ON t.id = e.primary_trade_id
                   WHERE e.availability = 'available' AND e.employment_status = 'active'
                   GROUP BY t.name"""
            )
        ).mappings()
    }
    return [
        KeyRole(trade, need[trade], planned.get(trade, 0), free.get(trade, 0))
        for trade, _, _ in KEY_ROLE_RULES
    ]


@dataclass(frozen=True)
class Candidate:
    code: str
    name: str
    level: int | None
    busy_on: str | None  # the project they lead that overlaps, if any
    busy_until: date | None


@dataclass(frozen=True)
class LeadOptions:
    free: list[Candidate]
    busy: list[Candidate]  # soonest to finish first
    advice: str


def lead_options(
    session: Session,
    project: Any,
    today: date,
    local_days: int,
    overseas_days: int,
) -> LeadOptions:
    """Project managers who could lead `project`, and what to do when none is free."""
    starts: date | None = project["starts_on"]
    ends: date | None = project["ends_on"]
    people = session.execute(
        text(
            """SELECT e.id, e.employee_code AS code, e.full_name AS name, es.level,
                      e.exit_on, e.contract_end_on
               FROM employees e JOIN trades t ON t.id = e.primary_trade_id
               LEFT JOIN employee_skills es ON es.employee_id = e.id AND es.trade_id = t.id
               WHERE t.name = :trade AND e.employment_status = 'active'
               ORDER BY e.full_name"""
        ),
        {"trade": LEAD_TRADE},
    ).mappings()
    leads = (
        session.execute(
            text(
                """SELECT lead_employee_id AS e, code, starts_on, ends_on FROM projects
               WHERE lead_employee_id IS NOT NULL AND id <> :p AND status <> 'completed'"""
            ),
            {"p": project["id"]},
        )
        .mappings()
        .all()
    )
    free: list[Candidate] = []
    busy: list[Candidate] = []
    for p in people:
        gone = starts is not None and (
            (p["exit_on"] is not None and p["exit_on"] < starts)
            or (p["contract_end_on"] is not None and p["contract_end_on"] < starts)
        )
        if gone:
            continue
        clash = [
            (r["code"], r["ends_on"])
            for r in leads
            if r["e"] == p["id"]
            and (
                starts is None
                or ends is None
                or r["starts_on"] is None
                or r["ends_on"] is None
                or (r["starts_on"] <= ends and r["ends_on"] >= starts)
            )
        ]
        if clash:
            code, until = max(clash, key=lambda c: c[1] or date.max)
            busy.append(Candidate(p["code"], p["name"], p["level"], code, until))
        else:
            free.append(Candidate(p["code"], p["name"], p["level"], None, None))
    busy.sort(key=lambda c: c.busy_until or date.max)
    return LeadOptions(free, busy, _advice(project, free, busy, today, local_days, overseas_days))


def _advice(
    project: Any,
    free: list[Candidate],
    busy: list[Candidate],
    today: date,
    local_days: int,
    overseas_days: int,
) -> str:
    starts: date | None = project["starts_on"]
    if free:
        names = ", ".join(c.name for c in free[:3])
        are = "s are" if len(free) != 1 else " is"
        return f"{len(free)} project manager{are} free for the whole project: {names}."
    if starts is None:
        return "Set the project's dates first, then I can say who is free."
    parts = [f"No project manager is free from {_day(starts)}."]
    first = busy[0] if busy else None
    until = first.busy_until if first is not None else None
    if first is not None and until is not None:
        gap = (until - starts).days
        when = f"{gap} days after the start" if gap > 0 else "before the start"
        parts.append(
            f"The nearest is {first.name}, who finishes {first.busy_on} on {_day(until)} ({when})."
        )
    local_by, overseas_by = (
        starts - timedelta(days=local_days),
        starts - timedelta(days=overseas_days),
    )
    parts.append(
        f"Options: wait for them, move someone from another project, or recruit one: locally by "
        f"{_day(local_by)}{' (date passed)' if local_by < today else ''}, or overseas by "
        f"{_day(overseas_by)}{' (date passed)' if overseas_by < today else ''}."
    )
    return " ".join(parts)
