"""Documents running out: expired, then 30, 60 and 90 days. Same scope rules as workers.

Each row says whether the document ends before the person's job does, because "ends 12 Nov" matters
much more when the job runs to January.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile
from app.clock import Clock
from app.db import get_session
from app.exports import csv_download
from app.labels import DOCUMENT_LABEL, document_label
from app.schemas import ExpiringDocument, ExpiringList, ExpiryCounts

router = APIRouter(prefix="/documents", tags=["documents"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Reader = Annotated[AuthUser, Depends(require("employee:read"))]

Window = Literal["expired", "d30", "d60", "d90"]
# days_left = expiry - today
_WINDOWS: dict[str, str] = {
    "expired": "d.expiry_date - :today < 0",
    "d30": "d.expiry_date - :today BETWEEN 0 AND 30",
    "d60": "d.expiry_date - :today BETWEEN 31 AND 60",
    "d90": "d.expiry_date - :today BETWEEN 61 AND 90",
}
_LIMIT = 2000

_BASE = """FROM employee_documents d JOIN employees e ON e.id = d.employee_id
           JOIN trades t ON t.id = e.primary_trade_id
           LEFT JOIN LATERAL (
               SELECT pr.code, coalesce(upper(a.period) - 1, pr.ends_on) AS job_ends
               FROM employee_assignments a JOIN projects pr ON pr.id = a.project_id
               WHERE a.employee_id = e.id AND a.status IN ('planned', 'active')
               ORDER BY a.period LIMIT 1) p ON TRUE
           WHERE d.is_current AND d.expiry_date IS NOT NULL"""


def _filters(
    user: AuthUser, today: date, q: str, doc_type: str | None, project: str | None
) -> tuple[list[str], dict[str, Any]]:
    """The conditions every query here shares: scope, search, document type, project."""
    scope_sql, params = employee_scope(user, "employee:read")
    params["today"] = today
    where = [scope_sql]
    if q.strip():
        where.append("(e.full_name ILIKE :like OR e.employee_code ILIKE :like)")
        params["like"] = f"%{q.strip()}%"
    if doc_type and doc_type in DOCUMENT_LABEL:
        where.append("d.doc_type = CAST(:doc_type AS document_type)")
        params["doc_type"] = doc_type
    if project:
        where.append("p.code = :project")
        params["project"] = project
    return where, params


def _guard(user: AuthUser) -> None:
    if not full_profile(user):  # the narrow projection has no document information
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this")


def _rows(
    session: Session, user: AuthUser, today: date, window: str, q: str, doc_type: str | None,
    project: str | None,
) -> list[Any]:  # fmt: skip
    where, params = _filters(user, today, q, doc_type, project)
    condition = " AND ".join(f"({w})" for w in [*where, _WINDOWS[window]])
    return list(
        session.execute(
            text(
                f"""SELECT e.employee_code AS code, e.full_name AS name, t.name AS trade,
                           p.code AS project, p.job_ends, e.phone, d.doc_type::text AS type,
                           d.expiry_date AS expiry
                    {_BASE} AND {condition}
                    ORDER BY d.expiry_date, e.full_name LIMIT {_LIMIT}"""  # noqa: S608
            ),
            params,
        ).mappings()
    )


@router.get("/expiring")
def expiring(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    window: Window = "d30",
    q: Annotated[str, Query(max_length=100)] = "",
    doc_type: Annotated[str | None, Query(alias="type", max_length=30)] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
) -> ExpiringList:
    _guard(user)
    today = clock.today()
    where, params = _filters(user, today, q, doc_type, project)
    # The tab counts follow the search, type and project filters, so a tab never promises rows
    # the filters would hide.
    counts = {
        key: session.execute(
            text(
                f"SELECT count(*) {_BASE} AND "  # noqa: S608
                + " AND ".join(f"({w})" for w in [*where, condition])
            ),
            params,
        ).scalar_one()
        for key, condition in _WINDOWS.items()
    }
    items: list[ExpiringDocument] = []
    for r in _rows(session, user, today, window, q, doc_type, project):
        job_ends: date | None = r["job_ends"]
        items.append(
            ExpiringDocument(
                worker_code=r["code"], worker_name=r["name"], trade=r["trade"],
                project=r["project"], phone=r["phone"], type=r["type"], expiry=r["expiry"],
                days_left=(r["expiry"] - today).days, job_ends=job_ends,
                ends_before_job=bool(job_ends and r["expiry"] < job_ends),
            )
        )  # fmt: skip
    return ExpiringList(counts=ExpiryCounts(**{k: int(v) for k, v in counts.items()}), items=items)


@router.get("/export.csv")
def export_expiring(
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    window: Window = "d30",
    q: Annotated[str, Query(max_length=100)] = "",
    doc_type: Annotated[str | None, Query(alias="type", max_length=30)] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
) -> Response:
    """The rows on screen as a spreadsheet. Never contains a document number."""
    _guard(user)
    today = clock.today()
    rows = _rows(session, user, today, window, q, doc_type, project)
    response = csv_download(
        f"documents-{window}.csv",
        [
            "Code", "Name", "Trade", "Project", "Phone", "Document", "Expires", "Days left",
            "Job ends", "Ends before the job",
        ],
        (
            (
                r["code"], r["name"], r["trade"], r["project"], r["phone"],
                document_label(r["type"]), r["expiry"].isoformat(), (r["expiry"] - today).days,
                r["job_ends"].isoformat() if r["job_ends"] else None,
                "Yes" if r["job_ends"] and r["expiry"] < r["job_ends"] else "No",
            )
            for r in rows
        ),
    )  # fmt: skip
    write_audit(session, request, "documents.exported", "employee_document", user)
    return response
