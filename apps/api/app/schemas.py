"""Response and request shapes. Anything not listed here is never sent to the browser."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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
    number: str | None  # always masked here; POST .../reveal returns it in full (audited)
    can_reveal: bool  # the caller holds employee:read_sensitive and the document has a number
    expiry: date | None
    days_left: int | None
    status: str


class AssignmentDetail(BaseModel):
    project_code: str
    project_name: str
    starts: date
    ends: date | None
    status: str
    moving_from: str | None = None  # a planned transfer: the project they leave first
    moving_from_ends: date | None = None  # their last day there


class Risk(BaseModel):
    """A document problem, worded and dated by Python (never by a model)."""

    kind: Literal[
        "expired",
        "ends_before_assignment",
        "contract_ends",
        "leaving",
        "absconded",
    ]
    severity: Literal["critical", "warning"]
    document_type: str | None  # None for contract and exit risks
    expiry: date  # the date the risk is about: the document, the contract end or the exit day
    project_code: str | None
    days_short: int | None  # how many days the document ends before the job does
    message: str


class WorkerDetail(WorkerRow):
    documents: list[DocumentDetail]
    assignments: list[AssignmentDetail]
    risks: list[Risk]
    employment_status: str | None = None
    contract_end_on: date | None = None
    exit_on: date | None = None
    exit_reason: str | None = None


class WorkerNumber(BaseModel):
    number: str


class Facet(BaseModel):
    value: str
    count: int


class WorkerFacets(BaseModel):
    trades: list[Facet]
    statuses: list[Facet]  # empty for the narrow projection
    projects: list[Facet]  # empty for the narrow projection
    documents: dict[str, int]  # workers with an expired document / one running out in 30 days


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


class ExpiryWeek(BaseModel):
    week_start: date
    count: int


class Summary(BaseModel):
    today: date
    workforce: WorkforceCounts
    documents: ExpiryCounts
    expiry_by_week: list[ExpiryWeek]  # 13 weeks (90 days) from today
    short_total: int  # people short across active projects (planned minus deployed)
    projects: list[ProjectRow]


class PublicConfig(BaseModel):
    demo_mode: bool


# ----------------------------------------------------------------------------- forecast


class Trade(BaseModel):
    code: str
    name: str


class Candidate(BaseModel):
    """The narrow candidate projection: no phone, no document numbers."""

    code: str
    name: str
    level: int | None
    documents_valid: bool  # required documents stay valid through the cover window


class ForecastSource(BaseModel):
    kind: Literal["available_now", "ending_before_start"]
    project_code: str | None  # the project they are coming from
    ends_on: date | None  # their last day there
    must_finish_by: date | None  # start minus the handover buffer
    workers: list[Candidate]


class LateCandidate(Candidate):
    project_code: str
    ends_on: date
    days_after_start: int  # negative = ends before the start, but inside the handover buffer


class ExcludedWorker(BaseModel):
    code: str
    name: str
    reason: Literal["on_leave", "documents", "already_reserved", "unavailable", "leaving"]
    detail: str


class Arrival(BaseModel):
    """People already being recruited for this trade: where they are in the pipeline and when."""

    stage: Literal["open", "sourcing", "offer_issued", "visa_processing", "arrived"]
    stage_label: str
    stage_phrase: str  # for sentences: "in visa processing"
    headcount: int
    source: Literal["local", "overseas"]
    expected_arrival: date | None
    days_after_start: int | None
    late: bool  # expected after the project starts, so not counted against the gap


class ReservedWorker(BaseModel):
    """Someone already planned onto this project (a reservation HR can release)."""

    code: str
    name: str
    starts_on: date
    moving_from: str | None  # the project they leave first, if any
    moving_from_ends: date | None


class Advice(BaseModel):
    verdict: Literal["covered", "covered_with_dependencies", "recruitment_pending", "recruit"]
    headline: str  # worded in Python from the numbers below
    recruit_count: int = 0
    recruit_by: date | None = None  # local hiring (the nearer deadline)
    recruit_by_passed: bool = False
    recruit_by_overseas: date | None = None  # overseas hiring takes longer, so earlier
    recruit_by_overseas_passed: bool = False
    could_start_late: int = 0  # people who finish just after the start and could join late
    max_delay_days: int | None = None
    recruit_instead: int = 0  # how many to recruit if the late ones are waited for


class TradeForecast(BaseModel):
    trade_code: str
    trade: str
    needed: int
    already_assigned: int
    deployable: int
    recruitment_pending: int
    gap: int
    uncovered_gap: int
    sources: list[ForecastSource]
    late_candidates: list[LateCandidate]
    arriving: list[Arrival]
    reserved: list[ReservedWorker]
    excluded: list[ExcludedWorker]
    advice: Advice


class ForecastProject(BaseModel):
    code: str
    name: str
    status: str
    starts_on: date | None
    ends_on: date | None


class ProjectForecast(BaseModel):
    project: ForecastProject
    today: date
    start: date
    window_end: date
    buffer_days: int
    late_window_days: int
    trades: list[TradeForecast]


# ----------------------------------------------------------------------------- new project


class NewProjectLine(BaseModel):
    """How many of one trade the project needs. The dates default to the project's own."""

    trade: str = Field(min_length=1, max_length=60)  # trade code, from GET /trades
    headcount: int = Field(ge=1, le=500)
    starts_on: date | None = None
    ends_on: date | None = None


class NewProject(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    starts_on: date
    ends_on: date
    outdoor: bool = True
    site_name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    lines: list[NewProjectLine] = Field(min_length=1, max_length=20)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Give the project a name of at least 3 characters.")
        return value

    @field_validator("site_name", "description")
    @classmethod
    def _optional_text(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None

    @model_validator(mode="after")
    def _consistent(self) -> NewProject:
        if self.ends_on < self.starts_on:
            raise ValueError("The end date must not be before the start date.")
        seen: set[str] = set()
        for line in self.lines:
            if line.trade in seen:
                raise ValueError("Each trade can appear once.")
            seen.add(line.trade)
            first, last = line.starts_on or self.starts_on, line.ends_on or self.ends_on
            if last < first:
                raise ValueError("A trade's end date must not be before its start date.")
            if first < self.starts_on or last > self.ends_on:
                raise ValueError("A trade's dates must sit inside the project's dates.")
        return self


# ----------------------------------------------------------------------------- reserve and release


class ReserveRequest(BaseModel):
    trade: str = Field(min_length=1, max_length=60)  # trade code
    employee_codes: list[str] = Field(min_length=1, max_length=100)
    start: date | None = None  # the what-if start date the screen was showing

    @field_validator("employee_codes")
    @classmethod
    def _unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(c.strip() for c in value if c.strip()))


class ReserveResult(BaseModel):
    code: str
    name: str
    outcome: Literal["reserved", "refused"]
    reason: str | None  # why a person was refused
    starts_on: date | None = None
    moving_from: str | None = None
    moving_from_ends: date | None = None


class ReserveResponse(BaseModel):
    results: list[ReserveResult]
    reserved: int


class ReleaseRequest(BaseModel):
    employee_codes: list[str] = Field(min_length=1, max_length=100)


class ReleaseResult(BaseModel):
    released: list[str]
    not_found: list[str]  # not reserved on this project (nothing was changed)


# ----------------------------------------------------------------------------- recruitment

Stage = Literal[
    "open", "sourcing", "offer_issued", "visa_processing", "arrived", "filled", "cancelled"
]


class RecruitmentRow(BaseModel):
    id: str
    request_no: str
    project_code: str | None
    project_name: str | None
    project_starts_on: date | None
    trade_code: str
    trade: str
    headcount: int
    needed_by: date
    stage: Stage
    stage_label: str
    source: Literal["local", "overseas"]
    expected_arrival: date | None
    arrives_late: bool  # expected after the project starts
    reason: str
    replaces_code: str | None
    replaces_name: str | None
    created_at: datetime


class LeavingWorker(BaseModel):
    """Someone going, with nobody being recruited to replace them yet."""

    code: str
    name: str
    trade_code: str
    trade: str
    project_code: str | None
    kind: Literal["exit", "contract_end", "absconded"]
    on: date
    detail: str


class RecruitmentList(BaseModel):
    today: date  # the server's date (it can be the simulated demo date)
    requests: list[RecruitmentRow]
    leaving: list[LeavingWorker]


class NewRecruitment(BaseModel):
    project: str | None = Field(default=None, max_length=20)  # project code
    trade: str = Field(min_length=1, max_length=60)  # trade code
    headcount: int = Field(ge=1, le=500)
    needed_by: date
    source: Literal["local", "overseas"] = "overseas"
    expected_arrival: date | None = None
    replaces: str | None = Field(default=None, max_length=20)  # employee code
    reason: str = Field(max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Give a reason of at least 10 characters.")
        return value


class AdvanceRecruitment(BaseModel):
    to: Stage
    count: int | None = Field(default=None, ge=1, le=500)  # how many move; default all
    expected_arrival: date | None = None


class AdvanceResult(BaseModel):
    advanced: RecruitmentRow
    remaining: RecruitmentRow | None  # the people who did not move, when only some did


# ----------------------------------------------------------------------------- Home layout

# The widgets a Home can hold. The browser may only ever store ids from this list.
HOME_WIDGETS = (
    "expiry",
    "workforce",
    "due",
    "projects_chart",
    "projects_table",
    "leaving",
    "pipeline",
    "by_trade",
    "unavailable",
)


class HomeLayout(BaseModel):
    order: list[str] = Field(max_length=20)
    hidden: list[str] = Field(max_length=20)

    @field_validator("order", "hidden")
    @classmethod
    def _known_and_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("A widget can appear only once.")
        unknown = [w for w in value if w not in HOME_WIDGETS]
        if unknown:
            raise ValueError(f"Unknown widget: {', '.join(unknown)}")
        return value


class Preferences(BaseModel):
    home: HomeLayout | None = None  # None = the default layout


class TradeStrength(BaseModel):
    trade: str
    group: str | None
    deployed: int
    mobilizing: int
    available: int
    unavailable: int
    total: int
