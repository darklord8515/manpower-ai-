"""Workers: the directory and one worker's profile. Scoped to the caller; numbers masked by role."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile, masked
from app.clock import Clock
from app.db import get_session
from app.schemas import (
    AssignmentDetail,
    DocumentBrief,
    DocumentDetail,
    Facet,
    Risk,
    WorkerDetail,
    WorkerFacets,
    WorkerList,
    WorkerNumber,
    WorkerRow,
)

router = APIRouter(prefix="/workers", tags=["workers"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Reader = Annotated[AuthUser, Depends(require("employee:read"))]
SensitiveReader = Annotated[AuthUser, Depends(require("employee:read_sensitive"))]

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

DOCUMENT_LABEL = {
    "residency_visa": "Residency visa",
    "medical_fitness": "Medical fitness",
    "labour_card": "Labour card",
    "passport": "Passport",
    "work_permit": "Work permit",
}

WorkerStatus = Literal["available", "deployed", "mobilizing", "demobilizing", "unavailable"]


def _label(doc_type: str) -> str:
    return DOCUMENT_LABEL.get(doc_type, doc_type.replace("_", " ").capitalize())


def _day(value: date) -> str:
    return f"{value.day} {value:%b %Y}"


def csv_cell(value: object) -> str:
    """One spreadsheet cell. A leading = + - @ would run as a formula in Excel, so it is defused."""
    if value is None:
        return ""
    cell = str(value)
    return f"'{cell}" if cell[:1] in ("=", "+", "-", "@") else cell


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


def _filters(
    user: AuthUser,
    today: date,
    q: str,
    trade: str | None,
    project: str | None,
    worker_status: str | None,
    expiring_within: int | None,
    expired: bool,
) -> tuple[str, dict[str, Any]]:
    """The WHERE clause shared by the list, the export and the filter counts."""
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
    if expired:
        where.append("nd.expiry_date < :today")
        params["today"] = today
    return " AND ".join(f"({w})" for w in where), params


def _order(sort: str, direction: str) -> str:
    return f"{_SORT[sort]} {'DESC' if direction == 'desc' else 'ASC'} NULLS LAST, e.full_name"


Sort = Annotated[Literal["name", "trade", "level", "project", "docs"], Query()]
Direction = Annotated[Literal["asc", "desc"], Query(alias="dir")]
Search = Annotated[str, Query(max_length=100)]
TradeFilter = Annotated[str | None, Query(max_length=60)]
ProjectFilter = Annotated[str | None, Query(max_length=20)]
StatusFilter = Annotated[WorkerStatus | None, Query(alias="status")]
Within = Annotated[int | None, Query(ge=0, le=365)]


@router.get("")
def list_workers(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    q: Search = "",
    trade: TradeFilter = None,
    project: ProjectFilter = None,
    worker_status: StatusFilter = None,
    expiring_within: Within = None,
    expired: bool = False,
    sort: Sort = "name",
    direction: Direction = "asc",
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkerList:
    today = clock.today()
    condition, params = _filters(
        user, today, q, trade, project, worker_status, expiring_within, expired
    )
    total = session.execute(
        text(f"SELECT count(*) FROM ({_SELECT} WHERE {condition}) counted"),
        params,  # noqa: S608
    ).scalar_one()
    rows = session.execute(
        text(
            f"{_SELECT} WHERE {condition} ORDER BY {_order(sort, direction)} "  # noqa: S608
            "LIMIT :limit OFFSET :offset"
        ),
        {**params, "limit": limit, "offset": offset},
    ).mappings()
    return WorkerList(total=int(total), items=[_row(r, today, full_profile(user)) for r in rows])


@router.get("/facets")
def worker_facets(session: SessionDep, clock: ClockDep, user: Reader) -> WorkerFacets:
    """Counts for the filter chips, over everyone the caller may see (ignoring other filters)."""
    today = clock.today()
    scope_sql, params = employee_scope(user, "employee:read")

    def counts(column: str) -> list[Facet]:
        rows = session.execute(
            text(
                f"""SELECT {column} AS value, count(*) AS n FROM ({_SELECT} WHERE {scope_sql}) w
                    WHERE {column} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1"""  # noqa: S608
            ),
            params,
        ).mappings()
        return [Facet(value=r["value"], count=int(r["n"])) for r in rows]

    if not full_profile(user):  # the narrow projection reveals trades only
        return WorkerFacets(
            trades=sorted(counts("trade"), key=lambda f: f.value),
            statuses=[], projects=[], documents={"expired": 0, "expiring_30": 0},
        )  # fmt: skip
    summary = (
        session.execute(
            text(
                f"""SELECT count(*) FILTER (WHERE next_expiry < :today) AS expired,
                           count(*) FILTER (WHERE next_expiry >= :today
                                            AND next_expiry - :today <= 30) AS soon
                    FROM ({_SELECT} WHERE {scope_sql}) w"""  # noqa: S608
            ),
            {**params, "today": today},
        )
        .mappings()
        .one()
    )
    return WorkerFacets(
        trades=sorted(counts("trade"), key=lambda f: f.value),
        statuses=counts("status"),
        projects=sorted(counts("project"), key=lambda f: f.value),
        documents={"expired": int(summary["expired"]), "expiring_30": int(summary["soon"])},
    )


@router.get("/export.csv")
def export_workers(
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    q: Search = "",
    trade: TradeFilter = None,
    project: ProjectFilter = None,
    worker_status: StatusFilter = None,
    expiring_within: Within = None,
    expired: bool = False,
    sort: Sort = "name",
    direction: Direction = "asc",
) -> Response:
    """The filtered directory as a spreadsheet. Never contains document numbers."""
    if not full_profile(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to export the directory")
    today = clock.today()
    condition, params = _filters(
        user, today, q, trade, project, worker_status, expiring_within, expired
    )
    rows = session.execute(
        text(
            f"{_SELECT} WHERE {condition} ORDER BY {_order(sort, direction)} LIMIT 5000"  # noqa: S608
        ),
        params,
    ).mappings()
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(
        ["Code", "Name", "Trade", "Level", "Status", "Project", "Phone", "Next document", "Expires"]
    )
    for r in rows:
        writer.writerow(
            [
                csv_cell(v)
                for v in (
                    r["code"], r["name"], r["trade"], r["level"], r["status"], r["project"],
                    r["phone"],
                    _label(r["next_type"]) if r["next_type"] else None,
                    r["next_expiry"].isoformat() if r["next_expiry"] else None,
                )
            ]
        )  # fmt: skip
    write_audit(session, request, "workers.exported", "employee", user)
    return Response(
        content="﻿" + out.getvalue(),  # the BOM makes Excel read the file as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="workers.csv"'},
    )


def _risks(
    documents: list[dict[str, Any]], assignments: list[dict[str, Any]], today: date
) -> list[Risk]:
    """Documents that are expired, or that end before a live job does. Worded here, in Python."""
    risks: list[Risk] = []
    for d in documents:
        expiry: date | None = d["expiry"]
        if expiry is None:
            continue
        label = _label(d["type"])
        if expiry < today:
            ago = (today - expiry).days
            unit = "day" if ago == 1 else "days"
            risks.append(
                Risk(
                    kind="expired", severity="critical", document_type=d["type"], expiry=expiry,
                    project_code=None, days_short=None,
                    message=f"{label} expired {ago} {unit} ago ({_day(expiry)}).",
                )
            )  # fmt: skip
            continue
        for a in assignments:
            end: date | None = a["end"]
            if a["status"] not in ("planned", "active") or end is None or expiry >= end:
                continue
            short = (end - expiry).days
            risks.append(
                Risk(
                    kind="ends_before_assignment", severity="warning", document_type=d["type"],
                    expiry=expiry, project_code=a["code"], days_short=short,
                    message=(
                        f"{label} ends {_day(expiry)}, before the job on {a['code']} "
                        f"ends ({_day(end)})."
                    ),
                )
            )  # fmt: skip
            break
    return risks


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
            **_row(row, today, full=False).model_dump(), documents=[], assignments=[], risks=[]
        )
    raw_documents = [
        dict(d)
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
    can_reveal = user.can("employee:read_sensitive")
    documents = [
        DocumentDetail(
            type=d["type"],
            number=masked(d["number"]),  # the profile never carries a full number
            can_reveal=can_reveal and d["number"] is not None,
            expiry=d["expiry"],
            days_left=(d["expiry"] - today).days if d["expiry"] else None,
            status=d["status"],
        )
        for d in raw_documents
    ]
    raw_assignments = [
        dict(a)
        for a in session.execute(
            text(
                """SELECT pr.code, pr.name, lower(a.period) AS starts, upper(a.period) AS ends,
                          coalesce(upper(a.period), pr.ends_on) AS "end", a.status::text AS status
                   FROM employee_assignments a JOIN projects pr ON pr.id = a.project_id
                   JOIN employees e ON e.id = a.employee_id
                   WHERE e.employee_code = :code ORDER BY lower(a.period) DESC"""
            ),
            {"code": code},
        ).mappings()
    ]
    assignments = [
        AssignmentDetail(
            project_code=a["code"], project_name=a["name"], starts=a["starts"], ends=a["ends"],
            status=a["status"],
        )
        for a in raw_assignments
    ]  # fmt: skip
    base = _row(row, today)
    return WorkerDetail(
        **base.model_dump(),
        documents=documents,
        assignments=assignments,
        risks=_risks(raw_documents, raw_assignments, today),
    )


@router.post("/{code}/documents/{doc_type}/reveal")
def reveal_document_number(
    code: str,
    doc_type: str,
    request: Request,
    session: SessionDep,
    user: SensitiveReader,
) -> WorkerNumber:
    """The eye icon: one number in full. Who looked, and at what, goes to the audit log."""
    if doc_type not in DOCUMENT_LABEL:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    scope_sql, params = employee_scope(user, "employee:read_sensitive")
    row = (
        session.execute(
            text(
                f"""SELECT d.id, d.doc_number FROM employee_documents d
                    JOIN employees e ON e.id = d.employee_id
                    WHERE e.employee_code = :code AND d.doc_type = CAST(:doc_type AS document_type)
                      AND d.is_current AND d.doc_number IS NOT NULL AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": code, "doc_type": doc_type},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    write_audit(
        session, request, "document.number_revealed", "employee_document", user,
        entity_id=uuid.UUID(str(row["id"])),
    )  # fmt: skip
    return WorkerNumber(number=row["doc_number"])
