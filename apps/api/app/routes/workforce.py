# ruff: noqa: E501
"""The workforce: people by project, planned headcount, the hiring board and the history.

HR (and the MD, read-only) see every project, so these routes need an all-projects scope. Writes need
`employee:write` (people) or `project:write` (plan and project stage). No phone number or email is in
a list; HR sees them on one person's profile. Numbers come from services/headcount.py and the
sentences from services/workforce.py; a model only ever rewords them. See docs/workforce-api.md.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, require
from app.auth.scope import employee_scope
from app.db import get_session
from app.services import headcount, workforce

router = APIRouter(prefix="/workforce", tags=["workforce"])

SessionDep = Annotated[Session, Depends(get_session)]
Reader = Annotated[AuthUser, Depends(require("employee:read"))]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]
ProjectWriter = Annotated[AuthUser, Depends(require("project:write"))]
Kind = Literal["staff", "labour"]
STAGES = ("pre_construction", "active", "handover", "completed", "on_hold")


def _all_scope(user: AuthUser) -> None:
    if user.scope("employee:read") != "all":
        raise HTTPException(403, "The workforce view is for HR and the MD, not project teams.")


def _failure(error: workforce.WorkforceError) -> HTTPException:
    return HTTPException(error.status, error.message)


def _overfilled(error: workforce.Overfilled) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": error.message,
            "overfilled": {
                "table": error.table, "people": error.people, "project": error.project_code,
                "options": ["increase_plan", "choose_another_person", "cancel"],
            },
        },
    )  # fmt: skip


# ---------------------------------------------------------------------------------- lookups


@router.get("/designations")
def designations(
    session: SessionDep, user: Reader, kind: Annotated[Kind | None, Query()] = None
) -> list[dict[str, str | None]]:
    _all_scope(user)
    rows = session.execute(
        text(
            """SELECT name, kind, department FROM trades
               WHERE (CAST(:k AS text) IS NULL OR kind = :k) ORDER BY kind, name"""
        ),
        {"k": kind},
    ).mappings()
    return [dict(r) for r in rows]


@router.get("/projects")
def projects(session: SessionDep, user: Reader) -> list[dict[str, Any]]:
    """Every project (head office and cost centres too) with its stage, dates and headcount."""
    _all_scope(user)
    by_project: dict[str, dict[str, dict[str, int]]] = {}
    for r in headcount.lines(session):
        bucket = by_project.setdefault(r.project_code, {}).setdefault(
            r.kind, {"planned": 0, "active": 0, "pipeline": 0, "to_hire": 0, "over": 0}
        )
        bucket["planned"] += r.planned
        bucket["active"] += r.active
        bucket["pipeline"] += r.pipeline
        bucket["to_hire"] += r.to_hire
        bucket["over"] += r.over
    rows = session.execute(
        text(
            """SELECT code, name, kind, status::text AS stage, starts_on, ends_on
               FROM projects ORDER BY (kind = 'head_office'), name"""
        )
    ).mappings()
    empty = {"planned": 0, "active": 0, "pipeline": 0, "to_hire": 0, "over": 0}
    return [
        {**dict(r), "stage_label": workforce.STAGE_LABEL.get(r["stage"], r["stage"]),
         "staff": by_project.get(r["code"], {}).get("staff", empty),
         "labour": by_project.get(r["code"], {}).get("labour", empty)}
        for r in rows
    ]  # fmt: skip


class ProjectPatch(BaseModel):
    stage: Literal["pre_construction", "active", "handover", "completed", "on_hold"] | None = None
    starts_on: date | None = None
    ends_on: date | None = None


@router.patch("/projects/{code}")
def patch_project(
    code: str, body: ProjectPatch, request: Request, session: SessionDep, user: ProjectWriter
) -> dict[str, Any]:
    """HR sets a project's stage and its start and end dates (the trackers leave them blank)."""
    _all_scope(user)
    project = _project(session, code)
    fields = body.model_dump(exclude_unset=True)
    starts = fields.get("starts_on", project["starts_on"])
    ends = fields.get("ends_on", project["ends_on"])
    if starts and ends and ends < starts:
        raise HTTPException(422, "The end date cannot be before the start date.")
    session.execute(
        text(
            """UPDATE projects SET
                   status = COALESCE(CAST(:stage AS project_status), status),
                   starts_on = :s, ends_on = :e WHERE id = :id"""
        ),
        {"id": project["id"], "stage": fields.get("stage"), "s": starts, "e": ends},
    )
    write_audit(
        session, request, "project.updated", "project", user, entity_id=project["id"],
        before={"stage": project["stage"], "starts_on": str(project["starts_on"]),
                "ends_on": str(project["ends_on"])},
        after={k: str(v) for k, v in fields.items()},
    )  # fmt: skip
    return {"code": code, "stage": fields.get("stage", project["stage"]),
            "starts_on": starts, "ends_on": ends}  # fmt: skip


def _project(session: Session, code: str) -> Any:
    row = (
        session.execute(
            text(
                """SELECT id, code, name, kind, status::text AS stage, starts_on, ends_on
                   FROM projects WHERE code = :c"""
            ),
            {"c": code},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Project not found")
    return row


# ------------------------------------------------------------------------------------ plan


def _line(r: headcount.Line) -> dict[str, Any]:
    return {
        "designation": r.label, "role": r.trade, "kind": r.kind, "department": r.discipline,
        "uae_only": r.uae_only, "planned": r.planned, "active": r.active, "pipeline": r.pipeline,
        "to_hire": r.to_hire, "over": r.over,
        "needed_by": r.needed_by.isoformat() if r.needed_by else None, "source": r.source,
    }  # fmt: skip


@router.get("/projects/{code}/plan")
def plan(code: str, session: SessionDep, user: Reader) -> dict[str, Any]:
    """Planned vs joined vs on the way vs still to hire, per role, staff and labour apart."""
    _all_scope(user)
    project = _project(session, code)
    rows = headcount.lines(session, code)
    return {
        "project": {"code": project["code"], "name": project["name"], "kind": project["kind"],
                    "stage": project["stage"], "starts_on": project["starts_on"],
                    "ends_on": project["ends_on"]},
        "staff": [_line(r) for r in rows if r.kind == "staff"],
        "labour": [_line(r) for r in rows if r.kind == "labour"],
        "totals": {k: headcount.totals([r for r in rows if r.kind == k]) for k in ("staff", "labour")},
    }  # fmt: skip


class PlanBody(BaseModel):
    designation: str = Field(min_length=2, max_length=80)
    uae_only: bool = False
    planned: int = Field(ge=0, le=2000)
    needed_by: date | None = None
    source: Literal["local", "overseas"] | None = None


@router.put("/projects/{code}/plan")
def set_plan(
    code: str, body: PlanBody, request: Request, session: SessionDep, user: ProjectWriter
) -> dict[str, Any]:
    """HR changes how many people a project plans for a role."""
    _all_scope(user)
    project = _project(session, code)
    try:
        trade = workforce.trade_named(session, body.designation)
    except workforce.WorkforceError as error:
        raise _failure(error) from error
    before = session.execute(
        text(
            """SELECT planned FROM plan_lines
               WHERE project_id = :p AND trade_id = :t AND uae_national_only = :u"""
        ),
        {"p": project["id"], "t": trade["id"], "u": body.uae_only},
    ).scalar()
    session.execute(
        text(
            """INSERT INTO plan_lines
                   (project_id, trade_id, planned, uae_national_only, needed_by, source, discipline)
               VALUES (:p, :t, :n, :u, :by, :src, :d)
               ON CONFLICT (project_id, trade_id, uae_national_only) DO UPDATE
                  SET planned = EXCLUDED.planned, needed_by = EXCLUDED.needed_by,
                      source = EXCLUDED.source, updated_at = now()"""
        ),
        {"p": project["id"], "t": trade["id"], "n": body.planned, "u": body.uae_only,
         "by": body.needed_by, "src": body.source, "d": trade["department"]},
    )  # fmt: skip
    workforce.log(
        session, "plan_changed", None, None, project["id"], "hr",
        f"Planned {trade['name']} on {project['name']} set from {before or 0} to {body.planned}",
        user.id,
    )  # fmt: skip
    write_audit(
        session, request, "plan.changed", "project", user, entity_id=project["id"],
        before={"planned": before or 0},
        after={"designation": trade["name"], "uae_only": body.uae_only, "planned": body.planned},
    )  # fmt: skip
    return plan(code, session, user)


# ----------------------------------------------------------------------------------- people

_PEOPLE_SQL = """
SELECT e.employee_code AS code, e.full_name AS name, t.name AS designation, t.kind,
       e.discipline, p.code AS project_code, p.name AS project_name, p.kind AS project_kind,
       e.employment_status::text AS status, e.joined_on, e.exit_on, e.source, e.uae_national, e.note
FROM employees e
JOIN trades t ON t.id = e.primary_trade_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE ({scope}) {extra}
"""


def _people(
    session: Session, user: AuthUser, *, kind: str | None = None, project: str | None = None,
    status: str | None = None, q: str = "", designation: str | None = None,
    department: str | None = None, limit: int = 100, offset: int = 0,
) -> dict[str, Any]:  # fmt: skip
    scope_sql, params = employee_scope(user, "employee:read")
    where: list[str] = []
    if kind:
        where.append("t.kind = :kind")
        params["kind"] = kind
    if project:
        where.append("p.code = :project")
        params["project"] = project
    if designation:
        where.append("lower(t.name) = lower(:designation)")
        params["designation"] = designation
    if department:
        where.append("lower(coalesce(e.discipline, t.department, '')) = lower(:department)")
        params["department"] = department
    if q.strip():
        where.append(
            "(e.full_name ILIKE :like OR e.employee_code ILIKE :like OR t.name ILIKE :like)"
        )
        params["like"] = f"%{q.strip()}%"
    base = _PEOPLE_SQL.format(scope=scope_sql, extra="".join(f" AND {w}" for w in where))  # noqa: S608
    counts = {
        r["status"]: int(r["n"])
        for r in session.execute(
            text(f"SELECT status, count(*) AS n FROM ({base}) x GROUP BY status"),  # noqa: S608
            params,
        ).mappings()
    }
    filtered = base + (" AND e.employment_status::text = :status" if status else "")
    rows = (
        session.execute(
            text(f"{filtered} ORDER BY e.full_name LIMIT :limit OFFSET :offset"),  # noqa: S608
            {**params, "status": status, "limit": limit, "offset": offset},
        )
        .mappings()
        .all()
    )
    total = counts.get(status, 0) if status else sum(counts.values())
    return {"items": [dict(r) for r in rows], "total": total, "by_status": counts}


@router.get("/people")
def people(
    session: SessionDep,
    user: Reader,
    kind: Annotated[Kind | None, Query()] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
    q: Annotated[str, Query(max_length=100)] = "",
    designation: Annotated[str | None, Query(max_length=80)] = None,
    department: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    """The People page: pick Staff or Labour, and filter by project (head office included)."""
    _all_scope(user)
    return _people(
        session, user, kind=kind, project=project, status=status, q=q, designation=designation,
        department=department, limit=limit, offset=offset,
    )  # fmt: skip


@router.get("/projects/{code}/people")
def project_people(code: str, session: SessionDep, user: Reader) -> dict[str, Any]:
    """The project page: staff on this project as one table, labour as another below it."""
    _all_scope(user)
    _project(session, code)
    staff = _people(session, user, kind="staff", project=code, limit=500)
    labour = _people(session, user, kind="labour", project=code, limit=500)
    return {"staff": staff, "labour": labour}


@router.get("/people/{code}")
def person(code: str, session: SessionDep, user: Reader) -> dict[str, Any]:
    _all_scope(user)
    scope_sql, params = employee_scope(user, "employee:read")
    row = (
        session.execute(
            text(
                f"""SELECT e.id, e.employee_code AS code, e.full_name AS name, t.name AS designation,
                           t.kind, e.discipline, p.code AS project_code, p.name AS project_name,
                           e.employment_status::text AS status, e.joined_on, e.exit_on, e.source,
                           e.uae_national, e.note, e.phone, e.email
                    FROM employees e JOIN trades t ON t.id = e.primary_trade_id
                    LEFT JOIN projects p ON p.id = e.project_id
                    WHERE e.employee_code = :code AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": code},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Person not found")
    out = dict(row)
    employee_id = out.pop("id")
    if not user.can("employee:write"):  # the MD sees the person, not their contact details
        out["phone"] = out["email"] = None
    out["next_step"] = workforce.NEXT_STEP.get(out["status"])
    out["history"] = _history(session, employee_id=employee_id, limit=50)
    return out


class AddPerson(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    designation: str = Field(min_length=2, max_length=80)
    project_code: str | None = Field(default=None, max_length=20)
    auto: bool = False  # "let AI decide": the project that needs this role most
    status: Literal["offer_issued", "documents_cleared", "active"] = "offer_issued"
    code: str | None = Field(default=None, max_length=30)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=120)
    uae_national: bool = False
    joined_on: date | None = None
    source: Literal["local", "overseas"] | None = None
    resolve: Literal["increase_plan"] | None = None


@router.post("/people", status_code=201, response_model=None)
def add_person(
    body: AddPerson, request: Request, session: SessionDep, user: Writer
) -> dict[str, Any] | JSONResponse:
    """Add a person. Give a project, or `auto` to let the system place them where they are needed."""
    _all_scope(user)
    try:
        placed = workforce.add_person(
            session, user.id, name=body.name, designation=body.designation,
            project_code=body.project_code, auto=body.auto, status=body.status, code=body.code,
            phone=body.phone, email=body.email, uae_national=body.uae_national,
            joined_on=body.joined_on, source=body.source, resolve=body.resolve,
        )  # fmt: skip
    except workforce.Overfilled as error:
        session.rollback()
        return _overfilled(error)
    except workforce.WorkforceError as error:
        session.rollback()
        raise _failure(error) from error
    write_audit(
        session, request, "workforce.person_added", "employee", user,
        after={"code": placed["code"], "project": placed["project_code"], "by": placed["decided_by"]},
    )  # fmt: skip
    return placed


class MilestoneBody(BaseModel):
    to: Literal["documents_cleared", "active", "resigned"]
    on: date | None = None


@router.post("/people/{code}/milestone")
def milestone(
    code: str, body: MilestoneBody, request: Request, session: SessionDep, user: Writer
) -> dict[str, Any]:
    """Offer issued, then documents cleared, then joined; or resigned at any time."""
    _all_scope(user)
    try:
        done = workforce.milestone(session, user.id, code, body.to, body.on)
    except workforce.WorkforceError as error:
        session.rollback()
        raise _failure(error) from error
    write_audit(session, request, f"workforce.{body.to}", "employee", user, after={"code": code})
    return done


class MoveBody(BaseModel):
    project_code: str = Field(min_length=1, max_length=20)
    resolve: Literal["increase_plan"] | None = None


@router.post("/people/{code}/move", response_model=None)
def move(
    code: str, body: MoveBody, request: Request, session: SessionDep, user: Writer
) -> dict[str, Any] | JSONResponse:
    _all_scope(user)
    try:
        done = workforce.move(session, user.id, code, body.project_code, body.resolve)
    except workforce.Overfilled as error:
        session.rollback()
        return _overfilled(error)
    except workforce.WorkforceError as error:
        session.rollback()
        raise _failure(error) from error
    write_audit(
        session, request, "workforce.moved", "employee", user,
        after={"code": code, "project": body.project_code},
    )  # fmt: skip
    return done


# --------------------------------------------------------------- recruitment, history, chart


@router.get("/recruitment")
def recruitment(
    session: SessionDep, user: Reader, kind: Annotated[Kind | None, Query()] = None
) -> dict[str, Any]:
    """The hiring board: how many people to hire per role, each with a table per project."""
    _all_scope(user)
    return workforce.board(session, kind)


def _history(
    session: Session, *, by: str | None = None, project: str | None = None,
    employee_id: Any = None, limit: int = 100,
) -> list[dict[str, Any]]:  # fmt: skip
    rows = session.execute(
        text(
            """SELECT v.created_at AS at, v.kind, v.decided_by, v.reason,
                      e.employee_code AS person_code, e.full_name AS person_name,
                      pf.name AS from_project, pt.name AS to_project, u.full_name AS by_user
               FROM workforce_events v
               LEFT JOIN employees e ON e.id = v.employee_id
               LEFT JOIN projects pf ON pf.id = v.project_from
               LEFT JOIN projects pt ON pt.id = v.project_to
               LEFT JOIN users u ON u.id = v.actor_id
               WHERE (CAST(:by AS text) IS NULL OR v.decided_by = :by)
                 AND (CAST(:project AS text) IS NULL OR pf.code = :project OR pt.code = :project)
                 AND (CAST(:emp AS uuid) IS NULL OR v.employee_id = :emp)
               ORDER BY v.created_at DESC, v.id LIMIT :limit"""
        ),
        {"by": by, "project": project, "emp": employee_id, "limit": limit},
    ).mappings()
    return [dict(r) for r in rows]


@router.get("/history")
def history(
    session: SessionDep,
    user: Reader,
    by: Annotated[Literal["ai", "hr"] | None, Query()] = None,
    project: Annotated[str | None, Query(max_length=20)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[dict[str, Any]]:
    """What was done to the workforce: placements, moves, steps, plan changes. `by=ai` is the AI's own."""
    _all_scope(user)
    return _history(session, by=by, project=project, limit=limit)


@router.get("/chart")
def chart(session: SessionDep, user: Reader) -> dict[str, Any]:
    """Planned vs joined vs on the way vs to hire, per project, for the graph on Home."""
    _all_scope(user)
    per: dict[str, dict[str, Any]] = {}
    for r in headcount.lines(session):
        item = per.setdefault(
            r.project_code,
            {"code": r.project_code, "name": r.project_name, "kind": r.project_kind,
             "stage": r.project_stage, "planned": 0, "active": 0, "pipeline": 0, "to_hire": 0},
        )  # fmt: skip
        item["planned"] += r.planned
        item["active"] += r.active
        item["pipeline"] += r.pipeline
        item["to_hire"] += r.to_hire
    items = sorted(per.values(), key=lambda p: (p["kind"] == "head_office", -p["planned"]))
    return {"projects": items, "totals": headcount.totals(headcount.lines(session))}
