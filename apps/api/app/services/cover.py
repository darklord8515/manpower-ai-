"""Who could cover a trade for a stretch of dates, and why the others cannot.

The manpower forecast and the Allocation Board both ask this question, so they share one answer. It
is all SQL and Python (rule FORECAST_PYTHON_ONLY): a model may later explain it, never compute it.

Dates: an assignment's period is [first day, day after the last). "Last day" below is that day
minus one, so "ends 31 Jan" means 31 Jan is the last day on the old project.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import Settings
from app.labels import EXIT_LABEL, document_label
from app.schemas import Candidate, ExcludedWorker, LateCandidate

ExcludedReason = Literal["on_leave", "documents", "already_reserved", "unavailable", "leaving"]

# The rule each exclusion comes from, so a screen can show it next to the plain reason.
RULE_FOR_REASON: dict[str, str] = {
    "on_leave": "ASSIGN_LEAVE",
    "documents": "DOC_VALID_THROUGH",
    "already_reserved": "ASSIGN_OVERLAP",
    "unavailable": "ASSIGN_AVAILABILITY",
    "leaving": "ASSIGN_STATUS",
}


def day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


@dataclass
class Assignment:
    project_id: uuid.UUID
    project_code: str
    status: str
    first: date
    after_last: date | None  # None = open-ended

    @property
    def last_day(self) -> date | None:
        return None if self.after_last is None else self.after_last - timedelta(days=1)


def excluded(person: Any, reason: ExcludedReason, detail: str) -> ExcludedWorker:
    return ExcludedWorker(code=person["code"], name=person["name"], reason=reason, detail=detail)


def leaving(person: Any, window_end: date) -> str | None:
    """Why this person will not be here for the whole cover window, or None.

    An exit date or a contract end before the window closes means they cannot be counted on.
    (A renewal is not modelled yet; until HR can edit employees the dates come from the data.)
    """
    exit_on: date | None = person["exit_on"]
    if exit_on is not None and exit_on < window_end:
        why = EXIT_LABEL.get(person["exit_reason"] or "other", "leaving")
        return f"Leaving the company on {day(exit_on)} ({why})"
    contract_end: date | None = person["contract_end_on"]
    if contract_end is not None and contract_end < window_end:
        return f"Contract ends {day(contract_end)}"
    return None


@dataclass
class World:
    """What the database says about the people of some trades, for one cover window."""

    start: date
    window_end: date
    required: list[str]
    people: list[Any]
    by_trade: dict[uuid.UUID, list[Any]]
    assignments: dict[uuid.UUID, list[Assignment]]
    on_leave: dict[uuid.UUID, tuple[date, date]]
    documents: dict[uuid.UUID, dict[str, tuple[date | None, str]]]

    def document_problem(self, employee_id: uuid.UUID) -> str | None:
        """Why the required documents do not cover the window, or None when they do."""
        held = self.documents[employee_id]
        for doc_type in self.required:
            expiry, status = held.get(doc_type, (None, "missing"))
            if status != "verified" or expiry is None:
                return f"{document_label(doc_type)} is not verified"
            if expiry < self.window_end:
                return f"{document_label(doc_type)} ends {day(expiry)}"
        return None


def load_world(
    session: Session,
    trade_ids: list[uuid.UUID],
    today: date,
    start: date,
    window_end: date,
    settings: Settings,
) -> World:
    people = list(
        session.execute(
            text(
                """SELECT e.id, e.employee_code AS code, e.full_name AS name,
                          e.primary_trade_id AS trade_id, e.availability::text AS availability,
                          e.contract_end_on, e.exit_on, e.exit_reason::text AS exit_reason,
                          es.level
                   FROM employees e
                   LEFT JOIN employee_skills es
                          ON es.employee_id = e.id AND es.trade_id = e.primary_trade_id
                   WHERE e.primary_trade_id = ANY(:trades)
                     AND e.employment_status NOT IN
                         ('resigned', 'terminated', 'suspended', 'absconded')
                   ORDER BY e.employee_code"""
            ),
            {"trades": trade_ids},
        )
        .mappings()
        .all()
    )
    ids = [p["id"] for p in people]

    assignments: dict[uuid.UUID, list[Assignment]] = defaultdict(list)
    for r in session.execute(
        text(
            """SELECT a.employee_id, a.project_id, pr.code AS project_code,
                      a.status::text AS status,
                      lower(a.period) AS first, upper(a.period) AS after_last
               FROM employee_assignments a JOIN projects pr ON pr.id = a.project_id
               WHERE a.employee_id = ANY(:ids) AND a.status IN ('planned', 'active')
                 AND (upper(a.period) IS NULL OR upper(a.period) > :today)"""
        ),
        {"ids": ids, "today": today},
    ).mappings():
        assignments[r["employee_id"]].append(
            Assignment(r["project_id"], r["project_code"], r["status"], r["first"], r["after_last"])
        )

    on_leave: dict[uuid.UUID, tuple[date, date]] = {}
    for r in session.execute(
        text(
            """SELECT employee_id, lower(period) AS first, upper(period) AS after_last
               FROM leave_records
               WHERE approved AND employee_id = ANY(:ids)
                 AND period && daterange(:start, :end, '[)')"""
        ),
        {"ids": ids, "start": start, "end": window_end},
    ).mappings():
        on_leave[r["employee_id"]] = (r["first"], r["after_last"] - timedelta(days=1))

    required = settings.required_document_types
    documents: dict[uuid.UUID, dict[str, tuple[date | None, str]]] = defaultdict(dict)
    for r in session.execute(
        text(
            """SELECT employee_id, doc_type::text AS doc_type, expiry_date, status::text AS status
               FROM employee_documents
               WHERE employee_id = ANY(:ids) AND is_current AND doc_type::text = ANY(:types)"""
        ),
        {"ids": ids, "types": required},
    ).mappings():
        documents[r["employee_id"]][r["doc_type"]] = (r["expiry_date"], r["status"])

    by_trade: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for person in people:
        by_trade[person["trade_id"]].append(person)
    return World(start, window_end, required, people, by_trade, assignments, on_leave, documents)


@dataclass
class Classified:
    """The people of one trade, sorted into the groups HR cares about."""

    available: list[Candidate] = field(default_factory=lambda: [])
    ending: dict[tuple[str, date], list[Candidate]] = field(default_factory=lambda: {})
    late: list[LateCandidate] = field(default_factory=lambda: [])
    excluded: list[ExcludedWorker] = field(default_factory=lambda: [])

    def origins(self) -> dict[str, tuple[str | None, date | None]]:
        """code -> (the project they come from, their last day there) for everyone allowed in."""
        out: dict[str, tuple[str | None, date | None]] = {}
        for c in self.available:
            out[c.code] = (None, None)
        for (project_code, last), workers in self.ending.items():
            for c in workers:
                out[c.code] = (project_code, last)
        for late in self.late:
            out[late.code] = (late.project_code, late.ends_on)
        return out


def classify(
    world: World,
    trade_id: uuid.UUID,
    project_id: uuid.UUID,
    today: date,
    settings: Settings,
) -> Classified:
    """Sort the people of one trade for a project: free, finishing in time, late, or excluded."""
    start, window_end = world.start, world.window_end
    must_finish_by = start - timedelta(days=settings.transfer_buffer_days)
    result = Classified()
    for person in world.by_trade[trade_id]:
        mine = world.assignments[person["id"]]
        if any(a.project_id == project_id for a in mine):
            continue  # already on this project (counted in "already assigned")
        problem = world.document_problem(person["id"])
        candidate = Candidate(
            code=person["code"],
            name=person["name"],
            level=person["level"],
            documents_valid=problem is None,
        )
        if person["availability"] == "unavailable":
            result.excluded.append(
                excluded(person, "unavailable", "Not available (leave or medical)")
            )
            continue

        # What the worker is doing during the cover window decides everything else.
        overlapping = [
            a
            for a in mine
            if a.first < window_end and (a.after_last is None or a.after_last > start)
        ]
        planned = [a for a in overlapping if a.first > today]
        if planned:
            a = planned[0]
            result.excluded.append(
                excluded(
                    person, "already_reserved", f"Planned on {a.project_code} from {day(a.first)}"
                )
            )
            continue
        if overlapping and any(a.last_day is None for a in overlapping):
            continue  # an open-ended assignment never counts as ending
        if overlapping:
            latest = max(overlapping, key=lambda a: a.last_day or date.max)
        elif mine:
            latest = max(mine, key=lambda a: a.last_day or date.max)
        else:
            latest = None
        if latest is None and person["availability"] != "available":
            continue  # nothing on file and not marked available: not offered
        last = latest.last_day if latest else None
        if last is not None and last > start + timedelta(days=settings.forecast_late_window_days):
            continue  # busy well past the start

        gone = leaving(person, window_end)
        if gone:
            result.excluded.append(excluded(person, "leaving", gone))
            continue
        leave = world.on_leave.get(person["id"])
        if leave:
            result.excluded.append(
                excluded(person, "on_leave", f"Approved leave {day(leave[0])} to {day(leave[1])}")
            )
            continue
        if latest is not None and last is not None and last > must_finish_by:
            result.late.append(
                LateCandidate(
                    **candidate.model_dump(),
                    project_code=latest.project_code,
                    ends_on=last,
                    days_after_start=(last - start).days,
                )
            )
            continue
        if problem:
            result.excluded.append(excluded(person, "documents", problem))
            continue
        if latest is None or last is None:
            result.available.append(candidate)
        else:
            result.ending.setdefault((latest.project_code, last), []).append(candidate)
    result.late.sort(key=lambda c: (c.days_after_start, c.code))
    return result
