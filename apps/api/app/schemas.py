"""Response and request shapes. Anything not listed here is never sent to the browser."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class DemoLoginRequest(BaseModel):
    role: str = Field(min_length=1, max_length=40)


class Me(BaseModel):
    id: str
    email: str
    full_name: str
    roles: list[str]
    permissions: list[str]
    demo_mode: bool
    landing: str  # which Home to show: "hr" or "executive"


class DocumentBrief(BaseModel):
    type: str
    expiry: date
    days_left: int


class WorkerRow(BaseModel):
    code: str
    name: str
    trade: str
    level: int | None
    status: str | None
    project: str | None
    phone: str | None
    next_document: DocumentBrief | None


class WorkerList(BaseModel):
    total: int
    items: list[WorkerRow]


class DocumentDetail(BaseModel):
    type: str
    number: str | None  # masked without employee:read_sensitive
    expiry: date | None
    days_left: int | None
    status: str


class AssignmentDetail(BaseModel):
    project_code: str
    project_name: str
    starts: date
    ends: date | None
    status: str


class WorkerDetail(WorkerRow):
    documents: list[DocumentDetail]
    assignments: list[AssignmentDetail]


class ExpiringDocument(BaseModel):
    worker_code: str
    worker_name: str
    trade: str
    project: str | None
    phone: str | None
    type: str
    expiry: date
    days_left: int


class ExpiryCounts(BaseModel):
    expired: int
    d30: int
    d60: int
    d90: int


class ExpiringList(BaseModel):
    counts: ExpiryCounts
    items: list[ExpiringDocument]


class ProjectRow(BaseModel):
    code: str
    name: str
    status: str
    starts: date | None
    ends: date | None
    planned: int
    deployed: int


class WorkforceCounts(BaseModel):
    total: int
    deployed: int
    mobilizing: int
    available: int
    unavailable: int


class Summary(BaseModel):
    today: date
    workforce: WorkforceCounts
    documents: ExpiryCounts
    projects: list[ProjectRow]
