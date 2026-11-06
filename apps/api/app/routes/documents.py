"""Documents running out: expired, then 30, 60 and 90 days. Same scope rules as workers."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser, get_clock, require
from app.auth.scope import employee_scope, full_profile
from app.clock import Clock
from app.db import get_session
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
_DOC_TYPES = {
    "visa", "emirates_id", "medical_fitness", "labour_card", "passport", "work_permit",
}  # fmt: skip


@router.get("/expiring")
def expiring(
    session: SessionDep,
    clock: ClockDep,
    user: Reader,
    window: Window = "d30",
    q: Annotated[str, Query(max_length=100)] = "",
    doc_type: Annotated[str | None, Query(alias="type", max_length=30)] = None,
) -> ExpiringList:
    if not full_profile(user):  # the narrow projection has no document information
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this")
    today = clock.today()
    scope_sql, params = employee_scope(user, "employee:read")
    params["today"] = today
    base = """FROM employee_documents d JOIN employees e ON e.id = d.employee_id
              JOIN trades t ON t.id = e.primary_trade_id
              LEFT JOIN LATERAL (
                  SELECT pr.code FROM employee_assignments a
                  JOIN projects pr ON pr.id = a.project_id
                  WHERE a.employee_id = e.id AND a.status IN ('planned', 'active')
                  ORDER BY a.period LIMIT 1) p ON TRUE
              WHERE d.is_current AND d.expiry_date IS NOT NULL"""

    counts = {
        key: session.execute(
            text(f"SELECT count(*) {base} AND ({scope_sql}) AND {condition}"),
            params,  # noqa: S608
        ).scalar_one()
        for key, condition in _WINDOWS.items()
    }

    where = [scope_sql, _WINDOWS[window]]
    if q.strip():
        where.append("(e.full_name ILIKE :like OR e.employee_code ILIKE :like)")
        params["like"] = f"%{q.strip()}%"
    if doc_type and doc_type in _DOC_TYPES:
        where.append("d.doc_type = CAST(:doc_type AS document_type)")
        params["doc_type"] = doc_type
    condition = " AND ".join(f"({w})" for w in where)
    rows = session.execute(
        text(
            f"""SELECT e.employee_code AS code, e.full_name AS name, t.name AS trade,
                       p.code AS project, e.phone, d.doc_type::text AS type, d.expiry_date AS expiry
                {base} AND {condition} ORDER BY d.expiry_date, e.full_name"""  # noqa: S608
        ),
        params,
    ).mappings()
    return ExpiringList(
        counts=ExpiryCounts(**{k: int(v) for k, v in counts.items()}),
        items=[
            ExpiringDocument(
                worker_code=r["code"], worker_name=r["name"], trade=r["trade"],
                project=r["project"], phone=r["phone"], type=r["type"], expiry=r["expiry"],
                days_left=(r["expiry"] - today).days,
            )
            for r in rows
        ],
    )  # fmt: skip
