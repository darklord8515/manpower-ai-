# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false
# ruff: noqa: E501
"""Add people from an Excel list, sorting them into staff and labour and asking HR about doubts.

One sheet, one row per person: company ID, name, designation, project, status and a few details.
(Rules EMPLOYEE_IMPORT_*, see docs/rules.md.)
- Staff and labour are told apart per row, never by which button HR pressed: by the role if it is known
  (a staff role goes to Staff), else by the Category column, else labour. A staff list imported by
  mistake therefore still lands in Staff.
- Someone who is already in the system with the same details is ignored: no duplicate is made.
- If the same person turns up with a different project or role, or with different details, or the
  company ID belongs to someone with another name, nothing is guessed. The preview asks HR, in plain
  words, whether it is a transfer, another employee, or a mistake, and applies only what HR answered.
- A row with no project is placed by "let AI decide" (real projects only). A row with no status is an
  offer issued, so it appears on the Mobilization board.
Preview and apply read the same file, so a conflict is identified by its row number.
"""

from __future__ import annotations

import base64
import binascii
import io
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import openpyxl
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import headcount, tracker_import, workforce

MAX_BYTES = 5 * 1024 * 1024
SYNONYMS: dict[str, tuple[str, ...]] = {
    "code": ("companyid", "employeeid", "staffid", "labourid", "id", "code", "employeecode"),
    "name": ("fullname", "name", "employeename", "labourname", "staffname"),
    "designation": ("designation", "trade", "role", "position", "jobtitle"),
    "category": ("category", "type", "staffoflabour", "stafflabour"),
    "department": ("department", "disciplinedept", "discipline", "dept"),
    "project": ("project", "projectname", "site"),
    "status": ("status", "employmentstatus", "labourstatus", "mobilizationstatus", "step"),
    "expected": ("expectedjoiningdate", "expectedjoindate", "expectedtojoin"),
    "joined": ("joiningdate", "dateofjoining", "joineddate", "joinedon"),
    "phone": ("phone", "contactno", "mobile", "phonenumber"),
    "email": ("email", "emailaddress"),
    "uae": ("uaenational", "uaen", "emirati", "nationality"),
    "source": ("recruited", "recruitment", "source", "recrutimentlocaloverseas"),
}
STATUS_WORD = {
    "offer_issued": "Offer issued", "documents_cleared": "Documents cleared", "active": "Joined",
    "on_leave": "On leave", "resigned": "Resigned",
}  # fmt: skip
STEP_CLASS = {"active": "active", "on_leave": "active", "suspended": "active"}


class ImportFileError(ValueError):
    """The file cannot be read as a list of people. Worded for HR."""


@dataclass
class Row:
    n: int  # the row's number among the data rows, as HR sees it counting from the first person
    code: str | None
    name: str
    designation: str
    kind_hint: str | None
    department: str | None
    project: Any  # the matched project row, or None (AI decides)
    project_text: str
    status: str | None  # None = blank in the file
    expected_on: date | None
    joined_on: date | None
    phone: str | None
    email: str | None
    uae: bool
    source: str | None


@dataclass
class Conflict:
    row: int
    kind: str  # moved | details | id_clash
    person_code: str
    person_name: str
    question: str
    options: list[dict[str, str]]


@dataclass
class Analysis:
    rows: list[Row] = field(default_factory=lambda: [])
    new: list[int] = field(default_factory=lambda: [])  # row numbers to add
    unchanged: list[int] = field(default_factory=lambda: [])
    conflicts: list[Conflict] = field(default_factory=lambda: [])
    issues: list[str] = field(default_factory=lambda: [])
    new_roles: list[str] = field(default_factory=lambda: [])
    by_kind: dict[str, int] = field(default_factory=lambda: {"staff": 0, "labour": 0})
    ai_placed: int = 0
    overflow: list[dict[str, Any]] = field(default_factory=lambda: [])


def decode(file_b64: str) -> bytes:
    try:
        content = base64.b64decode(file_b64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ImportFileError("The file could not be read. Choose the .xlsx again.") from error
    if not content:
        raise ImportFileError("Choose an Excel file to import.")
    if len(content) > MAX_BYTES:
        raise ImportFileError("The file is too big. Use one under 5 MB.")
    if content[:2] != b"PK":
        raise ImportFileError("That is not an Excel (.xlsx) file.")
    return content


def _read(content: bytes) -> list[dict[str, Any]]:
    try:
        book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as error:  # noqa: BLE001 - any reader failure is "not a workbook"
        raise ImportFileError("That file could not be read as an Excel workbook.") from error
    sheet = book["Employees"] if "Employees" in book.sheetnames else book.worksheets[0]
    data = list(sheet.iter_rows(values_only=True))
    for index, row in enumerate(data[:15]):
        keys = [tracker_import.key(c) for c in row]
        if any(k in SYNONYMS["name"] for k in keys) and any(
            k in SYNONYMS["designation"] for k in keys
        ):
            columns = {
                field_: next((i for i, k in enumerate(keys) if k in names), None)
                for field_, names in SYNONYMS.items()
            }
            out: list[dict[str, Any]] = []
            for r in data[index + 1 :]:
                if any(v not in (None, "") for v in r):
                    out.append(
                        {
                            f: (r[i] if i is not None and i < len(r) else None)
                            for f, i in columns.items()
                        }
                    )
            return out
    raise ImportFileError(
        "Could not find the headings. The sheet needs at least Full name and Designation."
    )


def _status(raw: Any) -> str | None:
    word = tracker_import.clean(raw).lower()
    if not word:
        return None
    if word in ("joined", "joined the company", "working"):
        return "active"
    if word in ("documents cleared", "docs cleared", "cleared"):
        return "documents_cleared"
    mapped = tracker_import.map_status(word)
    return mapped if mapped in STATUS_WORD or mapped in ("terminated", "absconded") else "unknown"


def _yes(raw: Any) -> bool:
    return (
        tracker_import.clean(raw).lower()
        in ("y", "yes", "true", "1", "uae", "uae national", "emirati")
        or "uae" in tracker_import.clean(raw).lower()
    )


def _clean_code(raw: Any) -> str | None:
    code = tracker_import.clean(raw)
    if (
        code.lower() in tracker_import.NO_ID
        or not code.replace("-", "").replace(".", "").replace("_", "").replace("/", "").isalnum()
    ):
        return None
    return code[:30]


def _where(person: Any) -> str:
    return f"{person['designation']} on {person['project_name'] or 'no project'} ({STATUS_WORD.get(person['status'], person['status'])})"


def analyse(session: Session, content: bytes) -> Analysis:
    """Read the file and sort every row: new, unchanged, a question for HR, or a problem."""
    result = Analysis()
    raw_rows = _read(content)
    projects = {
        **{
            tracker_import.key(r["name"]): r
            for r in session.execute(
                text("SELECT id, code, name, kind, status::text AS stage FROM projects")
            ).mappings()
        },
    }
    projects.update({tracker_import.key(p["code"]): p for p in list(projects.values())})
    trades: dict[str, list[Any]] = {}
    for t in session.execute(text("SELECT id, name, kind, department FROM trades")).mappings():
        trades.setdefault(t["name"].lower(), []).append(t)
    people = (
        session.execute(
            text(
                """SELECT e.id, e.employee_code AS code, e.full_name AS name, e.project_id, p.code AS project_code,
                      p.name AS project_name, e.primary_trade_id AS trade_id, t.name AS designation,
                      e.employment_status::text AS status
               FROM employees e JOIN trades t ON t.id = e.primary_trade_id
               LEFT JOIN projects p ON p.id = e.project_id"""
            )
        )
        .mappings()
        .all()
    )
    by_code = {p["code"]: p for p in people}
    by_name: dict[str, list[Any]] = {}
    for p in people:
        by_name.setdefault(" ".join(p["name"].lower().split()), []).append(p)

    seen_new: set[tuple[str, str, str]] = set()
    incoming: dict[tuple[Any, Any, bool], int] = {}
    for n, r in enumerate(raw_rows, start=1):
        name = " ".join(tracker_import.clean(r["name"]).split())
        designation = tracker_import.split_uaen(tracker_import.clean(r["designation"]))
        role, uae_role = designation
        if not name or not role:
            result.issues.append(f"Row {n}: needs a name and a designation; skipped")
            continue
        status = _status(r["status"])
        if status == "unknown":
            result.issues.append(
                f"Row {n} ({name}): unknown status “{tracker_import.clean(r['status'])}”; skipped"
            )
            continue
        if status in ("resigned", "terminated", "absconded"):
            result.issues.append(f"Row {n} ({name}): people who have left are not added; skipped")
            continue
        project_text = tracker_import.clean(r["project"])
        project = projects.get(tracker_import.key(project_text)) if project_text else None
        if project_text and project is None:
            result.issues.append(
                f"Row {n} ({name}): project “{project_text}” is not known; skipped"
            )
            continue
        category = tracker_import.clean(r["category"]).lower()
        hint = (
            "staff"
            if category.startswith("staff")
            else "labour"
            if category.startswith("lab")
            else None
        )
        found = trades.get(role.lower())
        row = Row(
            n=n,
            code=_clean_code(r["code"]),
            name=name,
            designation=role,
            kind_hint=hint,
            department=tracker_import.clean(r["department"]) or None,
            project=project,
            project_text=project_text,
            status=status,
            expected_on=tracker_import.to_date(r["expected"]),
            joined_on=tracker_import.to_date(r["joined"]),
            phone=tracker_import.clean(r["phone"]) or None,
            email=tracker_import.clean(r["email"]).lower() or None,
            uae=uae_role or _yes(r["uae"]),
            source=(tracker_import.clean(r["source"]).lower() or None)
            if tracker_import.clean(r["source"]).lower() in ("local", "overseas")
            else None,
        )
        result.rows.append(row)
        kind = (found[0]["kind"] if found else None) or hint or "labour"
        if found is None and role not in result.new_roles:
            result.new_roles.append(role)

        match = None
        if row.code and row.code in by_code:
            match = by_code[row.code]
            if " ".join(match["name"].lower().split()) != name.lower():
                result.conflicts.append(_clash(row, match))
                continue
        elif named := by_name.get(name.lower()):
            match = named[0]
            for m in named:
                if (project is None or m["project_id"] == project["id"]) and m[
                    "designation"
                ].lower() == role.lower():
                    match = m
                    break
        if match is not None:
            same_place = (
                project is None or match["project_id"] == (project["id"] if project else None)
            ) and match["designation"].lower() == role.lower()
            same_step = row.status is None or STEP_CLASS.get(
                match["status"], match["status"]
            ) == STEP_CLASS.get(row.status, row.status)
            if same_place and same_step:
                result.unchanged.append(n)
            elif not same_place:
                result.conflicts.append(_moved(row, match, project))
            else:
                result.conflicts.append(_details(row, match))
            continue

        key = (name.lower(), role.lower(), project_text.lower())
        if key in seen_new:
            result.unchanged.append(n)  # the same person twice in the file: once is enough
            continue
        seen_new.add(key)
        result.new.append(n)
        result.by_kind[kind] += 1
        if project is None:
            result.ai_placed += 1
        elif found:
            line_key = (project["id"], found[0]["id"], row.uae)
            incoming[line_key] = incoming.get(line_key, 0) + 1

    # Which project lines would be over their plan if everyone new were added.
    if incoming:
        lines = {(r.project_id, r.trade_id, r.uae_only): r for r in headcount.lines(session)}
        for (pid, tid, uae), count in incoming.items():
            line = lines.get((pid, tid, uae)) or lines.get((pid, tid, False))
            planned = line.planned if line else 0
            now = (line.active + line.pipeline) if line else 0
            if now + count > planned:
                name_p = next((p["name"] for p in projects.values() if p["id"] == pid), "")
                role_p = (
                    line.label
                    if line
                    else next((t[0]["name"] for t in trades.values() if t[0]["id"] == tid), "")
                )
                result.overflow.append(
                    {
                        "project": name_p,
                        "designation": role_p,
                        "planned": planned,
                        "now": now,
                        "after": now + count,
                    }
                )
    return result


def _clash(row: Row, match: Any) -> Conflict:
    return Conflict(
        row.n,
        "id_clash",
        match["code"],
        match["name"],
        f"Company ID {match['code']} already belongs to {match['name']} ({_where(match)}), but the file gives it to {row.name}. What is this?",
        [
            {"id": "another", "label": f"{row.name} is another person: add them with a new ID"},
            {"id": "update", "label": f"It is the same person: correct the name to {row.name}"},
            {"id": "ignore", "label": "It is a mistake: ignore this row"},
        ],
    )


def _moved(row: Row, match: Any, project: Any) -> Conflict:
    target = project["name"] if project else "another project"
    return Conflict(
        row.n,
        "moved",
        match["code"],
        match["name"],
        f"{match['name']} is already here as {_where(match)}. The file puts them on {target} as {row.designation}. What is this?",
        [
            {
                "id": "transfer",
                "label": f"It is a transfer: move them to {target}"
                + (
                    f" as {row.designation}"
                    if row.designation.lower() != match["designation"].lower()
                    else ""
                ),
            },
            {
                "id": "another",
                "label": "It is another person with the same name: add them as a new employee",
            },
            {"id": "ignore", "label": "It is a mistake: ignore this row"},
        ],
    )


def _details(row: Row, match: Any) -> Conflict:
    now = STATUS_WORD.get(match["status"], match["status"])
    new = STATUS_WORD.get(row.status or "", row.status or "")
    return Conflict(
        row.n,
        "details",
        match["code"],
        match["name"],
        f"{match['name']} is already here as {_where(match)}. The file says {new}. What is this?",
        [
            {"id": "update", "label": f"Update them: change {now} to {new}"},
            {
                "id": "another",
                "label": "It is another person with the same name: add them as a new employee",
            },
            {"id": "ignore", "label": "It is a mistake: ignore this row"},
        ],
    )


def summary(a: Analysis, applied: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "rows": len(a.rows),
        "new": len(a.new),
        "new_staff": a.by_kind["staff"],
        "new_labour": a.by_kind["labour"],
        "unchanged": len(a.unchanged),
        "ai_placed": a.ai_placed,
        "new_roles": a.new_roles,
        "overflow": a.overflow,
        "conflicts": [
            {
                "row": c.row,
                "kind": c.kind,
                "person_code": c.person_code,
                "person_name": c.person_name,
                "question": c.question,
                "options": c.options,
            }
            for c in a.conflicts
        ],  # fmt: skip
        "issues": a.issues,
        "applied": applied,
    }


# ------------------------------------------------------------------------------------ apply


def _trade(session: Session, row: Row) -> Any:
    found = (
        session.execute(
            text(
                "SELECT id, name, kind, department FROM trades WHERE lower(name) = lower(:n) ORDER BY kind"
            ),
            {"n": row.designation},
        )
        .mappings()
        .first()
    )
    if found:
        return found
    kind = row.kind_hint or "labour"
    code = tracker_import.slug(row.designation)
    if session.execute(text("SELECT 1 FROM trades WHERE code = :c"), {"c": code}).first():
        code = f"{code}_{kind}"
    return (
        session.execute(
            text(
                """INSERT INTO trades (code, name, kind, department, category)
               VALUES (:c, :n, :k, :d, :cat) RETURNING id, name, kind, department"""
            ),
            {
                "c": code,
                "n": row.designation,
                "k": kind,
                "d": row.department,
                "cat": "Staff" if kind == "staff" else row.department,
            },
        )
        .mappings()
        .one()
    )


def _create(
    session: Session,
    actor: Any,
    row: Row,
    raise_plans: bool,
    out: dict[str, Any],
    code: str | None = None,
) -> None:
    trade = _trade(session, row)
    decided_by, reason, project = "hr", None, row.project
    if project is None:
        picked = workforce.auto_pick(session, trade, row.uae)
        if picked is None:
            out["skipped"].append(
                f"{row.name}: no open {row.designation} place on any project, so no project was chosen"
            )
            return
        line, reason = picked
        project, decided_by = (
            {"id": line.project_id, "code": line.project_code, "name": line.project_name},
            "ai",
        )
    else:
        line = workforce.line_for(session, project, trade, row.uae)
        if line.to_hire < 1 and raise_plans:
            workforce.raise_plan(session, line, actor)
            out["plans_raised"] += 1
    status = row.status or "offer_issued"
    expected = row.expected_on or (row.joined_on if status != "active" else None)
    employee_id = session.execute(
        text(
            """INSERT INTO employees
                   (employee_code, full_name, phone, email, primary_trade_id, project_id, discipline,
                    employment_status, availability, joined_on, expected_join_on, source, uae_national, is_demo)
               VALUES (:code, :name, :phone, :email, :trade, :project, :disc,
                       CAST(:status AS employment_status), CAST(:avail AS availability_state),
                       :joined, :expected, :src, :uae, false) RETURNING id"""
        ),
        {"code": code or row.code or workforce.new_code(row.name, trade["kind"]), "name": row.name,
         "phone": row.phone, "email": row.email, "trade": trade["id"], "project": project["id"],
         "disc": row.department or trade["department"], "status": status,
         "avail": "deployed" if status == "active" else "available",
         "joined": (row.joined_on or date.today()) if status == "active" else None,
         "expected": expected if status != "active" else None, "src": row.source, "uae": row.uae},
    ).scalar_one()  # fmt: skip
    workforce.log(
        session,
        "added",
        employee_id,
        None,
        project["id"],
        "hr",
        "Imported from an Excel list",
        actor,
    )
    workforce.log(
        session, "placed", employee_id, None, project["id"], decided_by,
        reason or f"From the Excel list: {project['name']}", actor,
    )  # fmt: skip
    out["created"][trade["kind"]] += 1
    if decided_by == "ai":
        out["ai_placed"] += 1


def apply(
    session: Session, actor: Any, a: Analysis, decisions: dict[str, str], raise_plans: bool
) -> dict[str, Any]:
    """Write what HR agreed to. Every question must be answered first."""
    allowed = {c.row: {o["id"] for o in c.options} for c in a.conflicts}
    unanswered = [r for r in allowed if decisions.get(str(r)) not in allowed[r]]
    if unanswered:
        raise workforce.WorkforceError(
            422, f"Answer every question first: {len(unanswered)} still need an answer."
        )
    out: dict[str, Any] = {
        "created": {"staff": 0, "labour": 0}, "unchanged": len(a.unchanged), "transferred": 0,
        "updated": 0, "ignored": 0, "another": 0, "plans_raised": 0, "ai_placed": 0,
        "skipped": [], "blocked": [],
    }  # fmt: skip
    by_row = {r.n: r for r in a.rows}
    for n in a.new:
        _create(session, actor, by_row[n], raise_plans, out)
    for c in a.conflicts:
        row, choice = by_row[c.row], decisions[str(c.row)]
        if choice == "ignore":
            out["ignored"] += 1
        elif choice == "another":
            _create(session, actor, row, raise_plans, out, code=workforce.new_code(row.name, "x"))
            out["another"] += 1
        elif choice == "transfer":
            trade = _trade(session, row)
            person = (
                session.execute(
                    text(
                        "SELECT id, primary_trade_id, project_id FROM employees WHERE employee_code = :c"
                    ),
                    {"c": c.person_code},
                )
                .mappings()
                .one()
            )
            if person["primary_trade_id"] != trade["id"]:
                session.execute(
                    text(
                        "UPDATE employees SET primary_trade_id = :t, discipline = :d WHERE id = :id"
                    ),
                    {
                        "t": trade["id"],
                        "d": row.department or trade["department"],
                        "id": person["id"],
                    },
                )
            if row.project is not None and row.project["id"] != person["project_id"]:
                try:
                    workforce.move(
                        session,
                        actor,
                        c.person_code,
                        row.project["code"],
                        "increase_plan" if raise_plans else None,
                    )
                except workforce.Overfilled as full:
                    out["blocked"].append(
                        f"{c.person_name}: {full.message} Tick “raise the plans” to allow it."
                    )
                    continue
            out["transferred"] += 1
        elif choice == "update":
            person_id = session.execute(
                text(
                    """UPDATE employees SET full_name = CASE WHEN :kind = 'id_clash' THEN :name ELSE full_name END,
                              employment_status = COALESCE(CAST(:status AS employment_status), employment_status),
                              expected_join_on = COALESCE(:expected, expected_join_on),
                              joined_on = CASE WHEN :status = 'active' THEN COALESCE(:joined, joined_on, current_date) ELSE joined_on END,
                              updated_at = now() WHERE employee_code = :code RETURNING id, project_id"""
                ),
                {"kind": c.kind, "name": row.name, "status": row.status, "expected": row.expected_on,
                 "joined": row.joined_on, "code": c.person_code},
            ).mappings().one()  # fmt: skip
            workforce.log(
                session,
                "joined"
                if row.status == "active"
                else "documents_cleared"
                if row.status == "documents_cleared"
                else "plan_changed",
                person_id["id"],
                person_id["project_id"],
                person_id["project_id"],
                "hr",
                f"{c.person_name}: details updated from the Excel list",
                actor,
            )
            out["updated"] += 1
    workforce.log(
        session,
        "imported",
        None,
        None,
        None,
        "hr",
        f"Imported an employee list: {sum(out['created'].values())} added, {out['transferred']} transferred, {out['updated']} updated, {out['unchanged']} unchanged",
        actor,
    )
    return out
