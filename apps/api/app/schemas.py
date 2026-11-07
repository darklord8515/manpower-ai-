"""Response and request shapes. Anything not listed here is never sent to the browser."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

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


class MobilizationBrief(BaseModel):
    """Where a person's mobilization stands, for the worker profile."""

    mob_no: str
    status: str
    stage: Literal["pending_checklist", "in_progress", "ready", "on_site"]
    tasks_done: int
    tasks_total: int


class AssignmentDetail(BaseModel):
    project_code: str
    project_name: str
    starts: date
    ends: date | None
    status: str
    moving_from: str | None = None  # a planned transfer: the project they leave first
    moving_from_ends: date | None = None  # their last day there
    mobilization: MobilizationBrief | None = None


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
    job_ends: date | None = None  # the last day of their job (or its project)
    ends_before_job: bool = False  # the document runs out before the job does


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
    insight: str  # the one sentence at the top of Home, chosen and worded in Python


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
    "action_center",
    "alert_counts",
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


# --------------------------------------------------------------------------- requests and the board


class Violation(BaseModel):
    """A hard rule a person fails for a line: plain words first, the rule code beside it."""

    rule: str
    message: str


class NewRequestLine(BaseModel):
    trade: str = Field(min_length=1, max_length=60)  # trade code
    headcount: int = Field(ge=1, le=500)
    min_level: int | None = Field(default=None, ge=1, le=5)


class NewRequest(BaseModel):
    project: str = Field(min_length=1, max_length=20)  # project code
    needed_from: date
    needed_until: date | None = None
    priority: int = Field(default=3, ge=1, le=5)
    source_text: str | None = Field(default=None, max_length=1000)
    lines: list[NewRequestLine] = Field(min_length=1, max_length=10)

    @field_validator("source_text")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None

    @model_validator(mode="after")
    def _consistent(self) -> NewRequest:
        if self.needed_until is not None and self.needed_until < self.needed_from:
            raise ValueError("The end date must not be before the start date.")
        trades = [line.trade for line in self.lines]
        if len(set(trades)) != len(trades):
            raise ValueError("Each trade can appear once.")
        return self


LineStatus = Literal["open", "approved", "rejected"]
RequestStatus = Literal[
    "draft", "submitted", "in_review", "approved", "partially_filled", "filled", "rejected",
    "cancelled",
]  # fmt: skip


class LineSummary(BaseModel):
    trade: str
    headcount: int
    filled: int  # approved people
    chosen: int  # chosen but not yet approved
    status: LineStatus


class RequestRow(BaseModel):
    request_no: str
    project_code: str
    project_name: str
    needed_from: date
    needed_until: date | None
    priority: int
    status: RequestStatus
    requested_by: str
    created_at: datetime
    waiting_days: int
    lines: list[LineSummary]


class PickRow(BaseModel):
    code: str
    name: str
    level: int | None
    source: Literal["hr", "rules", "agent"]
    reason: str | None
    removed_reason: str | None
    group: str | None  # free | finishing | late | reserved
    from_project: str | None
    starts_on: date | None
    documents_until: date | None
    violations: list[Violation]  # empty = still cleared; otherwise something changed since


class ApprovedWorker(BaseModel):
    code: str
    name: str
    starts_on: date
    moving_from: str | None
    mob_no: str | None


class LineRow(BaseModel):
    id: str
    trade_code: str
    trade: str
    headcount: int
    min_level: int | None
    filled: int
    status: LineStatus
    decided_by: str | None
    decided_at: datetime | None
    decision_reason: str | None
    picks: list[PickRow]
    approved: list[ApprovedWorker]


class RequestDetail(RequestRow):
    project_status: str
    source_text: str | None
    requested_by_id: str
    lines: list[LineRow]  # type: ignore[assignment]
    can_approve: bool  # the caller may approve (and did not raise it)
    approve_note: str | None  # why not, in words


class BoardCandidate(BaseModel):
    """The candidate projection: no phone, no document numbers."""

    code: str
    name: str
    level: int | None
    group: Literal["free", "finishing", "late", "reserved"]
    from_project: str | None
    ends_on: date | None  # their last day on the project they come from
    starts_on: date
    documents_valid: bool
    picked: bool


class BoardExcluded(BaseModel):
    code: str
    name: str
    rule: str
    message: str


class LineCandidates(BaseModel):
    candidates: list[BoardCandidate]
    excluded: list[BoardExcluded]
    open_slots: int
    window_end: date


class PicksRequest(BaseModel):
    employee_codes: list[str] = Field(min_length=1, max_length=50)
    # Set when HR is applying a Workforce agent recommendation: the picks are then recorded as the
    # agent's, with its reasons. Every hard rule still runs on each person.
    agent_run: uuid.UUID | None = None

    @field_validator("employee_codes")
    @classmethod
    def _unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(c.strip() for c in value if c.strip()))


class RemovePick(BaseModel):
    employee_code: str = Field(min_length=1, max_length=20)
    reason: str = Field(max_length=300)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Give a reason of at least 3 characters.")
        return value


class RestorePick(BaseModel):
    employee_code: str = Field(min_length=1, max_length=20)


class PickResult(BaseModel):
    code: str
    name: str
    outcome: Literal["chosen", "refused"]
    violations: list[Violation]


class PicksResponse(BaseModel):
    results: list[PickResult]
    chosen: int


class ApproveBody(BaseModel):
    employee_codes: list[str] | None = None  # None = everyone chosen on the line
    preview: bool = False


class ApprovePerson(BaseModel):
    code: str
    name: str
    starts_on: date
    moving_from: str | None
    moving_from_ends: date | None
    becomes_mobilizing: bool
    mob_no: str | None = None  # only after approving
    violations: list[Violation] = []


class ApproveResponse(BaseModel):
    preview: bool
    ok: bool
    request_no: str
    trade: str
    people: list[ApprovePerson]
    assignments: int
    mobilizations: int
    depend_on_other_jobs: int
    filled_after: int
    headcount: int
    request_status_after: RequestStatus


class RejectBody(BaseModel):
    reason: str = Field(max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Give a reason of at least 10 characters.")
        return value


class CancelBody(BaseModel):
    reason: str = Field(max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Give a reason of at least 3 characters.")
        return value


# ------------------------------------------------------------------------------- mobilization

MobStage = Literal["pending_checklist", "in_progress", "ready", "on_site"]


class MobilizationRow(BaseModel):
    mob_no: str
    stage: MobStage
    status: str
    worker_code: str
    worker_name: str
    trade: str | None
    project_code: str
    project_name: str
    report_on: date
    tasks_done: int
    tasks_total: int
    overdue: int  # tasks not done whose due date has passed
    arrived_on: date | None


class MobilizationList(BaseModel):
    today: date
    items: list[MobilizationRow]


class MobilizationTask(BaseModel):
    id: uuid.UUID
    department: str  # code: hr, operations, site
    department_name: str
    title: str
    due_on: date | None
    status: Literal["open", "in_progress", "done", "blocked"]
    overdue: bool
    done_by: str | None
    done_at: datetime | None


class MobilizationDetail(MobilizationRow):
    tasks: list[MobilizationTask]
    can_update: bool
    update_note: str | None  # why this person cannot tick tasks (shown instead of dead buttons)
    can_confirm_arrival: bool
    arrival_note: str | None  # why arrival cannot be confirmed (right now, or by this person)


# ------------------------------------------------------------------------------------- alerts

AlertSeverity = Literal["critical", "action_needed", "info"]
AlertStatus = Literal["open", "in_progress", "snoozed", "resolved", "dismissed"]
AlertType = Literal[
    "upcoming_shortfall",
    "ending_without_next",
    "document_expiry",
    "mobilization_stuck",
    "transfer_dependency_broken",
    "approval_waiting",
    "midday_ban_conflict",
]


class AlertRow(BaseModel):
    id: uuid.UUID
    type: AlertType
    severity: AlertSeverity
    status: AlertStatus
    title: str
    project: str | None  # project code; None = company-wide
    raised_at: datetime
    due_at: datetime | None
    assignee: str | None
    assignee_id: uuid.UUID | None
    escalation_level: int
    escalated_to: str | None  # "HR Manager" or "Operations Manager" once it has moved up
    snoozed_until: datetime | None
    resolved_at: datetime | None
    resolution_note: str | None


class AlertCounts(BaseModel):
    critical: int
    action_needed: int
    info: int


class AlertList(BaseModel):
    items: list[AlertRow]
    counts: AlertCounts  # live alerts (open and in progress), by severity, under the other filters
    snoozed: int  # how many are snoozed under the same filters
    last_run: datetime | None
    now: datetime  # the server's clock (it can be the simulated one)
    can_act: bool


class AlertSummary(BaseModel):
    """What the bell and the CEO tile show."""

    counts: AlertCounts
    needs_attention: int  # critical plus action needed
    top: list[AlertRow]  # the most urgent, at most five
    mine: int
    last_run: datetime | None
    now: datetime
    can_act: bool


class AlertAction(BaseModel):
    action: str
    label: str
    params: dict[str, str | int | None]


class AlertHistory(BaseModel):
    at: datetime
    by: str  # a person, or "System"
    what: str  # "Raised", "Taken by Priya Demo", "Snoozed until 6 Nov 2026"...


class AlertDetail(AlertRow):
    explanation: str | None
    narrated: bool  # true once the narrator has rewritten it (Phase 5); false = template wording
    facts: dict[str, Any]
    actions: list[AlertAction]
    can_act: bool
    can_dismiss: bool
    history: list[AlertHistory]


class Assignee(BaseModel):
    id: uuid.UUID
    name: str
    role: str


class AssignBody(BaseModel):
    user_id: uuid.UUID


class SnoozeBody(BaseModel):
    until: datetime


class DismissBody(BaseModel):
    reason: str = Field(max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Give a reason of at least 10 characters.")
        return value


class BulkBody(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    action: Literal["snooze", "assign"]
    until: datetime | None = None
    user_id: uuid.UUID | None = None


class BulkResult(BaseModel):
    changed: int


class RunResult(BaseModel):
    raised: int
    updated: int
    resolved: int
    reopened: int
    escalated: int


class AiStatus(BaseModel):
    """Which model tiers are switched on, so a screen can disable its AI buttons with a reason."""

    light: bool
    mid: bool


class RecommendRun(BaseModel):
    kind: Literal["recommend_line"]
    request_no: str = Field(min_length=1, max_length=40)
    line_id: uuid.UUID


class ExplainRun(BaseModel):
    kind: Literal["explain_forecast"]
    project: str = Field(min_length=1, max_length=20)
    start: date | None = None


AgentRunBody = Annotated[RecommendRun | ExplainRun, Field(discriminator="kind")]


class AgentRunStarted(BaseModel):
    id: uuid.UUID


class AgentStep(BaseModel):
    title: str
    detail: str


class AgentSelection(BaseModel):
    code: str
    name: str
    level: int | None
    group: str
    reason: str
    reason_by: Literal["ai", "rules"]  # who wrote the reason line: the model, or the rules service


class AgentDropped(BaseModel):
    code: str
    name: str
    rule: str
    message: str


class AgentRecommendation(BaseModel):
    trade: str
    open_places: int
    shortfall: int
    note: str | None
    selections: list[AgentSelection]
    rejected: list[AgentDropped]


class AgentRunView(BaseModel):
    id: uuid.UUID
    kind: Literal["recommend_line", "explain_forecast"]
    status: Literal["running", "succeeded", "failed", "refused"]
    steps: list[AgentStep]  # what the agent has done so far, worded by Python from its real calls
    recommendation: AgentRecommendation | None
    answer: str | None  # the explanation of a forecast
    error: str | None
    model: str | None
    tier: str
    started_at: datetime
    finished_at: datetime | None


class NarrateQueued(BaseModel):
    """Answer to "word the alerts": how many have template wording, and whether a model will."""

    ai_enabled: bool  # false: the light tier is off, so nothing will be reworded
    pending: int


class ProjectDates(BaseModel):
    """Change a project's dates. Either one, or both."""

    starts_on: date | None = None
    ends_on: date | None = None

    @model_validator(mode="after")
    def _something(self) -> ProjectDates:
        if self.starts_on is None and self.ends_on is None:
            raise ValueError("Give a new start date, a new end date, or both.")
        return self
