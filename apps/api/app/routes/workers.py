"""Workers: the directory and one worker's profile. Scoped to the caller; numbers masked by role."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile, mask_number
from app.clock import Clock
from app.db import get_session
from app.schemas import (
    AssignmentDetail,
    DocumentBrief,
    DocumentDetail,
    WorkerDetail,
    WorkerList,
    WorkerRow,
)

router = APIRouter(prefix="/workers", tags=["workers"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Reader = Annotated[AuthUser, Depends(require("employee:read"))]

# Sorting is a whitelist, never the caller's text.
_SORT: dict[str, str] = {
    "name": "e.full_name",
    "trade": "t.name",
    "level": "es.level",
    "project": "p.code",
    "docs": "nd.expiry_date",
}

_SELECT = """
SELECT e.employee_code AS code, e.full_name AS name, t.name AS trade, es.level,
       e.availability::text AS status, p.code AS project, e.phone,
       nd.doc_type::text AS next_type, nd.expiry_date AS next_expiry
FROM employees e
JOIN trades t ON t.id = e.primary_trade_id
LEFT JOIN employee_skills es ON es.employee_id = e.id AND es.trade_id = e.primary_trade_id
LEFT JOIN LATERAL (
    SELECT pr.code FROM employee_assignments a JOIN projects pr ON pr.id = a.project_id
    WHERE a.employee_id = e.id AND a.status IN ('planned', 'active')
    ORDER BY a.period LIMIT 1) p ON TRUE
LEFT JOIN LATERAL (
    SELECT d.doc_type, d.expiry_date FROM employee_documents d
    WHERE d.employee_id = e.id AND d.is_current AND d.expiry_date IS NOT NULL
    ORDER BY d.expiry_date LIMIT 1) nd ON TRUE
"""


def _row(r: Any, today: date, full: bool = True) -> WorkerRow:
    if not full:  # narrow projection: name, code, trade, phone
        return WorkerRow(
            code=r["code"], name=r["name"], trade=r["trade"], level=None, status=None,
            project=None, phone=r["phone"], next_document=None,
        )  # fmt: skip
    brief = (
        DocumentBrief(
            type=r["next_type"], expiry=r["next_expiry"], days_left=(r["next_expiry"] - today).days
        )
        if r["next_expiry"]
        else None
    )
    return WorkerRow(
        code=r["code"], name=r["name"], trade=r["trade"], level=r["level"], status=r["status"],
        project=r["project"], phone=r["phone"], next_document=brief,
    )  # fmt: skip


@router.get("")
def list_workers(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    q: Annotated[str, Query(max_length=100)] = "",
    trade: Annotated[str | None, Query(max_length=60)] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
    worker_status: Annotated[
        Literal["available", "deployed", "mobilizing", "demobilizing", "unavailable"] | None,
        Query(alias="status"),
    ] = None,
    expiring_within: Annotated[int | None, Query(ge=0, le=365)] = None,
    sort: Annotated[Literal["name", "trade", "level", "project", "docs"], Query()] = "name",
    direction: Annotated[Literal["asc", "desc"], Query(alias="dir")] = "asc",
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkerList:
    today = clock.today()
    scope_sql, params = employee_scope(user, "employee:read")
    where = [scope_sql]
    if q.strip():
        where.append(
            "(e.full_name ILIKE :like OR e.employee_code ILIKE :like OR t.name ILIKE :like)"
        )
        params["like"] = f"%{q.strip()}%"
    if trade:
        where.append("t.name = :trade")
        params["trade"] = trade
    if project:
        where.append("p.code = :project")
        params["project"] = project
    if worker_status:
        where.append("e.availability = CAST(:status AS availability_state)")
        params["status"] = worker_status
    if expiring_within is not None:
        where.append("nd.expiry_date - :today <= :within")
        params.update(today=today, within=expiring_within)
    condition = " AND ".join(f"({w})" for w in where)
    order = f"{_SORT[sort]} {'DESC' if direction == 'desc' else 'ASC'} NULLS LAST, e.full_name"
    total = session.execute(
        text(f"SELECT count(*) FROM ({_SELECT} WHERE {condition}) counted"),
        params,  # noqa: S608
    ).scalar_one()
    rows = session.execute(
        text(f"{_SELECT} WHERE {condition} ORDER BY {order} LIMIT :limit OFFSET :offset"),  # noqa: S608
        {**params, "limit": limit, "offset": offset},
    ).mappings()
    return WorkerList(total=int(total), items=[_row(r, today, full_profile(user)) for r in rows])


@router.get("/{code}")
def get_worker(code: str, session: SessionDep, clock: ClockDep, user: Reader) -> WorkerDetail:
    today = clock.today()
    scope_sql, params = employee_scope(user, "employee:read")
    row = (
        session.execute(
            text(f"{_SELECT} WHERE e.employee_code = :code AND ({scope_sql})"),  # noqa: S608
            {**params, "code": code},
        )
        .mappings()
        .first()
    )
    if row is None:  # also when the worker exists but is outside the caller's scope
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Worker not found")
    if not full_profile(user):
        return WorkerDetail(
            **_row(row, today, full=False).model_dump(), documents=[], assignments=[]
        )
    documents = [
        DocumentDetail(
            type=d["type"],
            number=mask_number(user, d["number"]),
            expiry=d["expiry"],
            days_left=(d["expiry"] - today).days if d["expiry"] else None,
            status=d["status"],
        )
        for d in session.execute(
            text(
                """SELECT d.doc_type::text AS type, d.doc_number AS number, d.expiry_date AS expiry,
                          d.status::text AS status
                   FROM employee_documents d JOIN employees e ON e.id = d.employee_id
                   WHERE e.employee_code = :code AND d.is_current
                   ORDER BY d.expiry_date NULLS LAST"""
            ),
            {"code": code},
        ).mappings()
    ]
    assignments = [
        AssignmentDetail(
            project_code=a["code"], project_name=a["name"], starts=a["starts"], ends=a["ends"],
            status=a["status"],
        )
        for a in session.execute(
            text(
                """SELECT pr.code, pr.name, lower(a.period) AS starts, upper(a.period) AS ends,
                          a.status::text AS status
                   FROM employee_assignments a JOIN projects pr ON pr.id = a.project_id
                   JOIN employees e ON e.id = a.employee_id
                   WHERE e.employee_code = :code ORDER BY lower(a.period) DESC"""
            ),
            {"code": code},
        ).mappings()
    ]  # fmt: skip
    base = _row(row, today)
    return WorkerDetail(**base.model_dump(), documents=documents, assignments=assignments)
