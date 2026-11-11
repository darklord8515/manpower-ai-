# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false
# ruff: noqa: E501
"""Reads the client's labour and staff trackers (Excel) into projects, people and planned headcount.

Each tracker row is a position: a person, or an empty slot ("TBA"). The rules (TRACKER_CLEANING):
- status words map to active, offer issued, documents cleared (arrived), resigned (and its kin), or an
  open vacancy (future requirement, under recruitment, interview stage);
- a TBA or blank name is a vacancy: it adds to the planned count and creates nobody;
- "- UAEN" on a designation is stripped and makes the position UAE-nationals-only;
- every non-resigned row adds one to the planned count of its project and designation;
- a planned transfer out leaves the person where they are; a planned transfer in is an open position on the
  new project. Neither is applied, both are counted so HR can move the person by hand;
- salary, camp and accommodation columns are ignored. Phone numbers are stored, never sent to a model.
Parsing changes nothing; `apply` writes everything in the caller's transaction and can be re-run: people are
matched by their company ID and planned counts are replaced by what the sheet says.
"""

from __future__ import annotations

import hashlib
import io
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal

import openpyxl
from sqlalchemy import text
from sqlalchemy.orm import Session

Kind = Literal["labour", "staff"]
SHEETS: dict[str, str] = {"labour": "Labour_Master", "staff": "Staff_Master"}
BLANK_NAMES = {"", "tba", "tbc", "tbd", "-", "--", "na", "n/a", "nil", "to be added", "vacant"}
PERSON_STATUSES = (
    "active",
    "on_leave",
    "offer_issued",
    "documents_cleared",
    "resigned",
    "terminated",
    "absconded",
)
STAGES = {
    "pre-construction": "pre_construction", "pre construction": "pre_construction",
    "under construction": "active", "ongoing": "active", "ongoing-overhead": "active",
    "handover": "handover", "completed": "completed", "on hold": "on_hold",
}  # fmt: skip
ISSUE_LIMIT = 40
NOT_JOINED = ("offer_issued", "documents_cleared")  # these people are on the Mobilization board
# A person on offer often has no company ID yet; the sheet shows "?" (the same one for every empty position).
NO_ID = {"", "?", "-", "--", "na", "n/a", "tba", "tbc", "0"}


def _key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = _clean(value)
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw, pattern).date()
        except ValueError:
            continue
    return None


def map_status(raw: Any) -> str:
    """One of PERSON_STATUSES, 'vacancy', 'transfer_out', 'transfer_in', or 'unknown'."""
    word = _clean(raw).lower()
    if not word:
        return "unknown"
    if "transfer out" in word:
        return "transfer_out"
    if "transfer in" in word:
        return "transfer_in"
    if "abscond" in word:
        return "absconded"
    if "terminat" in word:
        return "terminated"
    if "resign" in word or word.startswith("exit"):
        return "resigned"
    if "arrived" in word:
        return "documents_cleared"
    if "offer" in word or "visa" in word:
        return "offer_issued"
    if "vacation" in word or "leave" in word:
        return "on_leave"
    if word.startswith("active") or word == "existing":
        return "active"
    if any(w in word for w in ("future", "recruit", "interview", "requirement", "tba")):
        return "vacancy"
    return "unknown"


def split_uaen(designation: str) -> tuple[str, bool]:
    """('Administration Officer', True) from 'Administration Officer - UAEN'."""
    found = re.search(r"\s*[-–(]?\s*UAEN\)?\s*$", designation, re.IGNORECASE)
    if found:
        return designation[: found.start()].strip(" -–("), True
    return designation, False


@dataclass
class Person:
    code: str
    name: str
    project: str
    trade: str
    status: str
    discipline: str | None
    uae: bool
    joined_on: date | None
    exit_on: date | None
    phone: str | None
    email: str | None
    source: str | None
    note: str | None
    expected_join_on: date | None = None  # for people not yet joined: the date in the sheet


@dataclass
class Plan:
    planned: int = 0
    needed_by: date | None = None
    sources: Counter[str] = field(default_factory=lambda: Counter())
    discipline: str | None = None


@dataclass
class ParsedProject:
    code: str
    name: str
    stage: str
    kind: str
    starts_on: date | None
    ends_on: date | None


@dataclass
class Parsed:
    kind: Kind
    rows: int = 0
    projects: list[ParsedProject] = field(default_factory=lambda: [])
    people: list[Person] = field(default_factory=lambda: [])
    plan: dict[tuple[str, str, bool], Plan] = field(default_factory=lambda: {})
    designations: dict[str, str | None] = field(default_factory=lambda: {})  # name -> discipline
    status_counts: Counter[str] = field(default_factory=lambda: Counter())
    transfers_out: int = 0
    transfers_in: int = 0
    issues: list[str] = field(default_factory=lambda: [])
    issue_count: int = 0

    def issue(self, message: str) -> None:
        self.issue_count += 1
        if len(self.issues) < ISSUE_LIMIT:
            self.issues.append(message)


class TrackerError(ValueError):
    """The file cannot be read as the tracker it should be. Worded for HR."""


def _table(
    workbook: Any, sheet: str, id_headers: tuple[str, ...]
) -> tuple[list[str], list[tuple[Any, ...]]]:
    if sheet not in workbook.sheetnames:
        raise TrackerError(f"The workbook has no {sheet} sheet.")
    data = list(workbook[sheet].iter_rows(values_only=True))
    for index, row in enumerate(data[:15]):
        if any(_key(c) in id_headers for c in row):
            return [_key(c) for c in row], data[index + 1 :]
    raise TrackerError(f"Could not find the header row in {sheet}.")


def _col(head: list[str], *names: str) -> int | None:
    for name in names:
        if name in head:
            return head.index(name)
    return None


def parse_workbook(content: bytes, kind: Kind) -> Parsed:
    if content[:2] != b"PK":
        raise TrackerError("That is not an Excel (.xlsx) file.")
    try:
        book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as error:  # noqa: BLE001 - any reader failure is "not a workbook"
        raise TrackerError("That file could not be read as an Excel workbook.") from error
    parsed = Parsed(kind=kind)
    parsed.projects = _projects(book, parsed)
    by_name = {_key(p.name): p for p in parsed.projects}

    head, rows = _table(book, SHEETS[kind], ("labourid", "staffid", "employeeid", "id"))
    c = {
        "id": _col(head, "labourid", "staffid", "employeeid", "id"),
        "name": _col(head, "labourname", "employeename", "name"),
        "project": _col(head, "projectname", "project"),
        "trade": _col(head, "designation", "trade")
        if kind == "staff"
        else _col(head, "trade", "designation"),
        "disc": _col(head, "disciplinedept", "tradegroupauto", "discipline", "tradegroup"),
        "status": _col(head, "labourstatus", "employmentstatus", "status"),
        "source": _col(head, "recrutimentlocaloverseas", "recruitmentlocaloverseas"),
        "nat": _col(head, "nationality"),
        "joined": _col(head, "dateofjoining"),
        "exit": _col(head, "exitdaterequiredby"),
        "remarks": _col(head, "remarks"),
        "phone": _col(head, "contactno"),
        "email": _col(head, "email"),
    }
    if c["project"] is None or c["trade"] is None or c["status"] is None:
        raise TrackerError(
            f"{SHEETS[kind]} needs Project Name, Trade or Designation, and Status columns."
        )

    def cell(row: tuple[Any, ...], key: str) -> Any:
        index = c[key]
        return row[index] if index is not None and index < len(row) else None

    # Cost centres named in the rows but not in the Projects sheet (camp, multiple projects) become
    # non-construction groups, so their people are not lost and are not counted as a project.
    p_index = c["project"]
    for name in sorted(
        {_clean(r[p_index]) for r in rows if p_index < len(r) and _clean(r[p_index])}
    ):
        if _key(name) not in by_name:
            extra = ParsedProject(
                re.sub(r"[^A-Z0-9]+", "", name.upper())[:8] or "OTHER",
                name,
                "active",
                "head_office",
                None,
                None,
            )
            parsed.projects.append(extra)
            by_name[_key(name)] = extra
            parsed.issue(
                f"“{name}” is not in the Projects sheet; created as a group outside construction"
            )

    seen: set[str] = set()
    spelling: dict[
        str, str
    ] = {}  # "steel fixer" -> the first spelling seen, so variants are one role
    no_id = 0
    blank_status = 0
    for position, row in enumerate(rows, start=1):
        if not any(v not in (None, "") for v in row[:12]):
            continue
        parsed.rows += 1
        code = _clean(cell(row, "id"))
        project = by_name.get(_key(cell(row, "project")))
        designation, uae = split_uaen(_clean(cell(row, "trade")))
        designation = spelling.setdefault(designation.lower(), designation)
        status = map_status(cell(row, "status"))
        name = _clean(cell(row, "name"))
        if not _clean(cell(row, "status")) and name and name.lower() not in BLANK_NAMES:
            # A named person with no status yet is on the way: they go to Mobilization as offer issued.
            status = "offer_issued"
            blank_status += 1
        if project is None or not designation or status == "unknown":
            reason = (
                f"project “{_clean(cell(row, 'project'))}” is not in the Projects sheet" if project is None
                else "no designation" if not designation
                else f"unknown status “{_clean(cell(row, 'status'))}”"
            )  # fmt: skip
            parsed.issue(f"{code or 'row ' + str(position)}: {reason}; skipped")
            continue
        uae = uae or "uae" in _clean(cell(row, "nat")).lower()
        discipline = _clean(cell(row, "disc")) or None
        parsed.designations.setdefault(designation, discipline)
        parsed.status_counts[status] += 1
        needed = _date(cell(row, "exit"))
        source = _clean(cell(row, "source")).lower()
        source = source if source in ("local", "overseas") else ""

        if status not in ("resigned", "terminated", "absconded"):
            plan = parsed.plan.setdefault((project.code, designation, uae), Plan())
            plan.planned += 1
            plan.discipline = plan.discipline or discipline
            if status in ("vacancy", "transfer_in"):
                if needed and (plan.needed_by is None or needed < plan.needed_by):
                    plan.needed_by = needed
                if source:
                    plan.sources[source] += 1
        if status == "transfer_in":
            parsed.transfers_in += 1
            continue
        if status == "vacancy" or name.lower() in BLANK_NAMES:
            if status != "vacancy":
                parsed.issue(
                    f"{code}: {status.replace('_', ' ')} but no name; counted as a vacancy"
                )
            continue
        if code.lower() in NO_ID or not re.fullmatch(r"[A-Za-z0-9._/-]+", code):
            # Stable across re-runs, so importing again matches the same person.
            digest = hashlib.sha1(f"{kind}|{name}|{project.code}".encode()).hexdigest()  # noqa: S324
            code = f"NEW-{digest[:8].upper()}"
            no_id += 1
        if code in seen:
            parsed.issue(f"{code}: appears twice; the first row is kept")
            continue
        seen.add(code)
        if status == "transfer_out":
            parsed.transfers_out += 1
        phone = _clean(cell(row, "phone")) or None
        note = " · ".join(
            x for x in (_clean(cell(row, "remarks")), "transfer out planned" if status == "transfer_out" else "") if x
        ) or None  # fmt: skip
        parsed.people.append(
            Person(
                code=code,
                name=name,
                project=project.code,
                trade=designation,
                status="active" if status == "transfer_out" else status,
                discipline=discipline,
                uae=uae,
                joined_on=None if status in NOT_JOINED else _date(cell(row, "joined")),
                expected_join_on=_date(cell(row, "joined")) if status in NOT_JOINED else None,
                exit_on=needed if status in ("resigned", "terminated", "absconded") else None,
                phone=phone,
                email=_clean(cell(row, "email")).lower() or None,
                source=source or None,
                note=note,
            )  # fmt: skip
        )
    if blank_status:
        parsed.issue(
            f"{blank_status} named people had no status; they were put in Mobilization as offer issued"
        )
    if no_id:
        parsed.issue(f"{no_id} people have no company ID yet; each was given a temporary NEW- code")
    return parsed


def _projects(book: Any, parsed: Parsed) -> list[ParsedProject]:
    head, rows = _table(book, "Projects", ("projectcode", "sitecode", "code"))
    code_i = _col(head, "projectcode", "sitecode", "code")
    name_i = _col(head, "projectname", "name")
    stage_i = _col(head, "projectstatus", "status")
    start_i = _col(head, "startdate")
    end_i = _col(head, "plannedcompletion", "enddate")
    out: list[ParsedProject] = []
    for row in rows:
        name = _clean(row[name_i]) if name_i is not None else ""
        code = _clean(row[code_i]).upper() if code_i is not None else ""
        if not name or not code:
            continue
        raw_stage = _clean(row[stage_i]).lower() if stage_i is not None else ""
        stage = STAGES.get(raw_stage)
        if stage is None:
            parsed.issue(
                f"project {name}: unknown stage “{raw_stage}”; treated as under construction"
            )
            stage = "active"
        out.append(
            ParsedProject(
                code=code,
                name=name,
                stage=stage,
                kind="head_office"
                if "overhead" in raw_stage or name.lower() == "head office"
                else "project",
                starts_on=_date(row[start_i]) if start_i is not None else None,
                ends_on=_date(row[end_i]) if end_i is not None else None,
            )  # fmt: skip
        )
    return out


def summary(parsed: Parsed, applied: bool) -> dict[str, Any]:
    by_status = {k: v for k, v in sorted(parsed.status_counts.items())}
    return {
        "kind": parsed.kind,
        "applied": applied,
        "rows": parsed.rows,
        "projects": [
            {
                "code": p.code,
                "name": p.name,
                "stage": p.stage,
                "head_office": p.kind == "head_office",
            }
            for p in parsed.projects
        ],
        "people": len(parsed.people),
        "by_status": by_status,
        "vacancies": by_status.get("vacancy", 0) + by_status.get("transfer_in", 0),
        "plan_lines": len(parsed.plan),
        "planned_total": sum(p.planned for p in parsed.plan.values()),
        "uae_only_lines": sum(1 for (_, _, uae) in parsed.plan if uae),
        "designations": len(parsed.designations),
        "transfers_noted": parsed.transfers_out + parsed.transfers_in,
        "issue_count": parsed.issue_count,
        "issues": parsed.issues,
    }


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "role"


def apply(session: Session, parsed: Parsed, actor_id: Any = None) -> dict[str, int]:
    """Write the parsed tracker. The caller commits."""
    project_ids: dict[str, Any] = {}
    for p in parsed.projects:
        same = session.execute(
            text("SELECT id FROM projects WHERE lower(name) = lower(:name) AND NOT is_demo"),
            {"name": p.name},
        ).first()
        if same is not None:
            session.execute(
                text(
                    """UPDATE projects SET starts_on = COALESCE(starts_on, :s),
                              ends_on = COALESCE(ends_on, :e) WHERE id = :id"""
                ),
                {"id": same.id, "s": p.starts_on, "e": p.ends_on},
            )
            project_ids[p.code] = same.id
            continue
        row = session.execute(
            text(
                """INSERT INTO projects (code, name, status, kind, starts_on, ends_on, is_demo)
                   VALUES (:code, :name, CAST(:stage AS project_status), :kind, :s, :e, false)
                   ON CONFLICT (code) DO UPDATE
                      SET name = EXCLUDED.name,
                          starts_on = COALESCE(projects.starts_on, EXCLUDED.starts_on),
                          ends_on = COALESCE(projects.ends_on, EXCLUDED.ends_on)
                   RETURNING id"""
            ),
            {
                "code": p.code,
                "name": p.name,
                "stage": p.stage,
                "kind": p.kind,
                "s": p.starts_on,
                "e": p.ends_on,
            },
        ).one()
        project_ids[p.code] = row.id

    existing = {
        (r["kind"], _clean(r["name"]).lower()): (r["id"], r["code"])
        for r in session.execute(text("SELECT id, code, name, kind FROM trades")).mappings()
    }
    codes = {c for _, c in existing.values()}
    trade_ids: dict[str, Any] = {}
    for name, discipline in parsed.designations.items():
        found = existing.get((parsed.kind, name.lower()))
        if found is None:
            code = _slug(name)
            if code in codes:
                code = f"{code}_{parsed.kind}"
            row = session.execute(
                text(
                    """INSERT INTO trades (code, name, kind, department, category)
                       VALUES (:code, :name, :kind, :dept, :category) RETURNING id"""
                ),
                {"code": code, "name": name, "kind": parsed.kind, "dept": discipline,
                 "category": "Staff" if parsed.kind == "staff" else discipline},
            ).one()  # fmt: skip
            codes.add(code)
            found = (row.id, code)
            existing[(parsed.kind, name.lower())] = found
        trade_ids[name] = found[0]

    for (project, designation, uae), plan in parsed.plan.items():
        session.execute(
            text(
                """INSERT INTO plan_lines
                       (project_id, trade_id, discipline, planned, needed_by, uae_national_only, source)
                   VALUES (:p, :t, :d, :n, :by, :uae, :src)
                   ON CONFLICT (project_id, trade_id, uae_national_only) DO UPDATE
                      SET planned = EXCLUDED.planned, needed_by = EXCLUDED.needed_by,
                          source = EXCLUDED.source, discipline = EXCLUDED.discipline, updated_at = now()"""
            ),
            {"p": project_ids[project], "t": trade_ids[designation], "d": plan.discipline,
             "n": plan.planned, "by": plan.needed_by, "uae": uae,
             "src": plan.sources.most_common(1)[0][0] if plan.sources else None},
        )  # fmt: skip

    for person in parsed.people:
        session.execute(
            text(
                """INSERT INTO employees
                       (employee_code, full_name, phone, email, primary_trade_id, project_id, discipline,
                        employment_status, availability, joined_on, expected_join_on, exit_on, source,
                        uae_national, note, is_demo)
                   VALUES (:code, :name, :phone, :email, :trade, :project, :disc,
                           CAST(:status AS employment_status), CAST(:availability AS availability_state),
                           :joined, :expected, :exit, :src, :uae, :note, false)
                   ON CONFLICT (employee_code) DO UPDATE
                      SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, email = EXCLUDED.email,
                          primary_trade_id = EXCLUDED.primary_trade_id, project_id = EXCLUDED.project_id,
                          discipline = EXCLUDED.discipline,
                          employment_status = EXCLUDED.employment_status,
                          availability = EXCLUDED.availability, joined_on = EXCLUDED.joined_on,
                          expected_join_on = EXCLUDED.expected_join_on,
                          exit_on = EXCLUDED.exit_on, source = EXCLUDED.source,
                          uae_national = EXCLUDED.uae_national, note = EXCLUDED.note,
                          updated_at = now()"""
            ),
            {"code": person.code, "name": person.name, "phone": person.phone, "email": person.email,
             "trade": trade_ids[person.trade], "project": project_ids[person.project],
             "disc": person.discipline, "status": person.status,
             "availability": "deployed" if person.status in ("active", "on_leave") else "available",
             "joined": person.joined_on, "expected": person.expected_join_on, "exit": person.exit_on, "src": person.source,
             "uae": person.uae, "note": person.note},
        )  # fmt: skip
    session.execute(
        text(
            """INSERT INTO workforce_events (kind, decided_by, reason, actor_id)
               VALUES ('imported', 'hr', :reason, :actor)"""
        ),
        {"reason": f"Imported the {parsed.kind} tracker: {len(parsed.people)} people, "
                   f"{len(parsed.plan)} planned lines", "actor": actor_id},
    )  # fmt: skip
    return {
        "people": len(parsed.people),
        "plan_lines": len(parsed.plan),
        "projects": len(parsed.projects),
    }


# Public names for the helpers the employee-list import shares with this module.
clean = _clean
key = _key
to_date = _date
slug = _slug
