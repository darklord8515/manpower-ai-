"""Manpower forecast: who could join a project on its start date, trade by trade.

Every number here comes from SQL and Python (rule FORECAST_PYTHON_ONLY). A model may later explain
these results in words; it never computes or adjusts them. The rules are in docs/rules.md under
"Forward forecasting, reservations, recruitment".

Dates: an assignment's period is [first day, day after the last). "Last day" below is that day
minus one, so "ends 31 Jan" means 31 Jan is the last day on the old project.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.config import Settings
from app.labels import EXIT_LABEL, OPEN_STAGES, document_label, stage_label, stage_phrase
from app.schemas import (
    Advice,
    Arrival,
    Candidate,
    ExcludedWorker,
    ForecastProject,
    ForecastSource,
    LateCandidate,
    ProjectForecast,
    TradeForecast,
)


class ForecastError(ValueError):
    """The forecast cannot be made for the request as given (shown to the caller as a 422)."""


def _day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


ExcludedReason = Literal["on_leave", "documents", "already_reserved", "unavailable", "leaving"]


def _excluded(person: Any, reason: ExcludedReason, detail: str) -> ExcludedWorker:
    return ExcludedWorker(code=person["code"], name=person["name"], reason=reason, detail=detail)


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


@dataclass
class _Assignment:
    project_id: uuid.UUID
    project_code: str
    status: str
    first: date
    after_last: date | None  # None = open-ended

    @property
    def last_day(self) -> date | None:
        return None if self.after_last is None else self.after_last - timedelta(days=1)


def project_is_visible(user: AuthUser, project_id: uuid.UUID) -> bool:
    """Whether the caller's forecast scope includes this project."""
    scope = user.scope("forecast:read")
    if scope == "all":
        return True
    if scope in ("project", "site"):
        return project_id in user.whole_projects
    return False


def forecast_project(
    session: Session,
    user: AuthUser,
    settings: Settings,
    code: str,
    today: date,
    start: date | None = None,
) -> ProjectForecast | None:
    """The forecast for one project; None if it does not exist or is out of the caller's scope."""
    project = (
        session.execute(
            text(
                """SELECT id, code, name, status::text AS status, starts_on, ends_on
                   FROM projects WHERE code = :code"""
            ),
            {"code": code},
        )
        .mappings()
        .first()
    )
    if project is None or not project_is_visible(user, project["id"]):
        return None
    start = start or project["starts_on"]
    if start is None:
        raise ForecastError("This project has no start date yet. Choose one to see the forecast.")
    horizon = start + timedelta(days=settings.forecast_doc_horizon_days)
    window_end = min(horizon, project["ends_on"]) if project["ends_on"] else horizon
    window_end = max(window_end, start + timedelta(days=1))
    buffer = timedelta(days=settings.transfer_buffer_days)
    must_finish_by = start - buffer

    needs = (
        session.execute(
            text(
                """SELECT t.id, t.code, t.name, max(m.headcount) AS needed
               FROM manpower_requirements m JOIN trades t ON t.id = m.trade_id
               WHERE m.project_id = :pid AND m.period && daterange(:start, :end, '[)')
               GROUP BY t.id, t.code, t.name ORDER BY t.name"""
            ),
            {"pid": project["id"], "start": start, "end": window_end},
        )
        .mappings()
        .all()
    )
    trade_ids = [n["id"] for n in needs]

    people = (
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

    assignments: dict[uuid.UUID, list[_Assignment]] = defaultdict(list)
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
            _Assignment(
                r["project_id"], r["project_code"], r["status"], r["first"], r["after_last"]
            )
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

    def document_problem(employee_id: uuid.UUID) -> str | None:
        """Why the required documents do not cover the window, or None when they do."""
        held = documents[employee_id]
        for doc_type in required:
            expiry, status = held.get(doc_type, (None, "missing"))
            if status != "verified" or expiry is None:
                return f"{document_label(doc_type)} is not verified"
            if expiry < window_end:
                return f"{document_label(doc_type)} ends {_day(expiry)}"
        return None

    already = {
        r["trade_id"]: int(r["n"])
        for r in session.execute(
            text(
                """SELECT e.primary_trade_id AS trade_id, count(DISTINCT a.employee_id) AS n
                   FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
                   WHERE a.project_id = :pid AND a.status IN ('planned', 'active')
                     AND a.period @> CAST(:start AS date)
                   GROUP BY 1"""
            ),
            {"pid": project["id"], "start": start},
        ).mappings()
    }
    arrivals: dict[uuid.UUID, list[Arrival]] = defaultdict(list)
    for r in session.execute(
        text(
            """SELECT trade_id, status::text AS stage, headcount, source::text AS source,
                      expected_arrival
               FROM recruitment_requests
               WHERE project_id = :pid AND status::text = ANY(:stages)
               ORDER BY expected_arrival NULLS LAST, request_no"""
        ),
        {"pid": project["id"], "stages": list(OPEN_STAGES)},
    ).mappings():
        arrives: date | None = r["expected_arrival"]
        arrivals[r["trade_id"]].append(
            Arrival(
                stage=r["stage"],
                stage_label=stage_label(r["stage"]),
                stage_phrase=stage_phrase(r["stage"]),
                headcount=int(r["headcount"]),
                source=r["source"],
                expected_arrival=arrives,
                days_after_start=(arrives - start).days if arrives else None,
                late=arrives is not None and arrives > start,
            )
        )

    by_trade: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for person in people:
        by_trade[person["trade_id"]].append(person)

    trades: list[TradeForecast] = []
    for need in needs:
        available: list[Candidate] = []
        ending: dict[tuple[str, date], list[Candidate]] = defaultdict(list)
        late: list[LateCandidate] = []
        excluded: list[ExcludedWorker] = []

        for person in by_trade[need["id"]]:
            mine = assignments[person["id"]]
            if any(a.project_id == project["id"] for a in mine):
                continue  # already on this project (counted in "already assigned")
            problem = document_problem(person["id"])
            candidate = Candidate(
                code=person["code"],
                name=person["name"],
                level=person["level"],
                documents_valid=problem is None,
            )
            if person["availability"] == "unavailable":
                excluded.append(
                    _excluded(person, "unavailable", "Not available (leave or medical)")
                )
                continue

            # What the worker is doing during the cover window decides everything else.
            overlapping = [
                a
                for a in mine
                if a.first < window_end and (a.after_last is None or a.after_last > start)
            ]
            reserved = [a for a in overlapping if a.first > today]
            if reserved:
                a = reserved[0]
                excluded.append(
                    _excluded(
                        person,
                        "already_reserved",
                        f"Planned on {a.project_code} from {_day(a.first)}",
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
            if last is not None and last > start + timedelta(
                days=settings.forecast_late_window_days
            ):
                continue  # busy well past the start

            leaving = _leaving(person, window_end)
            if leaving:
                excluded.append(_excluded(person, "leaving", leaving))
                continue
            leave = on_leave.get(person["id"])
            if leave:
                excluded.append(
                    _excluded(
                        person, "on_leave", f"Approved leave {_day(leave[0])} to {_day(leave[1])}"
                    )
                )
                continue
            if latest is not None and last is not None and last > must_finish_by:
                late.append(
                    LateCandidate(
                        **candidate.model_dump(),
                        project_code=latest.project_code,
                        ends_on=last,
                        days_after_start=(last - start).days,
                    )
                )
                continue
            if problem:
                excluded.append(_excluded(person, "documents", problem))
                continue
            if latest is None or last is None:
                available.append(candidate)
            else:
                ending[(latest.project_code, last)].append(candidate)
        sources: list[ForecastSource] = []
        if available:
            sources.append(
                ForecastSource(
                    kind="available_now",
                    project_code=None,
                    ends_on=None,
                    must_finish_by=None,
                    workers=available,
                )
            )
        for (project_code, last), workers in sorted(
            ending.items(), key=lambda kv: (kv[0][1], kv[0][0])
        ):
            sources.append(
                ForecastSource(
                    kind="ending_before_start",
                    project_code=project_code,
                    ends_on=last,
                    must_finish_by=must_finish_by,
                    workers=workers,
                )
            )
        late.sort(key=lambda c: (c.days_after_start, c.code))

        needed = int(need["needed"])
        assigned = already.get(need["id"], 0)
        from_other = sum(len(s.workers) for s in sources if s.kind == "ending_before_start")
        deployable = len(available) + from_other
        gap = max(needed - assigned - deployable, 0)
        coming = arrivals.get(need["id"], [])
        waiting = sum(a.headcount for a in coming if not a.late)  # on time: reduces the gap
        uncovered = max(gap - waiting, 0)
        trades.append(
            TradeForecast(
                trade_code=need["code"],
                trade=need["name"],
                needed=needed,
                already_assigned=assigned,
                deployable=deployable,
                recruitment_pending=waiting,
                gap=gap,
                uncovered_gap=uncovered,
                sources=sources,
                late_candidates=late,
                arriving=coming,
                excluded=excluded,
                advice=recruitment_advice(
                    needed=needed,
                    already=assigned,
                    from_available=len(available),
                    gap=gap,
                    pending=waiting,
                    uncovered=uncovered,
                    late=late,
                    arrivals=coming,
                    start=start,
                    must_finish_by=must_finish_by,
                    today=today,
                    lead_local=settings.recruit_lead_days_local,
                    lead_overseas=settings.recruit_lead_days_overseas,
                ),
            )
        )

    return ProjectForecast(
        project=ForecastProject(
            code=project["code"],
            name=project["name"],
            status=project["status"],
            starts_on=project["starts_on"],
            ends_on=project["ends_on"],
        ),
        today=today,
        start=start,
        window_end=window_end,
        buffer_days=settings.transfer_buffer_days,
        late_window_days=settings.forecast_late_window_days,
        trades=trades,
    )


def _leaving(person: Any, window_end: date) -> str | None:
    """Why this person will not be here for the whole cover window, or None.

    An exit date or a contract end before the window closes means they cannot be counted on.
    (A renewal is not modelled yet; until HR can edit employees the dates come from the data.)
    """
    exit_on: date | None = person["exit_on"]
    if exit_on is not None and exit_on < window_end:
        why = EXIT_LABEL.get(person["exit_reason"] or "other", "leaving")
        return f"Leaving the company on {_day(exit_on)} ({why})"
    contract_end: date | None = person["contract_end_on"]
    if contract_end is not None and contract_end < window_end:
        return f"Contract ends {_day(contract_end)}"
    return None


def _arrival_sentence(late: list[Arrival]) -> str:
    """Name the recruits who arrive after the project has started."""
    parts: list[str] = []
    for a in late:
        assert a.expected_arrival is not None and a.days_after_start is not None
        parts.append(
            f"{a.headcount} {a.stage_phrase} "
            f"{'arrives' if a.headcount == 1 else 'arrive'} {_day(a.expected_arrival)}, "
            f"{_days(a.days_after_start)} after the start"
        )
    return f" {'; '.join(parts)}." if parts else ""


def recruitment_advice(
    *,
    needed: int,
    already: int,
    from_available: int,
    gap: int,
    pending: int,
    uncovered: int,
    late: list[LateCandidate],
    arrivals: list[Arrival],
    start: date,
    must_finish_by: date,
    today: date,
    lead_local: int,
    lead_overseas: int,
) -> Advice:
    """What to do about a trade, worded from the numbers (rule RECRUIT_ADVICE_PYTHON_ONLY)."""
    if gap == 0:
        open_places = max(needed - already, 0)
        from_others = max(open_places - from_available, 0)
        if from_others == 0:
            return Advice(verdict="covered", headline="Covered by people who are free now.")
        return Advice(
            verdict="covered_with_dependencies",
            headline=(
                f"Covered, but {from_others} still depend on other projects finishing "
                f"by {_day(must_finish_by)}."
            ),
        )
    late_arrivals = [a for a in arrivals if a.late]
    if uncovered == 0:
        on_time = [a for a in arrivals if not a.late]
        details = ", ".join(
            f"{a.headcount} {a.stage_phrase}"
            + (f" arrives {_day(a.expected_arrival)}" if a.expected_arrival else "")
            for a in on_time
        )
        return Advice(
            verdict="recruitment_pending",
            headline=f"Short by {gap}. Already on the way: {details}."
            + _arrival_sentence(late_arrivals),
        )
    local_by = start - timedelta(days=lead_local)
    overseas_by = start - timedelta(days=lead_overseas)
    local_passed, overseas_passed = local_by < today, overseas_by < today
    could = min(uncovered, len(late))
    chosen = late[:could]
    delay = max((max(c.days_after_start, 0) for c in chosen), default=None) if chosen else None
    instead = uncovered - could
    dates = f"Recruit {uncovered}: locally by {_day(local_by)}"
    dates += " (date passed)" if local_passed else ""
    dates += f", or overseas by {_day(overseas_by)}"
    dates += " (date passed)" if overseas_passed else ""
    if could == 0:
        headline = f"{dates}. Nobody else finishes in time."
    elif instead == 0:
        when = "just before the start" if not delay else f"within {_days(delay)} of the start"
        headline = (
            f"{dates}, or wait for {could} who {'finishes' if could == 1 else 'finish'} {when}."
        )
    else:
        headline = (
            f"{dates}, or have {could} start up to {_days(delay or 0)} late and recruit {instead}."
        )
    return Advice(
        verdict="recruit",
        headline=headline + _arrival_sentence(late_arrivals),
        recruit_count=uncovered,
        recruit_by=local_by,
        recruit_by_passed=local_passed,
        recruit_by_overseas=overseas_by,
        recruit_by_overseas_passed=overseas_passed,
        could_start_late=could,
        max_delay_days=delay,
        recruit_instead=instead,
    )
