# ruff: noqa: E501
"""Placing people on projects: adding, moving, the over-filled check, "let AI decide", the hiring board.

Every number comes from services/headcount.py and every sentence is made here from those numbers
(rules AUTO_PLACE, OVERFILL_ASK, HIRE_ADVICE, PLACE_ON_HIRE). A model may later reword a sentence, never
change a number. A placement that would overfill a project changes nothing: it raises `Overfilled`
with the table HR needs, and HR answers by raising the plan, picking someone else, or cancelling.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import headcount
from app.services.alerts.findings import day
from app.services.headcount import Line

MILESTONES = ("offer_issued", "documents_cleared", "active")  # active = joined
NEXT_STEP = {"offer_issued": "documents_cleared", "documents_cleared": "active"}
LEFT = ("resigned", "terminated", "absconded")
CLOSED_STAGES = ("completed", "cancelled")
STAGE_LABEL = {
    "pre_construction": "Pre-construction", "planning": "Pre-construction",
    "active": "Under construction", "handover": "Handover",
    "completed": "Completed", "on_hold": "On hold", "cancelled": "Cancelled",
}  # fmt: skip


class WorkforceError(Exception):
    """A change the rules refuse; `status` is the HTTP code to answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Overfilled(Exception):
    """The line is full. Nothing was changed; this is what HR is asked."""

    project_code: str
    project_name: str
    designation: str
    planned: int
    now: int
    people: list[dict[str, str]]  # who is on the line already (to move or resign instead)

    @property
    def table(self) -> list[dict[str, Any]]:
        return [
            {"project": self.project_name, "designation": self.designation,
             "planned": self.planned, "now": self.now, "after": self.now + 1}
        ]  # fmt: skip

    @property
    def message(self) -> str:
        return (
            f"{self.project_name} plans {self.planned} {self.designation} and already has {self.now}. "
            f"One more would be {self.now + 1}."
        )


def log(
    session: Session, kind: str, employee_id: Any, project_from: Any, project_to: Any,
    decided_by: str, reason: str | None, actor: Any,
) -> None:  # fmt: skip
    session.execute(
        text(
            """INSERT INTO workforce_events
                   (employee_id, project_from, project_to, kind, decided_by, reason, actor_id)
               VALUES (:e, :f, :t, :k, :d, :r, :a)"""
        ),
        {"e": employee_id, "f": project_from, "t": project_to, "k": kind, "d": decided_by,
         "r": reason, "a": actor},
    )  # fmt: skip


def trade_named(session: Session, name: str, kind: str | None = None) -> Any:
    row = (
        session.execute(
            text(
                """SELECT id, name, kind, department FROM trades
                   WHERE lower(name) = lower(:n) AND (CAST(:k AS text) IS NULL OR kind = :k)
                   ORDER BY kind LIMIT 1"""
            ),
            {"n": " ".join(name.split()), "k": kind},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkforceError(422, f"“{name}” is not a known role. Pick one from the list.")
    return row


def project_named(session: Session, code: str) -> Any:
    row = (
        session.execute(
            text(
                "SELECT id, code, name, kind, status::text AS stage FROM projects WHERE code = :c"
            ),
            {"c": code},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise WorkforceError(404, "Project not found")
    return row


def line_for(session: Session, project: Any, trade: Any, uae_person: bool) -> Line:
    """The line a person of this role would fill on this project (a zero line when none is planned)."""
    rows = [r for r in headcount.lines(session, project["code"]) if r.trade_id == trade["id"]]
    if uae_person:
        for r in rows:
            if r.uae_only:
                return r
    for r in rows:
        if not r.uae_only:
            return r
    return Line(
        project_id=project["id"], project_code=project["code"], project_name=project["name"],
        project_kind=project["kind"], project_stage=project["stage"], trade_id=trade["id"],
        trade=trade["name"], kind=trade["kind"], discipline=trade["department"], uae_only=False,
        planned=0, active=0, pipeline=0, needed_by=None, source=None,
    )  # fmt: skip


def people_on(session: Session, line: Line, limit: int = 30) -> list[dict[str, str]]:
    rows = session.execute(
        text(
            """SELECT employee_code AS code, full_name AS name, employment_status::text AS status
               FROM employees WHERE project_id = :p AND primary_trade_id = :t
                 AND employment_status::text NOT IN ('resigned', 'terminated', 'absconded')
               ORDER BY full_name LIMIT :n"""
        ),
        {"p": line.project_id, "t": line.trade_id, "n": limit},
    ).mappings()
    return [dict(r) for r in rows]


def raise_plan(session: Session, line: Line, actor: Any, decided_by: str = "hr") -> Line:
    """Plan one more place on this line (HR said yes to the over-filled question)."""
    session.execute(
        text(
            """INSERT INTO plan_lines (project_id, trade_id, planned, uae_national_only)
               VALUES (:p, :t, 1, :u)
               ON CONFLICT (project_id, trade_id, uae_national_only)
               DO UPDATE SET planned = plan_lines.planned + 1, updated_at = now()"""
        ),
        {"p": line.project_id, "t": line.trade_id, "u": line.uae_only},
    )
    log(
        session, "plan_changed", None, None, line.project_id, decided_by,
        f"Planned {line.trade} on {line.project_name} raised from {line.planned} to {line.planned + 1}",
        actor,
    )  # fmt: skip
    line.planned += 1
    return line


def ensure_room(session: Session, line: Line, resolve: str | None, actor: Any) -> Line:
    """Make sure one more person fits. A full line raises Overfilled unless HR already agreed."""
    if line.to_hire >= 1:
        return line
    if resolve == "increase_plan":
        return raise_plan(session, line, actor)
    raise Overfilled(
        line.project_code, line.project_name, line.label, line.planned,
        line.active + line.pipeline, people_on(session, line),
    )  # fmt: skip


def auto_pick(session: Session, trade: Any, uae_person: bool) -> tuple[Line, str] | None:
    """The project that needs this role most, and why. None when no project has an open place."""
    open_lines = [
        r for r in headcount.lines(session)
        if r.trade_id == trade["id"] and r.to_hire > 0 and r.project_stage not in CLOSED_STAGES
        and (uae_person or not r.uae_only)
    ]  # fmt: skip
    if not open_lines:
        return None
    rank = {"active": 0, "handover": 1, "pre_construction": 2, "planning": 2, "on_hold": 3}
    open_lines.sort(
        key=lambda r: (
            r.needed_by is None,
            r.needed_by or date.max,
            rank.get(r.project_stage, 4),
            -(r.to_hire / r.planned if r.planned else 0),
            0 if r.uae_only else 1,
            r.project_code,
        )
    )
    best = open_lines[0]
    why = [f"{best.to_hire} of {best.planned} {best.label} places are still open"]
    stage = STAGE_LABEL.get(best.project_stage, best.project_stage).lower()
    why.append(
        f"needed by {day(best.needed_by)}"
        if best.needed_by
        else f"no needed-by date is set, so I compared the stage ({stage}) and how much of the plan is open"
    )
    others = [f"{r.project_name} ({r.to_hire} open)" for r in open_lines[1:3]]
    sentence = f"{best.project_name}: " + ", ".join(why) + "."
    if others:
        sentence += " Next in line: " + ", ".join(others) + "."
    return best, sentence


def new_code(name: str, kind: str) -> str:
    digest = hashlib.sha1(f"{kind}|{name}|{uuid.uuid4()}".encode()).hexdigest()  # noqa: S324
    return f"NEW-{digest[:8].upper()}"


def add_person(
    session: Session, actor: Any, *, name: str, designation: str, project_code: str | None,
    auto: bool, status: str, code: str | None, phone: str | None, email: str | None,
    uae_national: bool, joined_on: date | None, source: str | None, resolve: str | None,
) -> dict[str, Any]:  # fmt: skip
    """Add one person and place them. Raises WorkforceError, or Overfilled when the line is full."""
    if status not in MILESTONES:
        raise WorkforceError(
            422, "A new person starts as offer issued, documents cleared or joined."
        )
    trade = trade_named(session, designation)
    if (
        code
        and session.execute(
            text("SELECT 1 FROM employees WHERE employee_code = :c"), {"c": code}
        ).first()
    ):
        raise WorkforceError(409, f"Company ID {code} is already used by someone else.")
    decided_by, reason = "hr", None
    if auto:
        picked = auto_pick(session, trade, uae_national)
        if picked is None:
            raise WorkforceError(
                409,
                f"No project has an open {trade['name']} place right now. Choose a project, "
                "and say if its plan should grow by one.",
            )
        line, reason = picked
        decided_by = "ai"
    else:
        if not project_code:
            raise WorkforceError(422, "Choose a project, or let the AI decide.")
        project = project_named(session, project_code)
        line = ensure_room(session, line_for(session, project, trade, uae_national), resolve, actor)
    employee = (
        session.execute(
            text(
                """INSERT INTO employees
                       (employee_code, full_name, phone, email, primary_trade_id, project_id,
                        discipline, employment_status, availability, joined_on, source, uae_national,
                        is_demo)
                   VALUES (:code, :name, :phone, :email, :trade, :project, :disc,
                           CAST(:status AS employment_status), CAST(:avail AS availability_state),
                           :joined, :src, :uae, false)
                   RETURNING id, employee_code"""
            ),
            {
                "code": code or new_code(name, trade["kind"]),
                "name": " ".join(name.split()),
                "phone": phone,
                "email": email,
                "trade": trade["id"],
                "project": line.project_id,
                "disc": trade["department"],
                "status": status,
                "avail": "deployed" if status == "active" else "available",
                "joined": joined_on or (date.today() if status == "active" else None),
                "src": source,
                "uae": uae_national,
            },
        )  # fmt: skip
        .mappings()
        .one()
    )
    left = line.to_hire - 1
    sentence = (
        f"{name} was placed on {line.project_name} as {line.label}. "
        f"{line.project_name} now has {line.active + line.pipeline + 1} of {line.planned} "
        f"{line.label}; {left} still to hire."
    )
    log(
        session,
        "added",
        employee["id"],
        None,
        line.project_id,
        "hr",
        f"Added as {line.label}",
        actor,
    )
    log(
        session,
        "placed",
        employee["id"],
        None,
        line.project_id,
        decided_by,
        reason or f"Chosen by HR: {line.project_name}",
        actor,
    )
    return {
        "code": employee["employee_code"], "project_code": line.project_code,
        "project_name": line.project_name, "designation": line.label, "planned": line.planned,
        "filled": line.active + line.pipeline + 1, "to_hire": left, "decided_by": decided_by,
        "reason": reason, "message": sentence,
    }  # fmt: skip


def milestone(session: Session, actor: Any, code: str, to: str, on: date | None) -> dict[str, Any]:
    person = (
        session.execute(
            text(
                """SELECT id, full_name, employment_status::text AS status, project_id
                   FROM employees WHERE employee_code = :c"""
            ),
            {"c": code},
        )
        .mappings()
        .first()
    )
    if person is None:
        raise WorkforceError(404, "Person not found")
    now = person["status"]
    if to == "resigned":
        if now in LEFT:
            raise WorkforceError(409, f"{person['full_name']} has already left.")
        session.execute(
            text(
                """UPDATE employees SET employment_status = 'resigned', exit_on = :on,
                          availability = 'unavailable', updated_at = now() WHERE id = :id"""
            ),
            {"id": person["id"], "on": on or date.today()},
        )
        log(session, "resigned", person["id"], person["project_id"], None, "hr", None, actor)
        return {"code": code, "status": "resigned"}
    if NEXT_STEP.get(now) != to:
        steps = " then ".join(s.replace("_", " ") for s in MILESTONES)
        raise WorkforceError(
            409,
            f"{person['full_name']} is {now.replace('_', ' ')}. The steps are in order: {steps}.",
        )
    session.execute(
        text(
            """UPDATE employees SET employment_status = CAST(:to AS employment_status),
                      joined_on = CASE WHEN :to = 'active' THEN COALESCE(:on, joined_on, current_date)
                                       ELSE joined_on END,
                      availability = CASE WHEN :to = 'active' THEN 'deployed' ELSE availability END,
                      updated_at = now() WHERE id = :id"""
        ),
        {"id": person["id"], "to": to, "on": on},
    )
    log(
        session, "joined" if to == "active" else "documents_cleared", person["id"], None,
        person["project_id"], "hr", None, actor,
    )  # fmt: skip
    return {"code": code, "status": to}


def move(
    session: Session, actor: Any, code: str, project_code: str, resolve: str | None
) -> dict[str, Any]:  # fmt: skip
    person = (
        session.execute(
            text(
                """SELECT e.id, e.full_name, e.primary_trade_id, e.uae_national, e.project_id,
                          e.employment_status::text AS status
                   FROM employees e WHERE e.employee_code = :c"""
            ),
            {"c": code},
        )
        .mappings()
        .first()
    )
    if person is None:
        raise WorkforceError(404, "Person not found")
    if person["status"] in LEFT:
        raise WorkforceError(409, f"{person['full_name']} has left and cannot be moved.")
    if (
        person["project_id"] is not None
        and person["project_id"] == project_named(session, project_code)["id"]
    ):
        raise WorkforceError(409, f"{person['full_name']} is already on that project.")
    target = project_named(session, project_code)
    trade = session.execute(
        text("SELECT id, name, kind, department FROM trades WHERE id = :t"), {"t": person["primary_trade_id"]}
    ).mappings().one()  # fmt: skip
    line = ensure_room(
        session, line_for(session, target, trade, person["uae_national"]), resolve, actor
    )
    session.execute(
        text("UPDATE employees SET project_id = :p, updated_at = now() WHERE id = :id"),
        {"p": target["id"], "id": person["id"]},
    )
    reason = f"{person['full_name']} moved to {target['name']} as {line.label} ({line.to_hire - 1} still to hire there)"
    log(session, "moved", person["id"], person["project_id"], target["id"], "hr", reason, actor)
    return {
        "code": code,
        "project_code": target["code"],
        "project_name": target["name"],
        "message": reason,
    }


# ---------------------------------------------------------------------------- the hiring board


def could_move(session: Session, trade_id: Any, uae_only: bool) -> int:
    """People of this role who could fill an open place without hiring: surplus on other projects,
    people with no project, and people on a completed project. (UAE-only places: UAE nationals only.)"""
    lines = [r for r in headcount.lines(session) if r.trade_id == trade_id]
    surplus = sum(r.over for r in lines if r.uae_only == uae_only)
    extra = session.execute(
        text(
            """SELECT count(*) FROM employees e LEFT JOIN projects p ON p.id = e.project_id
               WHERE e.primary_trade_id = :t AND e.employment_status::text = 'active'
                 AND (e.project_id IS NULL OR p.status::text = 'completed')
                 AND (NOT :uae OR e.uae_national)"""
        ),
        {"t": trade_id, "uae": uae_only},
    ).scalar_one()
    return surplus + int(extra)


def board(session: Session, kind: str | None = None) -> dict[str, Any]:
    """Who still has to be hired, per role, with a simple table per project underneath."""
    grouped: dict[tuple[Any, bool], list[Line]] = {}
    for r in headcount.lines(session, kind=kind):
        if r.to_hire > 0 and r.project_stage not in CLOSED_STAGES:
            grouped.setdefault((r.trade_id, r.uae_only), []).append(r)
    rows: list[dict[str, Any]] = []
    for (trade_id, uae), lines in grouped.items():
        to_hire = sum(r.to_hire for r in lines)
        movable = could_move(session, trade_id, uae)
        hire = max(to_hire - movable, 0)
        first = lines[0]
        rows.append(
            {
                "designation": first.label,
                "role": first.trade,
                "uae_only": uae,
                "kind": first.kind,
                "department": first.discipline,
                "to_hire": to_hire,
                "could_move": movable,
                "hire": hire,
                "advice": (
                    f"{to_hire} open. {movable} could move from elsewhere, so hire {hire}."
                    if movable
                    else f"{to_hire} open and nobody to move, so hire {to_hire}."
                ),
                "projects": [
                    {
                        "project_code": r.project_code,
                        "project_name": r.project_name,
                        "stage": r.project_stage,
                        "planned": r.planned,
                        "active": r.active,
                        "pipeline": r.pipeline,
                        "to_hire": r.to_hire,
                        "needed_by": r.needed_by.isoformat() if r.needed_by else None,
                        "source": r.source,
                    }
                    for r in sorted(
                        lines,
                        key=lambda x: (
                            x.needed_by is None,
                            x.needed_by or date.max,
                            x.project_code,
                        ),
                    )
                ],
            }  # fmt: skip
        )
    rows.sort(key=lambda r: (-r["to_hire"], r["designation"]))
    return {
        "rows": rows,
        "totals": {
            "to_hire": sum(r["to_hire"] for r in rows),
            "hire": sum(r["hire"] for r in rows),
            "labour": sum(r["to_hire"] for r in rows if r["kind"] == "labour"),
            "staff": sum(r["to_hire"] for r in rows if r["kind"] == "staff"),
        },
    }
