# ruff: noqa: E501
"""Fictional demo files for the employee-list import (no real person is in them).

`new` adds ten people, staff and labour mixed in one sheet (the import sorts them), one with no
status (goes to Mobilization) and one with no project (the AI places them). Import it, then import
`changes` to see the rest: people who are already there are ignored, and the doubtful rows are asked
about (a transfer, another employee, or a mistake).
"""

from __future__ import annotations

import io
from datetime import date
from typing import Any, Literal

from openpyxl import Workbook
from openpyxl.styles import Font

HEAD = [
    "Company ID", "Full name", "Designation", "Category", "Department", "Project", "Status",
    "Expected joining date", "Joining date", "Phone", "Email", "UAE national", "Recruited",
]  # fmt: skip

NEW: list[list[Any]] = [
    ["DEMO-L-001", "Rahim Demo", "Steel Fixer", "Labour", None, "Greens", "Offer issued", date(2026, 12, 1), None, None, None, "No", "Overseas"],
    ["DEMO-L-002", "Sabir Demo", "Steel Fixer", "Labour", None, "Greens", "Documents cleared", date(2026, 11, 28), None, None, None, "No", "Overseas"],
    ["DEMO-L-003", "Tariq Demo", "Helper", "Labour", None, "Marina Waterfront", "Joined", None, date(2026, 11, 2), None, None, "No", "Local"],
    ["DEMO-L-004", "Umar Demo", "Electrician", "Labour", None, "Rak Court", "Offer issued", date(2026, 12, 5), None, None, None, "No", "Local"],
    ["DEMO-L-005", "Vikash Demo", "Plumber", "Labour", None, "Saij", None, None, None, None, None, "No", "Overseas"],
    ["DEMO-L-006", "Wasim Demo", "Helper", "Labour", None, None, "Offer issued", date(2026, 12, 12), None, None, None, "No", "Overseas"],
    ["DEMO-S-001", "Yasmin Demo", "Site Engineer", "Staff", "Construction", "Marina Waterfront", "Offer issued", date(2026, 12, 10), None, None, "yasmin.demo@example.test", "No", "Local"],
    ["DEMO-S-002", "Zaid Demo", "Document Controller", "Staff", "QHSE", "Greens", "Documents cleared", date(2026, 11, 30), None, None, "zaid.demo@example.test", "No", "Local"],
    ["DEMO-S-003", "Amal Demo", "Admin Officer", "Staff", "Admin", "Aila Homes", "Offer issued", date(2027, 1, 4), None, None, "amal.demo@example.test", "Yes", "Local"],
    ["DEMO-S-004", "Basil Demo", "Quantity Surveyor", "Staff", "Quantity Surveying", "Marina Waterfront", "Joined", None, date(2026, 10, 15), None, "basil.demo@example.test", "No", "Local"],
]  # fmt: skip

CHANGES: list[list[Any]] = [
    # exactly as already in the system: ignored
    ["DEMO-L-001", "Rahim Demo", "Steel Fixer", "Labour", None, "Greens", "Offer issued", date(2026, 12, 1), None, None, None, "No", "Overseas"],
    ["DEMO-L-003", "Tariq Demo", "Helper", "Labour", None, "Marina Waterfront", "Joined", None, date(2026, 11, 2), None, None, "No", "Local"],
    # no company ID, same name and place: the same person again, ignored
    [None, "Zaid Demo", "Document Controller", "Staff", "QHSE", "Greens", "Documents cleared", None, None, None, None, "No", "Local"],
    # same ID, another project: transfer, another employee, or a mistake?
    ["DEMO-S-001", "Yasmin Demo", "Site Engineer", "Staff", "Construction", "Aila Homes", "Offer issued", date(2026, 12, 10), None, None, None, "No", "Local"],
    # same ID and place, but now joined: update, another employee, or a mistake?
    ["DEMO-L-002", "Sabir Demo", "Steel Fixer", "Labour", None, "Greens", "Joined", None, date(2026, 11, 20), None, None, "No", "Overseas"],
    # the ID belongs to someone with another name
    ["DEMO-L-004", "Umar Different", "Electrician", "Labour", None, "Rak Court", "Offer issued", None, None, None, None, "No", "Local"],
    # no ID, same name as Basil but another project
    [None, "Basil Demo", "Quantity Surveyor", "Staff", "Quantity Surveying", "Aila Homes", "Offer issued", date(2026, 12, 20), None, None, None, "No", "Local"],
    # genuinely new
    ["DEMO-L-007", "Newman Demo", "Helper", "Labour", None, "Marina Waterfront", "Offer issued", date(2026, 12, 15), None, None, None, "No", "Local"],
]  # fmt: skip


def sample_xlsx(which: Literal["new", "changes"]) -> bytes:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.title = "Employees"
    sheet.append(HEAD)
    for row in NEW if which == "new" else CHANGES:
        sheet.append(row)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    sheet.freeze_panes = "A2"
    for i, width in enumerate([14, 20, 22, 10, 20, 20, 18, 22, 14, 14, 26, 13, 11], start=1):
        sheet.column_dimensions[chr(64 + i)].width = width
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()
