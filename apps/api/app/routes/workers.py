"""Workers: the directory and one worker's profile. Scoped to the caller; numbers masked by role."""

from __future__ import annotations

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
from app.config import Settings, get_settings
from app.db import get_session
from app.exports import csv_download
from app.labels import DOCUMENT_LABEL, EXIT_LABEL, document_label
from app.schemas import (
    AssignmentDetail,
    DocumentBrief,
    DocumentDetail,
    DocumentExpiryEdit,
    Facet,
    MobilizationBrief,
    Risk,
    WorkerDetail,
    WorkerEdit,
    WorkerFacets,
    WorkerList,
    WorkerNumber,
    WorkerRow,
)
from app.services.alerts.engine import run_after_change
from app.services.mobilization import stage_of

router = APIRouter(prefix="/workers", tags=["workers"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Reader = Annotated[AuthUser, Depends(require("employee:read"))]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]
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

WorkerStatus = Literal["available", "deployed", "mobilizing", "demobilizing", "unavailable"]


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
    response = csv_download(
        "workers.csv",
        [
            "Code",
            "Name",
            "Trade",
            "Level",
            "Status",
            "Project",
            "Phone",
            "Next document",
            "Expires",
        ],
        (
            (
                r["code"],
                r["name"],
                r["trade"],
                r["level"],
                r["status"],
                r["project"],
                r["phone"],
                document_label(r["next_type"]) if r["next_type"] else None,
                r["next_expiry"].isoformat() if r["next_expiry"] else None,
            )
            for r in rows
        ),
    )
    write_audit(session, request, "workers.exported", "employee", user)
    return response


def _risks(
    documents: list[dict[str, Any]], assignments: list[dict[str, Any]], today: date
) -> list[Risk]:
    """Documents that are expired, or that end before a live job does. Worded here, in Python."""
    risks: list[Risk] = []
    for d in documents:
        expiry: date | None = d["expiry"]
        if expiry is None:
            continue
        label = document_label(d["type"])
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


def _people_risks(
    employee: dict[str, Any], assignments: list[dict[str, Any]], today: date
) -> list[Risk]:
    """Contract ends and exits, worded here. Same idea as the document risks."""
    risks: list[Risk] = []
    live = [a for a in assignments if a["status"] in ("planned", "active") and a["end"]]
    exit_on: date | None = employee["exit_on"]
    contract_end: date | None = employee["contract_end_on"]
    if employee["employment_status"] == "absconded":
        when = f" on {_day(exit_on)}" if exit_on else ""
        risks.append(
            Risk(
                kind="absconded", severity="critical", document_type=None,
                expiry=exit_on or today, project_code=None, days_short=None,
                message=f"Left without notice{when}.",
            )
        )  # fmt: skip
        return risks
    if exit_on is not None:
        why = EXIT_LABEL.get(employee["exit_reason"] or "other", "leaving")
        if exit_on < today:
            message = f"Left the company on {_day(exit_on)} ({why})."
        else:
            message = f"Leaving the company on {_day(exit_on)} ({why})."
        project = next((a for a in live if a["end"] > exit_on), None)
        if project:
            message += (
                f" That is before the job on {project['code']} ends ({_day(project['end'])})."
            )
        risks.append(
            Risk(
                kind="leaving", severity="critical" if exit_on < today else "warning",
                document_type=None, expiry=exit_on,
                project_code=project["code"] if project else None,
                days_short=(project["end"] - exit_on).days if project else None, message=message,
            )
        )  # fmt: skip
    if contract_end is not None:
        project = next((a for a in live if a["end"] > contract_end), None)
        if contract_end < today:
            message = f"Contract ended on {_day(contract_end)}."
        elif project:
            message = (
                f"Contract ends {_day(contract_end)}, before the job on {project['code']} "
                f"ends ({_day(project['end'])})."
            )
        else:
            return risks  # the contract outlasts every job: nothing to warn about
        risks.append(
            Risk(
                kind="contract_ends", severity="critical" if contract_end < today else "warning",
                document_type=None, expiry=contract_end,
                project_code=project["code"] if project else None,
                days_short=(project["end"] - contract_end).days if project else None,
                message=message,
            )
        )  # fmt: skip
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
                """SELECT pr.code, pr.name, lower(a.period) AS starts,
                          (upper(a.period) - 1) AS ends,
                          coalesce(upper(a.period) - 1, pr.ends_on) AS "end",
                          a.status::text AS status,
                          dp.code AS moving_from, (upper(d.period) - 1) AS moving_from_ends,
                          m.mob_no, m.status::text AS mob_status,
                          coalesce(k.total, 0) AS tasks_total, coalesce(k.done, 0) AS tasks_done
                   FROM employee_assignments a JOIN projects pr ON pr.id = a.project_id
                   JOIN employees e ON e.id = a.employee_id
                   LEFT JOIN employee_assignments d ON d.id = a.depends_on_assignment_id
                   LEFT JOIN projects dp ON dp.id = d.project_id
                   LEFT JOIN mobilizations m ON m.assignment_id = a.id
                   LEFT JOIN LATERAL (
                       SELECT count(*) AS total, count(*) FILTER (WHERE status = 'done') AS done
                       FROM mobilization_tasks WHERE mobilization_id = m.id) k ON TRUE
                   WHERE e.employee_code = :code ORDER BY lower(a.period) DESC"""
            ),
            {"code": code},
        ).mappings()
    ]
    assignments = [
        AssignmentDetail(
            project_code=a["code"], project_name=a["name"], starts=a["starts"], ends=a["ends"],
            status=a["status"], moving_from=a["moving_from"],
            moving_from_ends=a["moving_from_ends"],
            mobilization=MobilizationBrief(
                mob_no=a["mob_no"], status=a["mob_status"],
                stage=stage_of(a["mob_status"], int(a["tasks_done"]), int(a["tasks_total"])),
                tasks_done=int(a["tasks_done"]), tasks_total=int(a["tasks_total"]),
            )
            if a["mob_no"] and user.can("mobilization:read")
            else None,
        )
        for a in raw_assignments
    ]  # fmt: skip
    employee = (
        session.execute(
            text(
                """SELECT employment_status::text AS employment_status, designation,
                          contract_end_on, exit_on, exit_reason::text AS exit_reason
                   FROM employees WHERE employee_code = :code"""
            ),
            {"code": code},
        )
        .mappings()
        .one()
    )
    base = _row(row, today)
    return WorkerDetail(
        **base.model_dump(),
        documents=documents,
        assignments=assignments,
        risks=_risks(raw_documents, raw_assignments, today)
        + _people_risks(dict(employee), raw_assignments, today),
        employment_status=employee["employment_status"],
        designation=employee["designation"],
        contract_end_on=employee["contract_end_on"],
        exit_on=employee["exit_on"],
        exit_reason=employee["exit_reason"],
    )


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(422, message)


@router.patch("/{code}")
def edit_worker(  # noqa: C901 - one list of checks, then one update
    code: str,
    body: WorkerEdit,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
) -> WorkerDetail:
    """HR edits a worker. Only what is sent changes; each change is checked and audited."""
    sent = body.model_fields_set
    if not sent:
        raise _unprocessable("Nothing to change")
    scope_sql, params = employee_scope(user, "employee:write")
    row = (
        session.execute(
            text(
                f"""SELECT e.id, e.full_name, e.designation, e.phone, e.whatsapp_number,
                           e.joined_on, e.contract_end_on, e.exit_on,
                           e.exit_reason::text AS exit_reason, e.primary_trade_id,
                           t.name AS trade, es.level
                    FROM employees e JOIN trades t ON t.id = e.primary_trade_id
                    LEFT JOIN employee_skills es
                      ON es.employee_id = e.id AND es.trade_id = e.primary_trade_id
                    WHERE e.employee_code = :code AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": code},
        )
        .mappings()
        .first()
    )
    if row is None:  # also when the worker is outside the caller's scope
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Worker not found")
    for field in ("full_name", "trade", "level"):
        if field in sent and getattr(body, field) is None:
            raise _unprocessable(f"{field.replace('_', ' ').capitalize()} cannot be empty")
    contract = body.contract_end_on if "contract_end_on" in sent else row["contract_end_on"]
    leaving = body.exit_on if "exit_on" in sent else row["exit_on"]
    joined: date | None = row["joined_on"]
    if joined and contract and contract < joined:
        raise _unprocessable(f"The contract cannot end before they joined on {_day(joined)}")
    if joined and leaving and leaving < joined:
        raise _unprocessable(f"The leaving date cannot be before they joined on {_day(joined)}")
    trade_id = row["primary_trade_id"]
    if "trade" in sent and body.trade:
        found = session.execute(
            text("SELECT id FROM trades WHERE lower(name) = lower(:n)"), {"n": body.trade}
        ).first()
        if found is None:
            raise _unprocessable(f"There is no trade called {body.trade}")
        trade_id = found.id

    changes: dict[str, Any] = {}
    for field in ("full_name", "designation", "phone", "whatsapp_number", "contract_end_on",
                  "exit_on"):  # fmt: skip
        if field in sent:
            changes[field] = getattr(body, field)
    if "exit_reason" in sent:
        changes["exit_reason"] = body.exit_reason
    if "exit_on" in sent and body.exit_on is None and "exit_reason" not in sent:
        changes["exit_reason"] = None  # no leaving date, no reason for leaving
    if trade_id != row["primary_trade_id"]:
        changes["primary_trade_id"] = trade_id
    before = {k: row[k] for k in changes if k in row.keys() and k != "primary_trade_id"}  # noqa: SIM118
    if changes:
        sets = ", ".join(
            f"{k} = CAST(:{k} AS exit_reason)" if k == "exit_reason" else f"{k} = :{k}"
            for k in changes
        )
        session.execute(
            text(f"UPDATE employees SET {sets}, updated_at = now() WHERE id = :id"),  # noqa: S608
            {**changes, "id": row["id"]},
        )
    if "level" in sent or trade_id != row["primary_trade_id"]:
        level = body.level if "level" in sent else (row["level"] or 3)
        session.execute(
            text(
                """INSERT INTO employee_skills (employee_id, trade_id, level)
                   VALUES (:e, :t, :l)
                   ON CONFLICT (employee_id, trade_id) DO UPDATE SET level = EXCLUDED.level"""
            ),
            {"e": row["id"], "t": trade_id, "l": level},
        )
    after = {k: v for k, v in changes.items() if k != "primary_trade_id"}
    if "trade" in sent:
        before["trade"], after["trade"] = row["trade"], body.trade
    if "level" in sent:
        before["level"], after["level"] = row["level"], body.level
    write_audit(
        session, request, "employee.edited", "employee", user, entity_id=row["id"],
        before=before, after=after,
    )  # fmt: skip
    run_after_change(session, settings, clock)  # a new contract or leaving date can raise alerts
    return get_worker(code, session, clock, user)


@router.patch("/{code}/documents/{doc_type}")
def edit_document_expiry(
    code: str,
    doc_type: str,
    body: DocumentExpiryEdit,
    request: Request,
    session: SessionDep,
    clock: ClockDep,
    settings: SettingsDep,
    user: Writer,
) -> WorkerDetail:
    """HR corrects when a current document runs out (after a renewal, or a typing mistake)."""
    if doc_type not in DOCUMENT_LABEL:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    scope_sql, params = employee_scope(user, "employee:write")
    doc = (
        session.execute(
            text(
                f"""SELECT d.id, d.expiry_date, d.issued_on, d.status::text AS status
                    FROM employee_documents d JOIN employees e ON e.id = d.employee_id
                    WHERE e.employee_code = :code AND d.doc_type = CAST(:doc_type AS document_type)
                      AND d.is_current AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": code, "doc_type": doc_type},
        )
        .mappings()
        .first()
    )
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if doc["issued_on"] and body.expiry_date < doc["issued_on"]:
        raise _unprocessable(f"It cannot run out before it was issued on {_day(doc['issued_on'])}")
    # A renewed date on an expired document needs checking again, not a status saying expired.
    status_now = (
        "pending_check"
        if doc["status"] == "expired" and body.expiry_date >= clock.today()
        else doc["status"]
    )
    session.execute(
        text(
            """UPDATE employee_documents SET expiry_date = :d,
                      status = CAST(:s AS document_status) WHERE id = :id"""
        ),
        {"d": body.expiry_date, "s": status_now, "id": doc["id"]},
    )
    write_audit(
        session, request, "document.expiry_edited", "employee_document", user, entity_id=doc["id"],
        before={"expiry_date": doc["expiry_date"], "status": doc["status"]},
        after={"expiry_date": body.expiry_date, "status": status_now},
    )  # fmt: skip
    run_after_change(session, settings, clock)
    return get_worker(code, session, clock, user)


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
