"""The questions the chat can answer, each as a read-only tool over a service the screens use.

A tool takes validated input, reads through the same code (and the same scope rules) as the screen
it mirrors, and returns `Findings`: blocks to draw, the facts a sentence may repeat, and a summary
sentence worded here in Python. A model may later reword that one sentence, but only if every
number, date, code and name in it is in these facts (see supervisor.py). No tool writes anything,
and none returns a phone number or a document number.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any, cast

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.ai.tools import Tool, ToolContext, ToolFailure, ToolOutput, log_tool_call
from app.auth.deps import AuthUser
from app.clock import Clock
from app.labels import document_label
from app.routes import documents as documents_route
from app.routes import projects as projects_route
from app.routes import requests as requests_route
from app.routes import workers as workers_route
from app.schemas import (
    AlertsBlock,
    BarsBlock,
    ChatAction,
    ChatAlert,
    ChatBar,
    ChatBlock,
    ChatColumn,
    ChatKpi,
    KpiBlock,
    NoteBlock,
    TableBlock,
    WorkerRow,
)
from app.services import mobilization as mobilization_service
from app.services.alerts import service as alerts_service
from app.services.alerts.findings import day, plural
from app.services.forecast import ForecastError, forecast_project

SHOW = 8  # rows an answer draws; the screen it links to has the rest


class ToolRefused(Exception):
    """The caller may not use this tool (or the agent does not have it). Logged as not allowed."""


@dataclass
class Findings:
    blocks: list[ChatBlock]
    facts: dict[str, Any]  # numbers, dates, codes and names a sentence about this may repeat
    template: str  # the summary sentence, worded here
    why: str  # how it was found, one line
    actions: list[ChatAction] = field(default_factory=lambda: [])
    empty: bool = False  # nothing matched


def _clock(ctx: ToolContext) -> Clock:
    return cast("Clock", ctx.scratch["clock"])


def _hard(failure: HTTPException) -> ToolFailure:
    return ToolFailure(str(failure.detail))


def _when(days: int) -> str:
    if days < 0:
        return f"expired {plural(-days, 'day')} ago"
    return "today" if days == 0 else f"in {plural(days, 'day')}"


def _table(
    columns: list[tuple[str, str]],
    rows: list[dict[str, str | int | None]],
    total: int,
    *,
    title: str | None = None,
    href: str | None = None,
) -> TableBlock:
    return TableBlock(
        title=title,
        columns=[ChatColumn(key=k, label=label) for k, label in columns],
        rows=rows,
        total=total,
        href=href,
    )


def _more(total: int, shown: int) -> list[ChatBlock]:
    if total > shown:
        return [NoteBlock(text=f"Showing the first {shown} of {total}. The screen has the rest.")]
    return []


# ----------------------------------------------------------------------------------- workers


class WorkersInput(BaseModel):
    trade: str | None = None
    project: str | None = None
    status: str | None = None
    q: str = ""
    expired: bool = False
    expiring_within: int | None = None


def _worker_cells(w: WorkerRow) -> dict[str, str | int | None]:
    doc = w.next_document
    return {
        "code": w.code,
        "name": w.name,
        "trade": w.trade,
        "level": w.level,
        "status": (w.status or "").replace("_", " ") or None,
        "project": w.project,
        "document": f"{document_label(doc.type)}, {_when(doc.days_left)}" if doc else None,
    }


def _link(path: str, **query: str | None) -> str:
    from urllib.parse import urlencode

    pairs = {k: v for k, v in query.items() if v}
    return f"{path}?{urlencode(pairs)}" if pairs else path


def search_workers(ctx: ToolContext, args: WorkersInput) -> ToolOutput:
    try:
        found = workers_route.list_workers(
            ctx.session,
            _clock(ctx),
            ctx.user,
            q=args.q,
            trade=args.trade,
            project=args.project,
            worker_status=cast("Any", args.status),
            expiring_within=args.expiring_within,
            expired=args.expired,
            sort="name",
            direction="asc",
            limit=SHOW,
            offset=0,
        )
    except HTTPException as failure:
        raise _hard(failure) from failure
    parts = [p for p in (args.status, args.trade, args.project) if p]
    if args.q:
        parts.append(f"matching “{args.q}”")
    if args.expired:
        parts.append("with an expired document")
    if args.expiring_within is not None:
        parts.append(f"with a document ending within {args.expiring_within} days")
    described = f" ({', '.join(parts)})" if parts else ""
    rows = [_worker_cells(w) for w in found.items]
    href = _link("/workers", trade=args.trade, status=args.status, project=args.project, q=args.q)
    facts: dict[str, Any] = {"total": found.total, "shown": len(rows), "people": rows}
    summary = {"found": found.total, "shown": len(rows)}
    if found.total == 0:
        template = f"No workers match{described}."
        out = Findings(
            [NoteBlock(text="Try fewer filters.")],
            facts,
            template,
            "Searched the worker directory.",
            [ChatAction(label="Open Workers", href="/workers")],
            empty=True,
        )
    else:
        template = (
            f"{plural(found.total, 'worker')} match{'es' if found.total == 1 else ''}{described}."
        )
        blocks: list[ChatBlock] = [
            _table(
                [
                    ("code", "Code"),
                    ("name", "Name"),
                    ("trade", "Trade"),
                    ("level", "Level"),
                    ("status", "Status"),
                    ("project", "Project"),
                    ("document", "Next document"),
                ],
                rows,
                found.total,
                href=href,
            ),
            *_more(found.total, len(rows)),
        ]
        out = Findings(
            blocks,
            facts,
            template,
            "Searched the worker directory in your scope.",
            [ChatAction(label="Open these in Workers", href=href)],
        )
    return ToolOutput({"findings": out}, summary)


# -------------------------------------------------------------------------------- one worker


class WorkerInput(BaseModel):
    code: str | None = None
    q: str = ""


def worker_profile(ctx: ToolContext, args: WorkerInput) -> ToolOutput:
    clock = _clock(ctx)
    code = args.code
    if code is None:
        try:
            found = workers_route.list_workers(
                ctx.session,
                clock,
                ctx.user,
                q=args.q,
                trade=None,
                project=None,
                worker_status=None,
                expiring_within=None,
                expired=False,
                sort="name",
                direction="asc",
                limit=SHOW,
                offset=0,
            )
        except HTTPException as failure:
            raise _hard(failure) from failure
        if found.total == 0:
            template = f"No worker matches “{args.q}”."
            out = Findings(
                [],
                {"total": 0, "name": args.q},
                template,
                "Searched the worker directory.",
                [ChatAction(label="Open Workers", href="/workers")],
                empty=True,
            )
            return ToolOutput({"findings": out}, {"found": 0, "shown": 0})
        if found.total > 1:
            rows = [_worker_cells(w) for w in found.items]
            template = f"{found.total} workers match “{args.q}”. Which one did you mean?"
            blocks: list[ChatBlock] = [
                _table(
                    [
                        ("code", "Code"),
                        ("name", "Name"),
                        ("trade", "Trade"),
                        ("status", "Status"),
                        ("project", "Project"),
                    ],
                    rows,
                    found.total,
                ),
                *_more(found.total, len(rows)),
            ]
            out = Findings(
                blocks,
                {"total": found.total, "people": rows},
                template,
                "Searched the worker directory.",
                [ChatAction(label="Open Workers", href=_link("/workers", q=args.q))],
            )
            return ToolOutput({"findings": out}, {"found": found.total, "shown": len(rows)})
        code = found.items[0].code
    try:
        w = workers_route.get_worker(code, ctx.session, clock, ctx.user)
    except HTTPException as failure:
        raise _hard(failure) from failure
    kpis = [
        ChatKpi(label="Status", value=(w.status or "—").replace("_", " ")),
        ChatKpi(label="Trade", value=w.trade),
        ChatKpi(label="Level", value=str(w.level) if w.level is not None else "—"),
        ChatKpi(label="Project", value=w.project or "—"),
    ]
    blocks = [KpiBlock(items=kpis)]
    docs: list[dict[str, str | int | None]] = [
        {
            "type": document_label(d.type),
            "expires": day(d.expiry) if d.expiry else None,
            "when": _when(d.days_left) if d.days_left is not None else None,
            "status": d.status,
        }
        for d in w.documents
    ]
    if docs:
        blocks.append(
            _table(
                [
                    ("type", "Document"),
                    ("expires", "Expires"),
                    ("when", "When"),
                    ("status", "Status"),
                ],
                docs,
                len(docs),
                title="Documents",
            )
        )
    blocks += [NoteBlock(tone="warning", text=r.message) for r in w.risks]
    live = [a for a in w.assignments if a.status in ("planned", "active")]
    facts: dict[str, Any] = {
        "code": w.code,
        "name": w.name,
        "trade": w.trade,
        "level": w.level,
        "status": w.status,
        "project": w.project,
        "documents": docs,
        "risks": [r.message for r in w.risks],
        "assignments": [
            {"project": a.project_code, "starts": a.starts, "ends": a.ends, "status": a.status}
            for a in w.assignments
        ],
    }
    where = (
        f", on {live[0].project_code} until {day(live[0].ends)}"
        if live and live[0].ends
        else (f", on {live[0].project_code}" if live else "")
    )
    state = (w.status or "unknown").replace("_", " ")
    template = f"{w.name} ({w.code}) is a {w.trade.lower()}{where}; status {state}."
    if w.risks:
        template += f" {plural(len(w.risks), 'risk')} flagged."
    out = Findings(
        blocks,
        facts,
        template,
        "Read the worker's profile (numbers stay hidden).",
        [ChatAction(label="Open the profile", href=_link("/workers", worker=w.code))],
    )
    return ToolOutput({"findings": out}, {"found": 1, "shown": 1, "risks": len(w.risks)})


# ---------------------------------------------------------------------------------- documents


class DocumentsInput(BaseModel):
    window: str = "d30"
    doc_type: str | None = None
    project: str | None = None


_WINDOW_WORDS = {
    "expired": "have expired",
    "d30": "end within 30 days",
    "d60": "end in 31 to 60 days",
    "d90": "end in 61 to 90 days",
}


def documents_expiring(ctx: ToolContext, args: DocumentsInput) -> ToolOutput:
    try:
        listing = documents_route.expiring(
            ctx.session,
            _clock(ctx),
            ctx.user,
            window=cast("Any", args.window),
            q="",
            doc_type=args.doc_type,
            project=args.project,
        )
    except HTTPException as failure:
        raise _hard(failure) from failure
    c = listing.counts
    shown = listing.items[:SHOW]
    rows: list[dict[str, str | int | None]] = [
        {
            "code": d.worker_code,
            "name": d.worker_name,
            "trade": d.trade,
            "project": d.project,
            "document": document_label(d.type),
            "expires": day(d.expiry),
            "when": _when(d.days_left),
            "note": "ends before the job" if d.ends_before_job else None,
        }
        for d in shown
    ]
    total = len(listing.items)
    kpis = KpiBlock(
        items=[
            ChatKpi(label="Expired", value=str(c.expired), tone="bad" if c.expired else "good"),
            ChatKpi(label="Within 30 days", value=str(c.d30), tone="warn" if c.d30 else "good"),
            ChatKpi(label="31 to 60 days", value=str(c.d60)),
            ChatKpi(label="61 to 90 days", value=str(c.d90)),
        ]
    )
    href = _link("/documents", window=args.window, type=args.doc_type, project=args.project)
    what = document_label(args.doc_type).lower() if args.doc_type else "document"
    facts: dict[str, Any] = {
        "counts": c.model_dump(),
        "total": total,
        "people": rows,
        "window": args.window,
    }
    if total == 0:
        template = f"No {what}s {_WINDOW_WORDS.get(args.window, 'match')}."
        out = Findings(
            [kpis],
            facts,
            template,
            "Read the document expiry list in your scope.",
            [ChatAction(label="Open Documents", href=href)],
            empty=True,
        )
    else:
        template = f"{plural(total, what)} {_WINDOW_WORDS.get(args.window, 'match')}."
        blocks: list[ChatBlock] = [
            kpis,
            _table(
                [
                    ("code", "Code"),
                    ("name", "Name"),
                    ("trade", "Trade"),
                    ("project", "Project"),
                    ("document", "Document"),
                    ("expires", "Expires"),
                    ("when", "When"),
                    ("note", "Note"),
                ],
                rows,
                total,
                href=href,
            ),
            *_more(total, len(rows)),
        ]
        out = Findings(
            blocks,
            facts,
            template,
            "Read the document expiry list in your scope.",
            [ChatAction(label="Open Documents", href=href)],
        )
    return ToolOutput({"findings": out}, {"found": total, "shown": len(rows)})


# -------------------------------------------------------------------------------------- alerts


class AlertsInput(BaseModel):
    severity: str | None = None
    project: str | None = None
    mine: bool = False


def list_alerts(ctx: ToolContext, args: AlertsInput) -> ToolOutput:
    clock = _clock(ctx)
    listing = alerts_service.list_alerts(
        ctx.session,
        ctx.user,
        clock.now(),
        view="open",
        severity=args.severity,
        project=args.project,
        mine=args.mine,
    )
    c = listing.counts
    live = c.critical + c.action_needed + c.info
    shown = listing.items[:SHOW]
    items = [
        ChatAlert(
            id=a.id,
            severity=a.severity,
            title=a.title,
            project=a.project,
            raised=day(a.raised_at.date()),
        )
        for a in shown
    ]
    kpis = KpiBlock(
        items=[
            ChatKpi(label="Critical", value=str(c.critical), tone="bad" if c.critical else "good"),
            ChatKpi(
                label="Action needed",
                value=str(c.action_needed),
                tone="warn" if c.action_needed else "good",
            ),
            ChatKpi(label="Info", value=str(c.info)),
        ]
    )
    href = _link("/todo", severity=args.severity, project=args.project)
    facts: dict[str, Any] = {
        "counts": c.model_dump(),
        "live": live,
        "alerts": [{"title": a.title, "project": a.project, "raised": a.raised} for a in items],
    }
    if live == 0:
        out = Findings(
            [kpis],
            facts,
            "Nothing is open: there are no alerts in your scope.",
            "Read the open alerts in your scope.",
            [ChatAction(label="Open To-do", href="/todo")],
            empty=True,
        )
    else:
        template = (
            f"{plural(live, 'alert')} open: {c.critical} critical, {c.action_needed} need action "
            f"and {c.info} are for information."
        )
        out = Findings(
            [kpis, AlertsBlock(items=items, total=live), *_more(live, len(items))],
            facts,
            template,
            "Read the open alerts in your scope, most urgent first.",
            [ChatAction(label="Open To-do", href=href)],
        )
    return ToolOutput({"findings": out}, {"found": live, "shown": len(items)})


# ------------------------------------------------------------------------------------ projects


class ProjectsInput(BaseModel):
    project: str | None = None


def list_projects(ctx: ToolContext, args: ProjectsInput) -> ToolOutput:
    rows_all = projects_route.list_projects(ctx.session, ctx.user)
    if args.project:
        rows_all = [p for p in rows_all if p.code == args.project]
    rows: list[dict[str, str | int | None]] = [
        {
            "code": p.code,
            "name": p.name,
            "status": p.status.replace("_", " "),
            "starts": day(p.starts) if p.starts else None,
            "ends": day(p.ends) if p.ends else None,
            "planned": p.planned,
            "deployed": p.deployed,
            "short": max(p.planned - p.deployed, 0),
        }
        for p in rows_all
    ]
    active = [p for p in rows_all if p.status == "active"]
    planned = sum(p.planned for p in active)
    deployed = sum(p.deployed for p in active)
    facts: dict[str, Any] = {
        "projects": rows,
        "total": len(rows),
        "active": len(active),
        "planned": planned,
        "deployed": deployed,
    }
    if not rows:
        out = Findings(
            [],
            facts,
            "No projects are in your scope.",
            "Read the projects in your scope.",
            [ChatAction(label="Open Projects", href="/projects")],
            empty=True,
        )
        return ToolOutput({"findings": out}, {"found": 0, "shown": 0})
    blocks: list[ChatBlock] = [
        BarsBlock(
            title="Deployed against planned, active projects",
            items=[
                ChatBar(label=p.code, value=p.deployed, of=p.planned, detail=p.name)
                for p in active[:SHOW]
            ],
        )
        if active
        else NoteBlock(text="No project is active."),
        _table(
            [
                ("code", "Code"),
                ("name", "Name"),
                ("status", "Status"),
                ("starts", "Starts"),
                ("ends", "Ends"),
                ("planned", "Planned"),
                ("deployed", "Deployed"),
            ],
            rows[:SHOW],
            len(rows),
            href="/projects",
        ),
        *_more(len(rows), min(len(rows), SHOW)),
    ]
    template = (
        f"{plural(len(rows), 'project')}, {len(active)} active: {deployed} of {planned} planned "
        "people are deployed on the active ones."
    )
    out = Findings(
        blocks,
        facts,
        template,
        "Read the projects in your scope.",
        [ChatAction(label="Open Projects", href="/projects")],
    )
    return ToolOutput({"findings": out}, {"found": len(rows), "shown": min(len(rows), SHOW)})


# ------------------------------------------------------------------------------------ forecast


class ForecastQuery(BaseModel):
    project: str
    start: date | None = None
    when: str | None = None


def forecast_availability(ctx: ToolContext, args: ForecastQuery) -> ToolOutput:
    try:
        f = forecast_project(
            ctx.session, ctx.user, ctx.settings, args.project, ctx.today, args.start
        )
    except ForecastError as error:
        raise ToolFailure(str(error)) from error
    if f is None:
        raise ToolFailure("That project does not exist, or is outside your access.")
    needed = sum(t.needed for t in f.trades)
    assigned = sum(t.already_assigned for t in f.trades)
    deployable = sum(t.deployable for t in f.trades)
    recruiting = sum(t.recruitment_pending for t in f.trades)
    uncovered = sum(t.uncovered_gap for t in f.trades)
    short = [t for t in f.trades if t.uncovered_gap > 0]
    kpis = KpiBlock(
        items=[
            ChatKpi(label="Needed", value=str(needed)),
            ChatKpi(label="Already assigned", value=str(assigned)),
            ChatKpi(label="Can be deployed", value=str(deployable), tone="good"),
            ChatKpi(label="In recruitment", value=str(recruiting)),
            ChatKpi(
                label="Still uncovered", value=str(uncovered), tone="bad" if uncovered else "good"
            ),
        ]
    )
    bars = BarsBlock(
        title="Covered against needed, by trade",
        items=[
            ChatBar(
                label=t.trade,
                value=min(t.needed, t.already_assigned + t.deployable + t.recruitment_pending),
                of=t.needed,
                detail=t.advice.headline,
            )
            for t in f.trades
        ],
    )
    rows: list[dict[str, str | int | None]] = [
        {
            "trade": t.trade,
            "needed": t.needed,
            "assigned": t.already_assigned,
            "deployable": t.deployable,
            "recruiting": t.recruitment_pending,
            "uncovered": t.uncovered_gap,
        }
        for t in f.trades
    ]
    facts: dict[str, Any] = {
        "project": f.project.code,
        "project_name": f.project.name,
        "start": f.start,
        "needed": needed,
        "already_assigned": assigned,
        "deployable": deployable,
        "recruitment_pending": recruiting,
        "uncovered": uncovered,
        "trades": rows,
        "advice": {t.trade: t.advice.headline for t in f.trades},
    }
    template = (
        f"{f.project.code} needs {needed} people from {day(f.start)}: {assigned} already "
        f"assigned, {deployable} can be deployed and {recruiting} are in recruitment"
        + (
            f"; {uncovered} are still uncovered ({', '.join(t.trade for t in short)})."
            if uncovered
            else "; every place is covered."
        )
    )
    blocks: list[ChatBlock] = [
        kpis,
        bars,
        _table(
            [
                ("trade", "Trade"),
                ("needed", "Needed"),
                ("assigned", "Assigned"),
                ("deployable", "Deployable"),
                ("recruiting", "Recruiting"),
                ("uncovered", "Uncovered"),
            ],
            rows,
            len(rows),
        ),
    ]
    out = Findings(
        blocks,
        facts,
        template,
        "Read the manpower forecast; every number is Python's.",
        [ChatAction(label="Open the forecast", href=f"/projects/{f.project.code}/forecast")],
    )
    summary = {
        "project": f.project.code,
        "trades": len(f.trades),
        "short": len(short),
        "start": f.start,
    }
    return ToolOutput({"findings": out}, summary)


# ------------------------------------------------------------------------------------ requests


class RequestsInput(BaseModel):
    status: str | None = None
    project: str | None = None


def list_requests(ctx: ToolContext, args: RequestsInput) -> ToolOutput:
    try:
        found = requests_route.list_requests(
            ctx.session,
            _clock(ctx),
            ctx.user,
            request_status=args.status,
            project=args.project,
            q="",
        )
    except HTTPException as failure:
        raise _hard(failure) from failure
    rows: list[dict[str, str | int | None]] = [
        {
            "request": r.request_no,
            "project": r.project_code,
            "status": r.status.replace("_", " "),
            "needed": day(r.needed_from),
            "people": sum(x.headcount for x in r.lines),
            "waiting": f"{r.waiting_days} days" if r.status in ("submitted", "in_review") else None,
        }
        for r in found[:SHOW]
    ]
    facts: dict[str, Any] = {"total": len(found), "requests": rows}
    if not found:
        out = Findings(
            [],
            facts,
            "No staffing requests match.",
            "Read the staffing requests in your scope.",
            [ChatAction(label="Open Allocation", href="/requests")],
            empty=True,
        )
        return ToolOutput({"findings": out}, {"found": 0, "shown": 0})
    blocks: list[ChatBlock] = [
        _table(
            [
                ("request", "Request"),
                ("project", "Project"),
                ("status", "Status"),
                ("needed", "Needed from"),
                ("people", "People"),
                ("waiting", "Waiting"),
            ],
            rows,
            len(found),
            href="/requests",
        ),
        *_more(len(found), len(rows)),
    ]
    template = f"{plural(len(found), 'staffing request')} match."
    out = Findings(
        blocks,
        facts,
        template,
        "Read the staffing requests in your scope.",
        [ChatAction(label="Open Allocation", href="/requests")],
    )
    return ToolOutput({"findings": out}, {"found": len(found), "shown": len(rows)})


# ------------------------------------------------------------------------------- mobilizations

_STAGE_LABEL = {
    "pending_checklist": "Pending checklist",
    "in_progress": "In progress",
    "ready": "Ready to report",
    "on_site": "On site",
}


class MobilizationsInput(BaseModel):
    project: str | None = None
    mob_no: str | None = None
    worker: str | None = None  # an employee code or part of a name
    overdue_only: bool = False
    stage: str | None = None


def list_mobilizations(ctx: ToolContext, args: MobilizationsInput) -> ToolOutput:
    """The mobilization pipeline as the Mobilization screen shows it, read through the same
    service and scope. One match also shows its checklist. Nothing here ticks or approves."""
    today = _clock(ctx).today()
    found = mobilization_service.mobilization_rows(
        ctx.session,
        ctx.user,
        today,
        q=args.mob_no or args.worker or "",
        project=args.project or "",
        overdue_only=args.overdue_only,
    ).items
    if args.stage:
        found = [r for r in found if r.stage == args.stage]
    rows: list[dict[str, str | int | None]] = [
        {
            "mob_no": r.mob_no,
            "worker": f"{r.worker_name} ({r.worker_code})",
            "project": r.project_code,
            "reports": day(r.report_on),
            "stage": _STAGE_LABEL[r.stage],
            "progress": f"{r.tasks_done} of {r.tasks_total}",
            "overdue": r.overdue or None,
        }
        for r in found[:SHOW]
    ]
    overdue = sum(1 for r in found if r.overdue)
    facts: dict[str, Any] = {
        "total": len(found),
        "with_overdue_task": overdue,
        "mobilizations": rows,
    }
    actions = [ChatAction(label="Open Mobilization", href="/mobilization")]
    if not found:
        out = Findings(
            [],
            facts,
            "No mobilizations match.",
            "Read the mobilization pipeline in your scope.",
            actions,
            empty=True,
        )
        return ToolOutput({"findings": out}, {"found": 0, "shown": 0})
    blocks: list[ChatBlock] = [
        _table(
            [
                ("mob_no", "Mobilization"),
                ("worker", "Worker"),
                ("project", "Project"),
                ("reports", "Reports"),
                ("stage", "Stage"),
                ("progress", "Tasks done"),
                ("overdue", "Overdue"),
            ],
            rows,
            len(found),
            href="/mobilization",
        ),
        *_more(len(found), len(rows)),
    ]
    if len(found) == 1:
        detail = mobilization_service.mobilization_detail(
            ctx.session, ctx.user, found[0].mob_no, today
        )
        if detail is not None:
            tasks: list[dict[str, str | int | None]] = [
                {
                    "task": t.title,
                    "department": t.department_name,
                    "due": day(t.due_on) if t.due_on else None,
                    "state": "Done" if t.status == "done" else "Overdue" if t.overdue else "Open",
                }
                for t in detail.tasks
            ]
            facts["checklist"] = tasks
            blocks.append(
                _table(
                    [
                        ("task", "Task"),
                        ("department", "Department"),
                        ("due", "Due"),
                        ("state", "State"),
                    ],
                    tasks,
                    len(tasks),
                    title="Checklist",
                )
            )
    template = f"{plural(len(found), 'mobilization')} match" + (
        f", {overdue} with an overdue task." if overdue else "."
    )
    out = Findings(
        blocks, facts, template, "Read the mobilization pipeline in your scope.", actions
    )
    return ToolOutput({"findings": out}, {"found": len(found), "shown": len(rows)})


# ---------------------------------------------------------------------------------- the table

TOOLS: dict[str, Tool] = {
    t.name: t
    for t in (
        Tool(
            "search_workers",
            "Find workers by trade, project, status or name.",
            "employee:read",
            WorkersInput,
            search_workers,
        ),
        Tool(
            "worker_profile",
            "One worker's profile, without document or phone numbers.",
            "employee:read",
            WorkerInput,
            worker_profile,
        ),
        Tool(
            "documents_expiring",
            "Documents expired or ending soon.",
            "employee:read",
            DocumentsInput,
            documents_expiring,
        ),
        Tool(
            "list_alerts",
            "Open alerts in the caller's scope.",
            "alert:read",
            AlertsInput,
            list_alerts,
        ),
        Tool(
            "list_projects",
            "Projects with planned and deployed people.",
            "project:read",
            ProjectsInput,
            list_projects,
        ),
        Tool(
            "forecast_availability",
            "The manpower forecast of one project.",
            "forecast:read",
            ForecastQuery,
            forecast_availability,
        ),
        Tool(
            "list_requests",
            "Staffing requests and their status.",
            "staffing:read",
            RequestsInput,
            list_requests,
        ),
        Tool(
            "list_mobilizations",
            "The mobilization pipeline and, for one person, their checklist.",
            "mobilization:read",
            MobilizationsInput,
            list_mobilizations,
        ),
    )
}


def call_tool(
    ctx: ToolContext, run_id: uuid.UUID, tool: Tool, params: dict[str, Any], allowed: set[str]
) -> Findings:
    """Run one tool as the caller: the agent must have it, the caller must hold its permission,
    the input is validated, and the call is logged either way. Raises ToolRefused or ToolFailure."""
    started = time.monotonic()
    session: Session = ctx.session
    user: AuthUser = ctx.user
    if tool.name not in allowed:
        log_tool_call(
            session,
            run_id,
            tool.name,
            "none",
            False,
            params,
            {"error": "not an allowed tool"},
            started,
        )
        raise ToolRefused("The assistant does not have that tool.")
    if not user.can(tool.permission):
        log_tool_call(
            session,
            run_id,
            tool.name,
            tool.permission,
            False,
            params,
            {"error": "permission"},
            started,
        )
        raise ToolRefused(f"{tool.name} needs {tool.permission}, which you do not have.")
    try:
        args = tool.inputs.model_validate(params)
    except ValidationError as error:
        log_tool_call(
            session,
            run_id,
            tool.name,
            tool.permission,
            True,
            params,
            {"error": "invalid arguments"},
            started,
        )
        raise ToolFailure("That question did not give me what I need.") from error
    try:
        out = tool.run(ctx, args)
    except ToolFailure as failure:
        log_tool_call(
            session,
            run_id,
            tool.name,
            tool.permission,
            True,
            params,
            {"error": str(failure)},
            started,
        )
        raise
    log_tool_call(
        session,
        run_id,
        tool.name,
        tool.permission,
        True,
        args.model_dump(mode="json"),
        out.summary,
        started,
    )
    return cast("Findings", out.result["findings"])
