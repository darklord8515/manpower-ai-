"""Import the client's labour or staff tracker (Excel): a preview first, then the real thing.

HR sends the .xlsx as the raw request body. `apply=false` (the default) reads and reports and
changes nothing; `apply=true` writes projects, people and planned headcount in one
transaction. The cleaning rules are in services/tracker_import.py. Only HR (`employee:write`)
may import; the MD cannot.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, require
from app.db import get_session
from app.services import tracker_import

router = APIRouter(prefix="/imports", tags=["imports"])

SessionDep = Annotated[Session, Depends(get_session)]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]
MAX_BYTES = 10 * 1024 * 1024


@router.post("/trackers")
async def import_tracker(
    request: Request,
    session: SessionDep,
    user: Writer,
    kind: Annotated[Literal["labour", "staff"], Query()],
    apply: bool = False,
) -> dict[str, Any]:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "The file is too big. Use one under 10 MB.")
    content = await request.body()
    if not content:
        raise HTTPException(422, "Choose an Excel file to import.")
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "The file is too big. Use one under 10 MB.")
    try:
        parsed = tracker_import.parse_workbook(content, kind)
    except tracker_import.TrackerError as error:
        raise HTTPException(422, str(error)) from error
    if apply:
        done = tracker_import.apply(session, parsed, user.id)
        write_audit(
            session, request, "tracker.imported", "import", user,
            after={"kind": kind, **done, "issues": parsed.issue_count},
        )  # fmt: skip
    return tracker_import.summary(parsed, applied=apply)
