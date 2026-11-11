"""Add people from an Excel list: sorted into staff and labour, duplicates ignored, doubts asked.

The file travels as base64 inside a small JSON request, together with HR's answers, so the preview
and the real import read exactly the same file. Nothing is written unless `apply` is true and
every question has an answer. Only HR (`employee:write`) may import. See
services/employee_import.py.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, require
from app.db import get_session
from app.exports import XLSX_TYPE
from app.services import employee_import, employee_samples, workforce

router = APIRouter(prefix="/imports", tags=["imports"])

SessionDep = Annotated[Session, Depends(get_session)]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]


class EmployeeImport(BaseModel):
    file: str = Field(min_length=8, max_length=8_000_000)  # the .xlsx, base64
    decisions: dict[str, str] = Field(default_factory=dict)  # row number -> the option HR chose
    apply: bool = False
    raise_plans: bool = False  # let a full project grow its plan so everyone fits


@router.post("/employees")
def import_employees(
    body: EmployeeImport, request: Request, session: SessionDep, user: Writer
) -> dict[str, Any]:
    try:
        content = employee_import.decode(body.file)
        analysis = employee_import.analyse(session, content)
    except employee_import.ImportFileError as error:
        raise HTTPException(422, str(error)) from error
    if not body.apply:
        return employee_import.summary(analysis)
    try:
        done = employee_import.apply(session, user.id, analysis, body.decisions, body.raise_plans)
    except workforce.WorkforceError as error:
        session.rollback()
        raise HTTPException(error.status, error.message) from error
    write_audit(
        session, request, "employees.imported", "import", user,
        after={k: v for k, v in done.items() if isinstance(v, (int, dict))},
    )  # fmt: skip
    return employee_import.summary(analysis, applied=done)


@router.get("/employees/sample.xlsx")
def sample(user: Writer, which: Annotated[Literal["new", "changes"], Query()] = "new") -> Response:
    """A fictional demo file: `new` adds people; `changes` shows duplicates and the questions."""
    return Response(
        content=employee_samples.sample_xlsx(which),
        media_type=XLSX_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="HAMRA-demo-employees-{which}.xlsx"'
        },
    )
