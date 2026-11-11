"""Planned vs filled headcount per project and designation (rule HEADCOUNT).

A project plans a number of people for each designation (`plan_lines`). The people placed on it fill
that number: joined people (active) and people on the way (offer issued, documents cleared). What is
left is still to hire, and what is above it is over-filled. Resigned people never count.
Everything is computed on read, so adding a person lowers "to hire" by itself. A person who is a
UAE national fills the UAE-national line of their designation when the project has one.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

JOINED = ("active", "on_leave", "suspended")
PIPELINE = ("offer_issued", "documents_cleared")
STAGE_ORDER = {"active": 0, "handover": 1, "pre_construction": 2, "planning": 2, "on_hold": 3}


@dataclass
class Line:
    project_id: uuid.UUID
    project_code: str
    project_name: str
    project_kind: str
    project_stage: str
    trade_id: uuid.UUID
    trade: str
    kind: str  # labour | staff
    discipline: str | None
    uae_only: bool
    planned: int
    active: int
    pipeline: int
    needed_by: date | None
    source: str | None

    @property
    def to_hire(self) -> int:
        return max(self.planned - self.active - self.pipeline, 0)

    @property
    def over(self) -> int:
        return max(self.active + self.pipeline - self.planned, 0)

    @property
    def label(self) -> str:
        return f"UAEN {self.trade}" if self.uae_only else self.trade


def lines(session: Session, project_code: str | None = None, kind: str | None = None) -> list[Line]:
    """Every project x designation line, with its numbers. Optionally one project or one kind."""
    planned = {
        (r["project_id"], r["trade_id"], r["uae"]): r
        for r in session.execute(
            text(
                """SELECT l.project_id, l.trade_id, l.uae_national_only AS uae, l.planned,
                          l.needed_by, l.source, l.discipline
                   FROM plan_lines l"""
            )
        ).mappings()
    }
    people: dict[tuple[Any, Any, bool], dict[str, int]] = {}
    for r in session.execute(
        text(
            """SELECT e.project_id, e.primary_trade_id AS trade_id, e.uae_national AS uae,
                      e.employment_status::text AS status, count(*) AS n
               FROM employees e
               WHERE e.project_id IS NOT NULL AND e.primary_trade_id IS NOT NULL
               GROUP BY 1, 2, 3, 4"""
        )
    ).mappings():
        status = r["status"]
        bucket = "active" if status in JOINED else "pipeline" if status in PIPELINE else None
        if bucket is None:
            continue
        # A UAE national fills the UAE-national line when the project plans one for the role.
        uae = bool(r["uae"]) and (r["project_id"], r["trade_id"], True) in planned
        slot = people.setdefault(
            (r["project_id"], r["trade_id"], uae), {"active": 0, "pipeline": 0}
        )
        slot[bucket] += int(r["n"])
    keys = set(planned) | set(people)
    meta = {
        r["id"]: r
        for r in session.execute(
            text("SELECT id, code, name, kind, status::text AS stage FROM projects")
        ).mappings()
    }
    trades = {
        r["id"]: r
        for r in session.execute(text("SELECT id, name, kind, department FROM trades")).mappings()
    }
    out: list[Line] = []
    for project_id, trade_id, uae in keys:
        project, trade = meta[project_id], trades[trade_id]
        if (project_code and project["code"] != project_code) or (kind and trade["kind"] != kind):
            continue
        plan = planned.get((project_id, trade_id, uae))
        count = people.get((project_id, trade_id, uae), {"active": 0, "pipeline": 0})
        out.append(
            Line(
                project_id=project_id,
                project_code=project["code"],
                project_name=project["name"],
                project_kind=project["kind"],
                project_stage=project["stage"],
                trade_id=trade_id,
                trade=trade["name"],
                kind=trade["kind"],
                discipline=(plan["discipline"] if plan else None) or trade["department"],
                uae_only=uae,
                planned=int(plan["planned"]) if plan else 0,
                active=count["active"],
                pipeline=count["pipeline"],
                needed_by=plan["needed_by"] if plan else None,
                source=plan["source"] if plan else None,
            )  # fmt: skip
        )
    out.sort(key=lambda x: (x.project_code, x.kind, x.trade, x.uae_only))
    return out


def totals(rows: list[Line]) -> dict[str, int]:
    return {
        "planned": sum(r.planned for r in rows),
        "active": sum(r.active for r in rows),
        "pipeline": sum(r.pipeline for r in rows),
        "to_hire": sum(r.to_hire for r in rows),
        "over": sum(r.over for r in rows),
    }
