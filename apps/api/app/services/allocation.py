"""The Allocation Board's rules: who may be chosen for a request line, and what approving does.

Everything here is SQL and Python (rule FORECAST_PYTHON_ONLY); a model may later suggest names,
but only these functions decide whether a person may be chosen or approved. The hard rules are in
docs/rules.md: ASSIGN_*, DOC_VALID_THROUGH, LINE_*, APPROVAL_*, MOB_*.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.config import Settings
from app.schemas import (
    ApprovedWorker,
    ApprovePerson,
    ApproveResponse,
    BoardCandidate,
    BoardExcluded,
    LineCandidates,
    LineRow,
    LineSummary,
    PickResult,
    PickRow,
    PicksResponse,
    RequestDetail,
    RequestRow,
    RequestStatus,
    Violation,
)
from app.services.assignments import adopt_reservation, plan_assignment
from app.services.cover import (
    RULE_FOR_REASON,
    Classified,
    World,
    classify,
    day,
    leaving,
    load_world,
)
from app.services.mobilization import start_mobilization

# Said of someone who is simply busy on another project: not offered, and not worth flagging.
NOT_OFFERED = "Not available for these dates."


class AllocationError(Exception):
    """A request the board refuses, with the HTTP status the caller should answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Line:
    """One request line with the request and project it belongs to."""

    request_id: uuid.UUID
    request_no: str
    request_status: str
    requested_by: uuid.UUID
    requested_by_name: str
    project_id: uuid.UUID
    project_code: str
    project_name: str
    project_status: str
    project_ends: date | None
    needed_from: date
    needed_until: date | None
    priority: int
    created_at: datetime
    source_text: str | None
    line_id: uuid.UUID
    trade_id: uuid.UUID
    trade_code: str
    trade: str
    headcount: int
    min_level: int | None
    filled: int
    status: str

    @property
    def closed(self) -> bool:
        return self.request_status in ("cancelled", "rejected", "filled")

    def window(self, settings: Settings) -> tuple[date, date]:
        """(first day, day after the last) the person must be able to cover."""
        until = self.needed_until or (
            self.needed_from + timedelta(days=settings.doc_check_default_horizon_days - 1)
        )
        return self.needed_from, until + timedelta(days=1)


_LINES = """
SELECT r.id AS request_id, r.request_no, r.status::text AS request_status, r.requested_by,
       u.full_name AS requested_by_name, p.id AS project_id, p.code AS project_code,
       p.name AS project_name, p.status::text AS project_status, p.ends_on AS project_ends,
       r.needed_from, r.needed_until, r.priority, r.created_at, r.source_text,
       l.id AS line_id, t.id AS trade_id, t.code AS trade_code, t.name AS trade,
       l.headcount, l.min_level, l.filled, l.status::text AS status
FROM staffing_requests r
JOIN users u ON u.id = r.requested_by
JOIN projects p ON p.id = r.project_id
JOIN staffing_request_lines l ON l.request_id = r.id
JOIN trades t ON t.id = l.trade_id
"""


def _line(r: Any) -> Line:
    return Line(**{k: r[k] for k in Line.__dataclass_fields__})


def fetch_lines(session: Session, request_no: str) -> list[Line]:
    rows = session.execute(
        text(f"{_LINES} WHERE r.request_no = :no ORDER BY t.name"),  # noqa: S608
        {"no": request_no},
    ).mappings()
    return [_line(r) for r in rows]


def visible(user: AuthUser, project_id: uuid.UUID) -> bool:
    scope = user.scope("staffing:read")
    if scope == "all":
        return True
    return scope in ("project", "site") and project_id in user.whole_projects


# ------------------------------------------------------------------------------------- the pool


@dataclass
class Reserved:
    code: str
    first_day: date
    moving_from: str | None
    moving_from_ends: date | None


@dataclass
class Pool:
    line: Line
    start: date
    window_end: date
    world: World
    classified: Classified
    people: dict[str, Any]
    reserved: dict[str, Reserved]
    held: dict[str, str]  # code -> "SR-2026-0002 (Mason)": chosen on another open line


def build_pool(session: Session, settings: Settings, line: Line, today: date) -> Pool:
    start, window_end = line.window(settings)
    world = load_world(session, [line.trade_id], today, start, window_end, settings)
    classified = classify(world, line.trade_id, line.project_id, today, settings)
    reserved = {
        r["code"]: Reserved(r["code"], r["first_day"], r["moving_from"], r["moving_from_ends"])
        for r in session.execute(
            text(
                """SELECT e.employee_code AS code, lower(a.period) AS first_day,
                          dp.code AS moving_from, (upper(d.period) - 1) AS moving_from_ends
                   FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
                   LEFT JOIN employee_assignments d ON d.id = a.depends_on_assignment_id
                   LEFT JOIN projects dp ON dp.id = d.project_id
                   WHERE a.project_id = :pid AND a.status = 'planned'
                     AND a.request_line_id IS NULL AND a.approved_by IS NOT NULL
                     AND e.primary_trade_id = :trade"""
            ),
            {"pid": line.project_id, "trade": line.trade_id},
        ).mappings()
    }
    held = {
        r["code"]: f"{r['request_no']} ({r['trade']})"
        for r in session.execute(
            text(
                """SELECT e.employee_code AS code, r.request_no, t.name AS trade
                   FROM staffing_request_picks pk
                   JOIN staffing_request_lines l ON l.id = pk.line_id
                   JOIN staffing_requests r ON r.id = l.request_id
                   JOIN trades t ON t.id = l.trade_id
                   JOIN employees e ON e.id = pk.employee_id
                   WHERE pk.removed_reason IS NULL AND l.id <> :line AND l.status = 'open'
                     AND r.status NOT IN ('cancelled', 'rejected', 'filled')"""
            ),
            {"line": line.line_id},
        ).mappings()
    }
    return Pool(
        line, start, window_end, world, classified, {p["code"]: p for p in world.people},
        reserved, held,
    )  # fmt: skip


@dataclass
class Verdict:
    code: str
    name: str
    level: int | None
    group: str | None  # free | finishing | late | reserved | None (not offered)
    from_project: str | None
    ends_on: date | None
    starts_on: date | None
    documents_until: date | None
    documents_valid: bool
    violations: list[Violation]


def _documents_until(pool: Pool, person: Any) -> date | None:
    held = pool.world.documents[person["id"]]
    dates: list[date] = []
    for doc_type in pool.world.required:
        expiry = held[doc_type][0] if doc_type in held else None
        if expiry is not None:
            dates.append(expiry)
    return min(dates) if dates else None


def verdict(pool: Pool, code: str) -> Verdict:
    """Everything the rules say about choosing this person for this line."""
    person = pool.people.get(code)
    if person is None:
        return Verdict(
            code, code, None, None, None, None, None, None, False,
            [Violation(rule="ASSIGN_TRADE", message=f"Not a {pool.line.trade.lower()}.")],
        )  # fmt: skip
    violations: list[Violation] = []
    group: str | None = None
    from_project: str | None = None
    ends_on: date | None = None
    starts_on: date | None = None
    docs_ok = pool.world.document_problem(person["id"]) is None
    refused = {e.code: e for e in pool.classified.excluded}
    origins = pool.classified.origins()
    if code in refused:
        e = refused[code]
        violations.append(Violation(rule=RULE_FOR_REASON[e.reason], message=e.detail))
    elif code in origins:
        from_project, ends_on = origins[code]
        if from_project is None:
            group, starts_on = "free", pool.start
        elif code in {late.code for late in pool.classified.late}:
            group = "late"
            starts_on = (ends_on + timedelta(days=1)) if ends_on else pool.start
        else:
            group, starts_on = "finishing", pool.start
        problem = pool.world.document_problem(person["id"])
        if problem:
            violations.append(Violation(rule="DOC_VALID_THROUGH", message=problem))
    elif code in pool.reserved:
        held_here = pool.reserved[code]
        group, starts_on = "reserved", held_here.first_day
        from_project, ends_on = held_here.moving_from, held_here.moving_from_ends
        problem = pool.world.document_problem(person["id"])
        if problem:
            violations.append(Violation(rule="DOC_VALID_THROUGH", message=problem))
        gone = leaving(person, pool.window_end)
        if gone:
            violations.append(Violation(rule="ASSIGN_STATUS", message=gone))
        leave = pool.world.on_leave.get(person["id"])
        if leave:
            violations.append(
                Violation(
                    rule="ASSIGN_LEAVE",
                    message=f"Approved leave {day(leave[0])} to {day(leave[1])}",
                )
            )
    else:
        violations.append(Violation(rule="ASSIGN_AVAILABILITY", message=NOT_OFFERED))
    level: int | None = person["level"]
    wanted = pool.line.min_level
    if wanted is not None and (level is None or level < wanted):
        violations.append(
            Violation(
                rule="ASSIGN_LEVEL",
                message=(
                    f"Level {level} is below the level {wanted} this line asks for."
                    if level
                    else f"No skill level on file; the line asks for level {wanted}."
                ),
            )
        )
    if code in pool.held:
        violations.append(
            Violation(rule="ASSIGN_ONE_LINE", message=f"Already chosen on {pool.held[code]}.")
        )
    return Verdict(
        code, person["name"], level, group, from_project, ends_on, starts_on,
        _documents_until(pool, person), docs_ok, violations,
    )  # fmt: skip


def _why(v: Verdict) -> str:
    level = f"level {v.level}" if v.level else "no level on file"
    until = f", documents valid to {day(v.documents_until)}" if v.documents_until else ""
    if v.group == "free":
        return f"Free now, {level}{until}"
    if v.group == "reserved":
        return f"Already reserved for this project, {level}{until}"
    where = f"{v.from_project}" if v.from_project else "another project"
    when = day(v.ends_on) if v.ends_on else "?"
    if v.group == "late":
        starts = day(v.starts_on) if v.starts_on else "?"
        return f"Finishes on {where} on {when}, so starts {starts}, {level}{until}"
    return f"Finishes on {where} on {when}, {level}{until}"


# ------------------------------------------------------------------------------------- picks


def active_picks(session: Session, line_id: uuid.UUID) -> list[str]:
    return [
        r[0]
        for r in session.execute(
            text(
                """SELECT e.employee_code FROM staffing_request_picks pk
                   JOIN employees e ON e.id = pk.employee_id
                   WHERE pk.line_id = :line AND pk.removed_reason IS NULL
                   ORDER BY pk.created_at, e.employee_code"""
            ),
            {"line": line_id},
        )
    ]


def open_slots(line: Line, chosen: int) -> int:
    return max(line.headcount - line.filled - chosen, 0)


def require_open(line: Line) -> None:
    if line.closed:
        raise AllocationError(409, f"{line.request_no} is {line.request_status.replace('_', ' ')}.")
    if line.status != "open":
        raise AllocationError(409, f"This {line.trade.lower()} line is already {line.status}.")


def candidates(
    session: Session,
    settings: Settings,
    line: Line,
    today: date,
    q: str = "",
    min_level: int | None = None,
    documents_valid_only: bool = False,
) -> LineCandidates:
    pool = build_pool(session, settings, line, today)
    chosen = set(active_picks(session, line.line_id))
    found: list[BoardCandidate] = []
    blocked: list[BoardExcluded] = []
    needle = q.strip().lower()
    for code, person in pool.people.items():
        if needle and needle not in person["name"].lower() and needle not in code.lower():
            continue
        v = verdict(pool, code)
        if min_level and (v.level or 0) < min_level:
            continue
        if v.group is None or any(x.rule != "ASSIGN_ONE_LINE" for x in v.violations):
            first = v.violations[0] if v.violations else None
            # Someone simply busy on another project is not a finding, just not on offer.
            if first and first.message != NOT_OFFERED:
                blocked.append(
                    BoardExcluded(code=code, name=v.name, rule=first.rule, message=first.message)
                )
            continue
        if documents_valid_only and not v.documents_valid:
            continue
        if code in pool.held and code not in chosen:
            blocked.append(
                BoardExcluded(
                    code=code, name=v.name, rule="ASSIGN_ONE_LINE",
                    message=f"Already chosen on {pool.held[code]}.",
                )
            )  # fmt: skip
            continue
        assert v.group in ("free", "finishing", "late", "reserved") and v.starts_on
        found.append(
            BoardCandidate(
                code=code, name=v.name, level=v.level, group=v.group,  # type: ignore[arg-type]
                from_project=v.from_project, ends_on=v.ends_on, starts_on=v.starts_on,
                documents_valid=v.documents_valid, picked=code in chosen,
            )
        )  # fmt: skip
    order = {"reserved": 0, "free": 1, "finishing": 2, "late": 3}
    found.sort(key=lambda c: (order[c.group], -(c.level or 0), c.code))
    return LineCandidates(
        candidates=found, excluded=blocked,
        open_slots=open_slots(line, len(chosen)), window_end=pool.window_end,
    )  # fmt: skip


def add_picks(
    session: Session,
    settings: Settings,
    user: AuthUser,
    line: Line,
    codes: list[str],
    today: date,
    source: str = "hr",
    reasons: dict[str, str] | None = None,
) -> PicksResponse:
    require_open(line)
    pool = build_pool(session, settings, line, today)
    chosen = active_picks(session, line.line_id)
    results: list[PickResult] = []
    for code in codes:
        v = verdict(pool, code)
        problems = list(v.violations)
        if code in chosen:
            problems = [Violation(rule="ASSIGN_ONE_LINE", message="Already chosen on this line.")]
        elif open_slots(line, len(chosen)) == 0:
            problems.append(
                Violation(
                    rule="ASSIGN_HEADCOUNT",
                    message=f"The line asks for {line.headcount}; every place is taken.",
                )
            )
        if problems:
            results.append(
                PickResult(code=code, name=v.name, outcome="refused", violations=problems)
            )
            continue
        session.execute(
            text(
                """INSERT INTO staffing_request_picks
                   (line_id, employee_id, source, reason, picked_by)
                   SELECT :line, e.id, :source, :reason, :user FROM employees e
                   WHERE e.employee_code = :code
                   ON CONFLICT (line_id, employee_id)
                   DO UPDATE SET removed_reason = NULL, source = :source, reason = :reason,
                                 picked_by = :user"""
            ),
            {
                "line": line.line_id, "source": source, "user": user.id, "code": code,
                "reason": (reasons or {}).get(code) or _why(v),
            },
        )  # fmt: skip
        chosen.append(code)
        results.append(PickResult(code=code, name=v.name, outcome="chosen", violations=[]))
    return PicksResponse(results=results, chosen=sum(r.outcome == "chosen" for r in results))


def remove_pick(session: Session, line: Line, code: str, reason: str) -> None:
    require_open(line)
    removed = session.execute(
        text(
            """UPDATE staffing_request_picks pk SET removed_reason = :reason
               FROM employees e WHERE e.id = pk.employee_id AND e.employee_code = :code
                 AND pk.line_id = :line AND pk.removed_reason IS NULL
               RETURNING pk.id"""
        ),
        {"reason": reason, "code": code, "line": line.line_id},
    ).all()
    if not removed:
        raise AllocationError(404, "That person is not chosen on this line.")


def restore_pick(
    session: Session, settings: Settings, user: AuthUser, line: Line, code: str, today: date
) -> PicksResponse:
    require_open(line)
    removed = session.execute(
        text(
            """SELECT 1 FROM staffing_request_picks pk JOIN employees e ON e.id = pk.employee_id
               WHERE pk.line_id = :line AND e.employee_code = :code
                 AND pk.removed_reason IS NOT NULL"""
        ),
        {"line": line.line_id, "code": code},
    ).first()
    if removed is None:
        raise AllocationError(404, "That person was not taken off this line.")
    return add_picks(session, settings, user, line, [code], today)


def suggest(
    session: Session, settings: Settings, user: AuthUser, line: Line, today: date
) -> PicksResponse:
    """Fill the open places with the best cleared people (rules, no AI; same checks as a click)."""
    require_open(line)
    pool = build_pool(session, settings, line, today)
    chosen = set(active_picks(session, line.line_id))
    slots = open_slots(line, len(chosen))
    order = {"reserved": 0, "free": 1, "finishing": 2}
    ranked: list[Verdict] = []
    for code in pool.people:
        v = verdict(pool, code)
        if v.violations or v.group not in order or code in chosen:
            continue  # a person who would start late is for HR to choose, never suggested
        ranked.append(v)
    ranked.sort(key=lambda v: (order[v.group or "finishing"], -(v.level or 0), v.code))
    picked = ranked[:slots]
    if not picked:
        return PicksResponse(results=[], chosen=0)
    return add_picks(
        session, settings, user, line, [v.code for v in picked], today, source="rules",
        reasons={v.code: _why(v) for v in picked},
    )  # fmt: skip


# ------------------------------------------------------------------------------------- reading


def request_status_of(session: Session, request_id: uuid.UUID) -> RequestStatus:
    """The request's status from its lines (LINE_PARTIAL: a half-filled line keeps the gap)."""
    rows = session.execute(
        text(
            """SELECT l.status::text AS status, l.headcount, l.filled FROM staffing_request_lines l
               WHERE l.request_id = :id"""
        ),
        {"id": request_id},
    ).mappings().all()  # fmt: skip
    if all(r["status"] == "rejected" for r in rows):
        return "rejected"
    open_lines = [r for r in rows if r["status"] == "open"]
    filled = sum(r["filled"] for r in rows)
    if open_lines:
        if filled:
            return "partially_filled"
        return "in_review" if any(r["status"] != "open" for r in rows) else "submitted"
    if all(r["status"] == "approved" and r["filled"] == r["headcount"] for r in rows):
        return "filled"
    return "partially_filled" if filled else "rejected"


def request_rows(
    session: Session, where: str, params: dict[str, Any], today: date
) -> list[RequestRow]:
    rows = session.execute(
        text(
            f"""SELECT r.id, r.request_no, p.code AS project_code, p.name AS project_name,
                       r.needed_from, r.needed_until, r.priority, r.status::text AS status,
                       u.full_name AS requested_by, r.created_at
                FROM staffing_requests r JOIN projects p ON p.id = r.project_id
                JOIN users u ON u.id = r.requested_by
                WHERE {where}
                ORDER BY (r.status IN ('filled', 'rejected', 'cancelled')), r.needed_from,
                         r.priority, r.request_no"""  # noqa: S608
        ),
        params,
    ).mappings().all()  # fmt: skip
    ids = [r["id"] for r in rows]
    lines: dict[uuid.UUID, list[LineSummary]] = {}
    for r in session.execute(
        text(
            """SELECT l.request_id, t.name AS trade, l.headcount, l.filled,
                      l.status::text AS status,
                      (SELECT count(*) FROM staffing_request_picks pk
                       WHERE pk.line_id = l.id AND pk.removed_reason IS NULL) AS chosen
               FROM staffing_request_lines l JOIN trades t ON t.id = l.trade_id
               WHERE l.request_id = ANY(:ids) ORDER BY t.name"""
        ),
        {"ids": ids},
    ).mappings():
        lines.setdefault(r["request_id"], []).append(
            LineSummary(
                trade=r["trade"], headcount=r["headcount"], filled=r["filled"],
                chosen=int(r["chosen"]), status=r["status"],
            )
        )  # fmt: skip
    return [
        RequestRow(
            request_no=r["request_no"], project_code=r["project_code"],
            project_name=r["project_name"], needed_from=r["needed_from"],
            needed_until=r["needed_until"], priority=r["priority"], status=r["status"],
            requested_by=r["requested_by"], created_at=r["created_at"],
            waiting_days=max((today - r["created_at"].date()).days, 0),
            lines=lines.get(r["id"], []),
        )
        for r in rows
    ]  # fmt: skip


def request_detail(
    session: Session, settings: Settings, user: AuthUser, request_no: str, today: date
) -> RequestDetail | None:
    lines = fetch_lines(session, request_no)
    if not lines or not visible(user, lines[0].project_id):
        return None
    head = lines[0]
    row = request_rows(session, "r.request_no = :no", {"no": request_no}, today)[0]
    full: list[LineRow] = []
    for line in lines:
        pool = build_pool(session, settings, line, today) if line.status == "open" else None
        picks: list[PickRow] = []
        for r in session.execute(
            text(
                """SELECT e.employee_code AS code, pk.source, pk.reason, pk.removed_reason
                   FROM staffing_request_picks pk JOIN employees e ON e.id = pk.employee_id
                   WHERE pk.line_id = :line ORDER BY (pk.removed_reason IS NOT NULL),
                         pk.created_at, e.employee_code"""
            ),
            {"line": line.line_id},
        ).mappings():
            v = verdict(pool, r["code"]) if pool and r["removed_reason"] is None else None
            name = v.name if v else session.execute(
                text("SELECT full_name FROM employees WHERE employee_code = :c"), {"c": r["code"]}
            ).scalar_one()  # fmt: skip
            picks.append(
                PickRow(
                    code=r["code"], name=name, level=v.level if v else None, source=r["source"],
                    reason=r["reason"], removed_reason=r["removed_reason"],
                    group=v.group if v else None, from_project=v.from_project if v else None,
                    starts_on=v.starts_on if v else None,
                    documents_until=v.documents_until if v else None,
                    violations=v.violations if v else [],
                )
            )  # fmt: skip
        approved = [
            ApprovedWorker(
                code=a["code"],
                name=a["name"],
                starts_on=a["starts_on"],
                moving_from=a["moving_from"],
                mob_no=a["mob_no"],
            )
            for a in session.execute(
                text(
                    """SELECT e.employee_code AS code, e.full_name AS name,
                              lower(a.period) AS starts_on, dp.code AS moving_from, m.mob_no
                       FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
                       LEFT JOIN employee_assignments d ON d.id = a.depends_on_assignment_id
                       LEFT JOIN projects dp ON dp.id = d.project_id
                       LEFT JOIN mobilizations m ON m.assignment_id = a.id
                       WHERE a.request_line_id = :line AND a.status IN ('planned', 'active')
                       ORDER BY lower(a.period), e.employee_code"""
                ),
                {"line": line.line_id},
            ).mappings()
        ]
        decider = None
        if line.status != "open":
            decider = session.execute(
                text(
                    """SELECT u.full_name, l.decided_at, l.decision_reason
                       FROM staffing_request_lines l LEFT JOIN users u ON u.id = l.decided_by
                       WHERE l.id = :id"""
                ),
                {"id": line.line_id},
            ).mappings().one()  # fmt: skip
        full.append(
            LineRow(
                id=str(line.line_id), trade_code=line.trade_code, trade=line.trade,
                headcount=line.headcount, min_level=line.min_level, filled=line.filled,
                status=line.status,  # type: ignore[arg-type]
                decided_by=decider["full_name"] if decider else None,
                decided_at=decider["decided_at"] if decider else None,
                decision_reason=decider["decision_reason"] if decider else None,
                picks=picks, approved=approved,
            )
        )  # fmt: skip
    allowed, note = can_approve(user, head)
    return RequestDetail(
        **{**row.model_dump(), "lines": full},  # type: ignore[arg-type]
        project_status=head.project_status, source_text=head.source_text,
        requested_by_id=str(head.requested_by), can_approve=allowed, approve_note=note,
    )  # fmt: skip


def can_approve(user: AuthUser, line: Line) -> tuple[bool, str | None]:
    """Whether this caller may approve, and if not, why (shown instead of a dead button)."""
    if not user.can("staffing:approve"):
        return False, "Approving needs the HR Manager."
    if user.id == line.requested_by:
        return False, "You raised this request, so someone else has to approve it."
    if line.closed:
        return False, f"{line.request_no} is {line.request_status.replace('_', ' ')}."
    return True, None


# ------------------------------------------------------------------------------------- deciding


def _decide_request(session: Session, line: Line, user: AuthUser) -> RequestStatus:
    """Recompute the request's status and close its approval once every line has an answer."""
    status = request_status_of(session, line.request_id)
    session.execute(
        text("UPDATE staffing_requests SET status = CAST(:s AS request_status) WHERE id = :id"),
        {"s": status, "id": line.request_id},
    )
    open_left = session.execute(
        text(
            "SELECT count(*) FROM staffing_request_lines WHERE request_id = :id AND status = 'open'"
        ),
        {"id": line.request_id},
    ).scalar_one()
    if open_left == 0:
        decision = "rejected" if status == "rejected" else "approved"
        session.execute(
            text(
                """UPDATE approval_requests SET status = CAST(:d AS approval_status),
                          decided_at = now()
                   WHERE subject_type = 'staffing_request' AND subject_id = :id
                     AND status = 'pending'"""
            ),
            {"d": decision, "id": line.request_id},
        )
        session.execute(
            text(
                """UPDATE approval_steps s SET decision = CAST(:d AS approval_status),
                          decided_by = :user, decided_at = now()
                   FROM approval_requests a
                   WHERE a.id = s.approval_id AND a.subject_type = 'staffing_request'
                     AND a.subject_id = :id AND s.decision = 'pending'"""
            ),
            {"d": decision, "user": user.id, "id": line.request_id},
        )
    return status  # type: ignore[return-value]


def approve_line(
    session: Session,
    settings: Settings,
    user: AuthUser,
    line: Line,
    codes: list[str] | None,
    today: date,
    preview: bool,
) -> ApproveResponse:
    """Approve the chosen people on a line (or show exactly what approving would do)."""
    require_open(line)
    allowed, note = can_approve(user, line)
    if not allowed:
        raise AllocationError(
            403 if not user.can("staffing:approve") else 409, note or "Not allowed"
        )
    chosen = active_picks(session, line.line_id)
    wanted = [c for c in (codes if codes is not None else chosen)]
    unknown = [c for c in wanted if c not in chosen]
    if unknown:
        raise AllocationError(422, f"Not chosen on this line: {', '.join(unknown)}")
    if not wanted:
        raise AllocationError(422, "Nobody is chosen on this line yet.")
    room = line.headcount - line.filled
    if len(wanted) > room:
        raise AllocationError(
            422, f"The line has {room} place{'s' if room != 1 else ''} left; {len(wanted)} chosen."
        )
    pool = build_pool(session, settings, line, today)
    people: list[ApprovePerson] = []
    blocked = False
    verdicts: dict[str, Verdict] = {}
    for code in wanted:
        v = verdict(pool, code)  # APPROVAL_REVALIDATE: everything is checked again, now
        verdicts[code] = v
        blocked = blocked or bool(v.violations)
        people.append(
            ApprovePerson(
                code=code,
                name=v.name,
                starts_on=v.starts_on or pool.start,
                moving_from=v.from_project,
                moving_from_ends=v.ends_on,
                becomes_mobilizing=v.group in ("free", "reserved")
                and pool.people[code]["availability"] == "available",
                violations=v.violations,
            )
        )
    filled_after = line.filled + len(wanted)
    complete = filled_after == line.headcount
    after = _status_after(session, line, complete)
    response = ApproveResponse(
        preview=preview, ok=not blocked, request_no=line.request_no, trade=line.trade,
        people=people, assignments=len(people), mobilizations=len(people),
        depend_on_other_jobs=sum(1 for p in people if p.moving_from),
        filled_after=filled_after, headcount=line.headcount, request_status_after=after,
    )  # fmt: skip
    if preview or blocked:
        return response

    last_exclusive = (
        line.needed_until + timedelta(days=1)
        if line.needed_until
        else (line.project_ends + timedelta(days=1) if line.project_ends else None)
    )
    mobilizing = user.can("mobilization:approve")
    try:
        for person in people:
            v = verdicts[person.code]
            assignment_id = adopt_reservation(
                session, employee_code=person.code, project_id=line.project_id,
                request_line_id=line.line_id, approver_id=user.id,
            )  # fmt: skip
            if assignment_id is None:
                assignment_id = plan_assignment(
                    session, employee_code=person.code, project_id=line.project_id,
                    first_day=person.starts_on, last_exclusive=last_exclusive,
                    approver_id=user.id, from_project=v.from_project,
                    after_last=(v.ends_on + timedelta(days=1)) if v.ends_on else None,
                    request_line_id=line.line_id,
                )  # fmt: skip
            person.mob_no = start_mobilization(
                session,
                assignment_id=assignment_id,
                report_on=person.starts_on,
                today=today,
                approved=mobilizing,
            )
            if person.becomes_mobilizing:
                session.execute(
                    text(
                        """UPDATE employees SET availability = 'mobilizing'
                           WHERE employee_code = :c AND availability = 'available'"""
                    ),
                    {"c": person.code},
                )
    except IntegrityError as error:
        session.rollback()
        raise AllocationError(
            409,
            "Someone on this line was planned elsewhere at the same time. Check the line again.",
        ) from error
    session.execute(
        text(
            """DELETE FROM staffing_request_picks pk USING employees e
               WHERE e.id = pk.employee_id AND pk.line_id = :line
                 AND e.employee_code = ANY(:codes)"""
        ),
        {"line": line.line_id, "codes": wanted},
    )
    session.execute(
        text(
            """UPDATE staffing_request_lines
               SET filled = :filled, status = CAST(:status AS line_status),
                   decided_by = :user, decided_at = now()
               WHERE id = :id"""
        ),
        {
            "filled": filled_after,
            "status": "approved" if complete else "open",
            "user": user.id,
            "id": line.line_id,
        },
    )
    response.request_status_after = _decide_request(session, line, user)
    return response


def _status_after(session: Session, line: Line, line_complete: bool) -> RequestStatus:
    """What the request's status would be if this line took `filled_after` people."""
    others = session.execute(
        text(
            """SELECT l.status::text AS status, l.headcount, l.filled
               FROM staffing_request_lines l WHERE l.request_id = :id AND l.id <> :line"""
        ),
        {"id": line.request_id, "line": line.line_id},
    ).mappings().all()  # fmt: skip
    if line_complete and all(
        o["status"] == "approved" and o["filled"] == o["headcount"] for o in others
    ):
        return "filled"
    return "partially_filled"


def reject_line(
    session: Session, user: AuthUser, line: Line, reason: str, today: date
) -> RequestStatus:
    require_open(line)
    allowed, note = can_approve(user, line)
    if not allowed:
        raise AllocationError(
            403 if not user.can("staffing:approve") else 409, note or "Not allowed"
        )
    session.execute(
        text(
            """UPDATE staffing_request_picks SET removed_reason = 'The line was rejected'
               WHERE line_id = :line AND removed_reason IS NULL"""
        ),
        {"line": line.line_id},
    )
    session.execute(
        text(
            """UPDATE staffing_request_lines
               SET status = 'rejected', decided_by = :user, decided_at = now(),
                   decision_reason = :reason
               WHERE id = :id"""
        ),
        {"user": user.id, "reason": reason, "id": line.line_id},
    )
    return _decide_request(session, line, user)


def cancel_request(session: Session, user: AuthUser, lines: list[Line], reason: str) -> None:
    head = lines[0]
    if head.closed:
        raise AllocationError(409, f"{head.request_no} is {head.request_status.replace('_', ' ')}.")
    if any(line.filled for line in lines):
        raise AllocationError(
            409, "People are already approved on this request. Release them before cancelling it."
        )
    if user.id != head.requested_by and not user.can("staffing:approve"):
        raise AllocationError(403, "Only the person who raised it, or an approver, can cancel it.")
    session.execute(
        text(
            """UPDATE staffing_request_picks SET removed_reason = 'The request was cancelled'
               WHERE removed_reason IS NULL AND line_id IN
                     (SELECT id FROM staffing_request_lines WHERE request_id = :id)"""
        ),
        {"id": head.request_id},
    )
    session.execute(
        text("UPDATE staffing_requests SET status = 'cancelled' WHERE id = :id"),
        {"id": head.request_id},
    )
    session.execute(
        text(
            """UPDATE approval_requests SET status = 'cancelled', decided_at = now()
               WHERE subject_type = 'staffing_request' AND subject_id = :id
                 AND status = 'pending'"""
        ),
        {"id": head.request_id},
    )
    _ = reason  # kept in the audit entry by the route
