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
