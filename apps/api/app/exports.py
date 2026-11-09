"""Spreadsheet downloads. One place, so every export is safe in the same way."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence

from fastapi import Response


def csv_cell(value: object) -> str:
    """One spreadsheet cell. A leading = + - @ would run as a formula in Excel, so it is defused."""
    if value is None:
        return ""
    cell = str(value)
    return f"'{cell}" if cell[:1] in ("=", "+", "-", "@") else cell


def csv_download(
    filename: str, header: Sequence[str], rows: Iterable[Sequence[object]]
) -> Response:
    """A CSV Excel opens correctly (UTF-8 with a byte-order mark), every cell made formula-safe."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow([csv_cell(v) for v in row])
    return Response(
        content="\ufeff" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def xlsx_bytes(sheets: Sequence[tuple[str, Sequence[str], Iterable[Sequence[object]]]]) -> bytes:
    """An Excel file: one sheet per (title, header, rows). Bold frozen header, readable widths,
    real dates, and every text cell made formula-safe like the CSV downloads."""
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    book = Workbook()
    for n, (title, header, rows) in enumerate(sheets):
        sheet = book.active if n == 0 else book.create_sheet()
        assert sheet is not None
        sheet.title = title[:31]
        sheet.append(list(header))
        body = [[v if not isinstance(v, str) else csv_cell(v) for v in row] for row in rows]
        widths = [len(h) for h in header]
        for row in body:
            sheet.append(["" if v is None else v for v in row])
            for i, v in enumerate(row):
                size = len(str(v)) if v is not None else 0
                if i < len(widths):
                    widths[i] = max(widths[i], size)
                else:
                    widths.append(size)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        sheet.freeze_panes = "A2"
        for i, width in enumerate(widths, start=1):
            sheet.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 10), 48)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def xlsx_download(
    filename: str, sheets: Sequence[tuple[str, Sequence[str], Iterable[Sequence[object]]]]
) -> Response:
    return Response(
        content=xlsx_bytes(sheets),
        media_type=XLSX_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
