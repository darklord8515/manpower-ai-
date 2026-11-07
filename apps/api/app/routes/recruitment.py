"""Recruitment requests: raise one, follow it through the pipeline, see who needs a replacement.

The stages are the ones HR already keeps in Excel (Future requirement, Under recruitment, Offer
issued, Visa processing, Arrived pending deployment, Active). Only people press these buttons.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session
from app.labels import EXIT_LABEL, OPEN_STAGES, stage_label
from app.schemas import (
    AdvanceRecruitment,
    AdvanceResult,
    LeavingWorker,
    NewRecruitment,
    RecruitmentList,
    RecruitmentRow,
)
from app.services.alerts.engine import run_after_change

router = APIRouter(prefix="/recruitment-requests", tags=["recruitment"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Reader = Annotated[AuthUser, Depends(require("recruitment:read"))]
Creator = Annotated[AuthUser, Depends(require("recruitment:create"))]

# How far ahead "leaving with no replacement" looks. A recruit takes weeks, so six months is fair.
LEAVING_HORIZON_DAYS = 180

# The pipeline in order. A request moves one step at a time, or is cancelled.
ORDER = ("open", "sourcing", "offer_issued", "visa_processing", "arrived", "filled")

_SELECT = """
SELECT r.id, r.request_no, pr.code AS project_code, pr.name AS project_name,
       pr.starts_on AS project_starts_on, t.code AS trade_code, t.name AS trade,
       r.headcount, r.needed_by, r.status::text AS stage, r.source::text AS source,
       r.expected_arrival, r.reason, r.created_at,
       e.employee_code AS replaces_code, e.full_name AS replaces_name
FROM recruitment_requests r
JOIN trades t ON t.id = r.trade_id
LEFT JOIN projects pr ON pr.id = r.project_id
LEFT JOIN employees e ON e.id = r.replaces_employee_id
"""


def _day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


def _row(r: Any, today: date) -> RecruitmentRow:
    arrival: date | None = r["expected_arrival"]
    starts: date | None = r["project_starts_on"]
    # For a project that has not started, late means after its start. A running project has no
    # start to miss, so late means after the date the people were needed by.
    deadline = starts if starts and starts > today else r["needed_by"]
    return RecruitmentRow(
        id=str(r["id"]), request_no=r["request_no"], project_code=r["project_code"],
        project_name=r["project_name"], project_starts_on=starts, trade_code=r["trade_code"],
        trade=r["trade"], headcount=r["headcount"], needed_by=r["needed_by"], stage=r["stage"],
        stage_label=stage_label(r["stage"]), source=r["source"], expected_arrival=arrival,
        arrives_late=bool(arrival and arrival > deadline and r["stage"] in OPEN_STAGES),
        reason=r["reason"], replaces_code=r["replaces_code"], replaces_name=r["replaces_name"],
        created_at=r["created_at"],
    )  # fmt: skip


def _visible_projects_sql(user: AuthUser) -> tuple[str, dict[str, Any]]:
    scope = user.scope("recruitment:read")
    if scope == "all":
        return "TRUE", {}
    if scope in ("project", "site"):
        return "r.project_id = ANY(:scope_projects)", {"scope_projects": list(user.whole_projects)}
    return "FALSE", {}


def _get(session: Session, request_id: uuid.UUID, today: date) -> RecruitmentRow:
    row = session.execute(text(f"{_SELECT} WHERE r.id = :id"), {"id": request_id}).mappings().one()  # noqa: S608
    return _row(row, today)


@router.get("")
def list_requests(
    session: SessionDep, clock: ClockDep, settings: SettingsDep, user: Reader
) -> RecruitmentList:
    visible, params = _visible_projects_sql(user)
    rows = session.execute(
        text(
            f"""{_SELECT} WHERE {visible}
                ORDER BY (r.status IN ('filled', 'cancelled')), r.expected_arrival NULLS LAST,
                         r.request_no"""  # noqa: S608
        ),
        params,
    ).mappings()
    return RecruitmentList(
        today=clock.today(),
        requests=[_row(r, clock.today()) for r in rows],
        leaving=_leaving(session, user, clock, settings),
    )


def _leaving(
    session: Session, user: AuthUser, clock: Clock, settings: Settings
) -> list[LeavingWorker]:
    """People who are going (exit, contract end, left without notice) and have no replacement."""
    if not full_profile(user):
        return []
    today = clock.today()
    scope_sql, params = employee_scope(user, "employee:read")
    rows = session.execute(
        text(
            f"""SELECT e.employee_code AS code, e.full_name AS name, t.code AS trade_code,
                       t.name AS trade, e.employment_status::text AS employment,
                       e.exit_on, e.exit_reason::text AS exit_reason, e.contract_end_on,
                       (SELECT pr.code FROM employee_assignments a JOIN projects pr
                            ON pr.id = a.project_id
                        WHERE a.employee_id = e.id AND a.status IN ('planned', 'active')
                        ORDER BY a.period LIMIT 1) AS project_code
                FROM employees e JOIN trades t ON t.id = e.primary_trade_id
                WHERE ({scope_sql})
                  AND (
                    (e.exit_on BETWEEN :from_day AND :exit_to)
                    OR (e.contract_end_on BETWEEN :today AND :contract_to)
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM recruitment_requests r
                    WHERE r.replaces_employee_id = e.id AND r.status <> 'cancelled')
                ORDER BY coalesce(e.exit_on, e.contract_end_on), e.employee_code"""  # noqa: S608
        ),
        {
            **params, "today": today, "from_day": today - timedelta(days=30),
            "exit_to": today + timedelta(days=LEAVING_HORIZON_DAYS),
            "contract_to": today + timedelta(days=LEAVING_HORIZON_DAYS),
        },
    ).mappings()  # fmt: skip
    out: list[LeavingWorker] = []
    for r in rows:
        if r["employment"] == "absconded" and r["exit_on"]:
            kind, on, detail = (
                "absconded",
                r["exit_on"],
                f"Left without notice on {_day(r['exit_on'])}",
            )
        elif r["exit_on"]:
            why = EXIT_LABEL.get(r["exit_reason"] or "other", "leaving")
            kind, on, detail = "exit", r["exit_on"], f"Leaving on {_day(r['exit_on'])} ({why})"
        else:
            kind, on = "contract_end", r["contract_end_on"]
            detail = f"Contract ends {_day(r['contract_end_on'])}"
        out.append(
            LeavingWorker(
                code=r["code"], name=r["name"], trade_code=r["trade_code"], trade=r["trade"],
                project_code=r["project_code"], kind=kind, on=on, detail=detail,  # type: ignore[arg-type]
            )
        )  # fmt: skip
    return out


@router.post("", status_code=status.HTTP_201_CREATED)
def raise_request(
    body: NewRecruitment,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> RecruitmentRow:
    """Ask for people. It starts as a future requirement and counts as pending in the forecast."""
    today = clock.today()
    if body.needed_by < today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The needed-by date cannot be in the past."
        )
    if body.expected_arrival and body.expected_arrival < today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The expected arrival cannot be in the past."
        )
    trade_id = session.execute(
        text("SELECT id FROM trades WHERE code = :c"), {"c": body.trade}
    ).scalar_one_or_none()
    if trade_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown trade: {body.trade}")
    project_id = None
    if body.project:
        project_id = session.execute(
            text("SELECT id FROM projects WHERE code = :c"), {"c": body.project}
        ).scalar_one_or_none()
        if project_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown project: {body.project}"
            )
        scope = user.scope("recruitment:create")
        if scope != "all" and project_id not in user.whole_projects:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    replaces_id = None
    if body.replaces:
        scope_sql, params = employee_scope(user, "employee:read")
        replaces_id = session.execute(
            text(f"SELECT e.id FROM employees e WHERE e.employee_code = :c AND ({scope_sql})"),  # noqa: S608
            {**params, "c": body.replaces},
        ).scalar_one_or_none()
        if replaces_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Worker not found")

    new_id: uuid.UUID | None = None
    for _ in range(3):  # two people raising at once could pick the same number
        try:
            new_id = session.execute(
                text(
                    """INSERT INTO recruitment_requests
                           (request_no, project_id, trade_id, headcount, needed_by, reason,
                            requested_by, source, expected_arrival, replaces_employee_id)
                       SELECT 'RR-' || :year || '-' || lpad(
                                  (coalesce(max(substring(request_no FROM '[0-9]+$')::int), 0)
                                   + 1)::text,
                                  4, '0'),
                              :project_id, :trade_id, :headcount, :needed_by, :reason,
                              :user_id, CAST(:source AS recruit_source), :arrival, :replaces
                       FROM recruitment_requests WHERE request_no ~ ('^RR-' || :year || '-[0-9]+$')
                       RETURNING id"""
                ),
                {
                    "year": str(today.year), "project_id": project_id, "trade_id": trade_id,
                    "headcount": body.headcount, "needed_by": body.needed_by,
                    "reason": body.reason, "user_id": user.id, "source": body.source,
                    "arrival": body.expected_arrival, "replaces": replaces_id,
                },
            ).scalar_one()  # fmt: skip
            break
        except IntegrityError:
            session.rollback()
    if new_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Another request was raised at the same time. Try again."
        )
    created = _get(session, new_id, today)
    write_audit(
        session, request, "recruitment.created", "recruitment_request", user, entity_id=new_id,
        after={
            "request_no": created.request_no, "trade": body.trade, "project": body.project,
            "headcount": body.headcount, "source": body.source, "replaces": body.replaces,
        },
    )  # fmt: skip
    run_after_change(session, settings, clock)
    return created


@router.post("/{request_id}/advance")
def advance_request(
    request_id: uuid.UUID,
    body: AdvanceRecruitment,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Creator,
) -> AdvanceResult:
    """Move people on to the next stage (or cancel). If only some move, the request is split."""
    visible, params = _visible_projects_sql(user)
    current = (
        session.execute(
            text(
                f"""SELECT r.id, r.status::text AS stage, r.headcount FROM recruitment_requests r
                    WHERE r.id = :id AND ({visible}) FOR UPDATE"""  # noqa: S608
            ),
            {**params, "id": request_id},
        )
        .mappings()
        .first()
    )
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    stage: str = current["stage"]
    if stage not in OPEN_STAGES:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"This request is {stage_label(stage).lower()} already."
        )
    if body.to == "cancelled":
        count = current["headcount"]  # a cancellation always takes the whole request
    else:
        if body.to != ORDER[ORDER.index(stage) + 1]:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"From {stage_label(stage).lower()} the next step is "
                f"{stage_label(ORDER[ORDER.index(stage) + 1]).lower()}.",
            )
        count = body.count or current["headcount"]
        if count > current["headcount"]:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"Only {current['headcount']} people are in this request.",
            )
    remaining_id: uuid.UUID | None = None
    if count == current["headcount"]:
        session.execute(
            text(
                """UPDATE recruitment_requests
                   SET status = CAST(:to AS recruitment_status), updated_at = now(),
                       expected_arrival = coalesce(:arrival, expected_arrival)
                   WHERE id = :id"""
            ),
            {"to": body.to, "arrival": body.expected_arrival, "id": request_id},
        )
        advanced_id = request_id
    else:
        # Split: the people who move get a request of their own; the rest stay where they were.
        session.execute(
            text(
                "UPDATE recruitment_requests SET headcount = headcount - :n, updated_at = now() "
                "WHERE id = :id"
            ),
            {"n": count, "id": request_id},
        )
        advanced_id = session.execute(
            text(
                """INSERT INTO recruitment_requests
                       (request_no, project_id, trade_id, headcount, needed_by, reason, status,
                        requested_by, source, expected_arrival, replaces_employee_id, is_demo)
                   SELECT r.request_no || '-' || (SELECT count(*) + 1 FROM recruitment_requests s
                                                  WHERE s.request_no LIKE r.request_no || '-%'),
                          r.project_id, r.trade_id, :n, r.needed_by, r.reason,
                          CAST(:to AS recruitment_status), r.requested_by, r.source,
                          coalesce(:arrival, r.expected_arrival), r.replaces_employee_id, r.is_demo
                   FROM recruitment_requests r WHERE r.id = :id
                   RETURNING id"""
            ),
            {"n": count, "to": body.to, "arrival": body.expected_arrival, "id": request_id},
        ).scalar_one()
        remaining_id = request_id
    today = clock.today()
    advanced = _get(session, advanced_id, today)
    write_audit(
        session, request, "recruitment.advanced", "recruitment_request", user,
        entity_id=advanced_id,
        before={"stage": stage, "headcount": current["headcount"]},
        after={"stage": body.to, "moved": count, "request_no": advanced.request_no},
    )  # fmt: skip
    run_after_change(session, settings, clock)
    return AdvanceResult(
        advanced=advanced, remaining=_get(session, remaining_id, today) if remaining_id else None
    )
