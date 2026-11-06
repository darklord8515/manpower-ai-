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
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.config import Settings
from app.labels import OPEN_STAGES, stage_label, stage_phrase
from app.schemas import (
    Advice,
    Arrival,
    ForecastProject,
    ForecastSource,
    LateCandidate,
    ProjectForecast,
    ReservedWorker,
    TradeForecast,
)
from app.services.cover import classify, load_world


class ForecastError(ValueError):
    """The forecast cannot be made for the request as given (shown to the caller as a 422)."""


def _day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


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

    world = load_world(session, trade_ids, today, start, window_end, settings)

    already = {
        r["trade_id"]: int(r["n"])
        for r in session.execute(
            text(
                """SELECT e.primary_trade_id AS trade_id, count(DISTINCT a.employee_id) AS n
                   FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
                   WHERE a.project_id = :pid AND a.status IN ('planned', 'active')
                     AND a.period && daterange(:start, :end, '[)')
                   GROUP BY 1"""
            ),
            {"pid": project["id"], "start": start, "end": window_end},
        ).mappings()
    }
    planned_here: dict[uuid.UUID, list[ReservedWorker]] = defaultdict(list)
    for r in session.execute(
        text(
            """SELECT e.primary_trade_id AS trade_id, e.employee_code AS code, e.full_name AS name,
                      lower(a.period) AS starts_on, dp.code AS moving_from,
                      (upper(d.period) - 1) AS moving_from_ends
               FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
               LEFT JOIN employee_assignments d ON d.id = a.depends_on_assignment_id
               LEFT JOIN projects dp ON dp.id = d.project_id
               WHERE a.project_id = :pid AND a.status = 'planned'
               ORDER BY lower(a.period), e.employee_code"""
        ),
        {"pid": project["id"]},
    ).mappings():
        planned_here[r["trade_id"]].append(
            ReservedWorker(
                code=r["code"], name=r["name"], starts_on=r["starts_on"],
                moving_from=r["moving_from"], moving_from_ends=r["moving_from_ends"],
            )
        )  # fmt: skip

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

    trades: list[TradeForecast] = []
    for need in needs:
        classified = classify(world, need["id"], project["id"], today, settings)
        available, ending = classified.available, classified.ending
        late, excluded = classified.late, classified.excluded
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
                reserved=planned_here.get(need["id"], []),
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
