/** What the API sends. Mirrors apps/api/app/schemas.py; keep the two in step. */

export type Me = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  permissions: string[];
  demo_mode: boolean;
  /** Which Home to show. */
  landing: "hr" | "executive" | string;
};

export type PublicConfig = { demo_mode: boolean };

export type ExpiryCounts = { expired: number; d30: number; d60: number; d90: number };

export type ProjectRow = {
  code: string;
  name: string;
  status: string;
  starts: string | null;
  ends: string | null;
  planned: number;
  deployed: number;
};

export type Summary = {
  today: string;
  workforce: {
    total: number;
    deployed: number;
    mobilizing: number;
    available: number;
    unavailable: number;
  };
  documents: ExpiryCounts;
  expiry_by_week: { week_start: string; count: number }[];
  short_total: number;
  projects: ProjectRow[];
  /** The one sentence at the top of Home, chosen and worded by the API. */
  insight: string;
};

export type ExpiringDocument = {
  worker_code: string;
  worker_name: string;
  trade: string;
  project: string | null;
  phone: string | null;
  type: string;
  expiry: string;
  days_left: number;
  /** The last day of their job (or its project). */
  job_ends?: string | null;
  /** The document runs out before the job does. */
  ends_before_job?: boolean;
};

export type ExpiringList = { counts: ExpiryCounts; items: ExpiringDocument[] };

export type DemoRole = "hr_manager" | "hr_executive" | "ceo";

export type WorkerStatus = "available" | "deployed" | "mobilizing" | "demobilizing" | "unavailable";

export type DocumentBrief = { type: string; expiry: string; days_left: number };

export type WorkerRow = {
  code: string;
  name: string;
  trade: string;
  level: number | null;
  /** Null for the narrow projection (logistics). */
  status: WorkerStatus | null;
  project: string | null;
  phone: string | null;
  next_document: DocumentBrief | null;
};

export type WorkerList = { total: number; items: WorkerRow[] };

export type WorkerDocument = {
  type: string;
  /** Always masked here; the eye icon asks the API for the full number. */
  number: string | null;
  can_reveal: boolean;
  expiry: string | null;
  days_left: number | null;
  status: string;
};

export type WorkerAssignment = {
  project_code: string;
  project_name: string;
  starts: string;
  ends: string | null;
  status: string;
  /** A planned transfer: the project they leave first, and their last day there. */
  moving_from?: string | null;
  moving_from_ends?: string | null;
  /** Their mobilization, when HR may see it. */
  mobilization?: MobilizationBrief | null;
};

export type WorkerRisk = {
  kind: "expired" | "ends_before_assignment" | "contract_ends" | "leaving" | "absconded";
  severity: "critical" | "warning";
  /** Null for contract and exit risks. */
  document_type: string | null;
  expiry: string;
  project_code: string | null;
  days_short: number | null;
  message: string;
};

export type WorkerDetail = WorkerRow & {
  documents: WorkerDocument[];
  assignments: WorkerAssignment[];
  risks: WorkerRisk[];
  employment_status?: string | null;
  contract_end_on?: string | null;
  exit_on?: string | null;
  exit_reason?: string | null;
};

export type Facet = { value: string; count: number };

export type WorkerFacets = {
  trades: Facet[];
  statuses: Facet[];
  projects: Facet[];
  documents: { expired: number; expiring_30: number };
};

export type Trade = { code: string; name: string };

export type NewProjectLine = {
  trade: string;
  headcount: number;
  starts_on?: string;
  ends_on?: string;
};

export type NewProject = {
  name: string;
  starts_on: string;
  ends_on: string;
  outdoor: boolean;
  lines: NewProjectLine[];
};

export type Candidate = {
  code: string;
  name: string;
  level: number | null;
  documents_valid: boolean;
};

export type ForecastSource = {
  kind: "available_now" | "ending_before_start";
  project_code: string | null;
  ends_on: string | null;
  must_finish_by: string | null;
  workers: Candidate[];
};

export type LateCandidate = Candidate & {
  project_code: string;
  ends_on: string;
  /** Negative = the last day is before the start, but inside the handover buffer. */
  days_after_start: number;
};

export type ExcludedWorker = {
  code: string;
  name: string;
  reason: "on_leave" | "documents" | "already_reserved" | "unavailable" | "leaving";
  detail: string;
};

export type Arrival = {
  stage: "open" | "sourcing" | "offer_issued" | "visa_processing" | "arrived";
  stage_label: string;
  stage_phrase: string;
  headcount: number;
  source: "local" | "overseas";
  expected_arrival: string | null;
  days_after_start: number | null;
  /** Expected after the project starts, so not counted against the gap. */
  late: boolean;
};

export type Advice = {
  verdict: "covered" | "covered_with_dependencies" | "recruitment_pending" | "recruit";
  headline: string;
  recruit_count: number;
  recruit_by: string | null;
  recruit_by_passed: boolean;
  recruit_by_overseas: string | null;
  recruit_by_overseas_passed: boolean;
  could_start_late: number;
  max_delay_days: number | null;
  recruit_instead: number;
};

export type TradeForecast = {
  trade_code: string;
  trade: string;
  needed: number;
  already_assigned: number;
  deployable: number;
  recruitment_pending: number;
  gap: number;
  uncovered_gap: number;
  sources: ForecastSource[];
  late_candidates: LateCandidate[];
  arriving: Arrival[];
  reserved: ReservedWorker[];
  excluded: ExcludedWorker[];
  advice: Advice;
};

export type ProjectForecast = {
  project: {
    code: string;
    name: string;
    status: string;
    starts_on: string | null;
    ends_on: string | null;
  };
  today: string;
  start: string;
  window_end: string;
  buffer_days: number;
  late_window_days: number;
  trades: TradeForecast[];
};

export type ReservedWorker = {
  code: string;
  name: string;
  starts_on: string;
  moving_from: string | null;
  moving_from_ends: string | null;
};

export type ReserveResult = {
  code: string;
  name: string;
  outcome: "reserved" | "refused";
  reason: string | null;
  starts_on?: string | null;
  moving_from?: string | null;
  moving_from_ends?: string | null;
};

export type ReserveResponse = { results: ReserveResult[]; reserved: number };

export type ReleaseResult = { released: string[]; not_found: string[] };

export type RecruitmentStage =
  "open" | "sourcing" | "offer_issued" | "visa_processing" | "arrived" | "filled" | "cancelled";

export type RecruitmentRow = {
  id: string;
  request_no: string;
  project_code: string | null;
  project_name: string | null;
  project_starts_on: string | null;
  trade_code: string;
  trade: string;
  headcount: number;
  needed_by: string;
  stage: RecruitmentStage;
  stage_label: string;
  source: "local" | "overseas";
  expected_arrival: string | null;
  arrives_late: boolean;
  reason: string;
  replaces_code: string | null;
  replaces_name: string | null;
  created_at: string;
};

export type LeavingWorker = {
  code: string;
  name: string;
  trade_code: string;
  trade: string;
  project_code: string | null;
  kind: "exit" | "contract_end" | "absconded";
  on: string;
  detail: string;
};

export type RecruitmentList = {
  /** The server's date, which can be the simulated demo date. */
  today: string;
  requests: RecruitmentRow[];
  leaving: LeavingWorker[];
};

export type NewRecruitment = {
  project?: string | null;
  trade: string;
  headcount: number;
  needed_by: string;
  source: "local" | "overseas";
  expected_arrival?: string | null;
  replaces?: string | null;
  reason: string;
};

export type AdvanceResult = { advanced: RecruitmentRow; remaining: RecruitmentRow | null };

export type TradeStrength = {
  trade: string;
  group: string | null;
  deployed: number;
  mobilizing: number;
  available: number;
  unavailable: number;
  total: number;
};

export type SavedHomeLayout = { order: string[]; hidden: string[] };
export type Preferences = { home: SavedHomeLayout | null };

// --------------------------------------------------------------------------- requests and the board

export type Violation = { rule: string; message: string };

export type RequestStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "partially_filled"
  | "filled"
  | "rejected"
  | "cancelled";

export type LineStatus = "open" | "approved" | "rejected";

export type LineSummary = {
  trade: string;
  headcount: number;
  filled: number;
  chosen: number;
  status: LineStatus;
};

export type RequestRow = {
  request_no: string;
  project_code: string;
  project_name: string;
  needed_from: string;
  needed_until: string | null;
  priority: number;
  status: RequestStatus;
  requested_by: string;
  created_at: string;
  waiting_days: number;
  lines: LineSummary[];
};

export type PickRow = {
  code: string;
  name: string;
  level: number | null;
  source: "hr" | "rules" | "agent";
  reason: string | null;
  removed_reason: string | null;
  group: "free" | "finishing" | "late" | "reserved" | null;
  from_project: string | null;
  starts_on: string | null;
  documents_until: string | null;
  /** Empty = still cleared; otherwise something changed since the person was chosen. */
  violations: Violation[];
};

export type ApprovedWorker = {
  code: string;
  name: string;
  starts_on: string;
  moving_from: string | null;
  mob_no: string | null;
};

export type LineRow = {
  id: string;
  trade_code: string;
  trade: string;
  headcount: number;
  min_level: number | null;
  filled: number;
  status: LineStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  picks: PickRow[];
  approved: ApprovedWorker[];
};

export type RequestDetail = Omit<RequestRow, "lines"> & {
  project_status: string;
  source_text: string | null;
  requested_by_id: string;
  lines: LineRow[];
  can_approve: boolean;
  approve_note: string | null;
};

export type BoardCandidate = {
  code: string;
  name: string;
  level: number | null;
  group: "free" | "finishing" | "late" | "reserved";
  from_project: string | null;
  ends_on: string | null;
  starts_on: string;
  documents_valid: boolean;
  picked: boolean;
};

export type BoardExcluded = { code: string; name: string; rule: string; message: string };

export type LineCandidates = {
  candidates: BoardCandidate[];
  excluded: BoardExcluded[];
  open_slots: number;
  window_end: string;
};

export type PickResult = {
  code: string;
  name: string;
  outcome: "chosen" | "refused";
  violations: Violation[];
};

export type PicksResponse = { results: PickResult[]; chosen: number };

export type ApprovePerson = {
  code: string;
  name: string;
  starts_on: string;
  moving_from: string | null;
  moving_from_ends: string | null;
  becomes_mobilizing: boolean;
  mob_no: string | null;
  violations: Violation[];
};

export type ApproveResponse = {
  preview: boolean;
  ok: boolean;
  request_no: string;
  trade: string;
  people: ApprovePerson[];
  assignments: number;
  mobilizations: number;
  depend_on_other_jobs: number;
  filled_after: number;
  headcount: number;
  request_status_after: RequestStatus;
};

export type NewRequestBody = {
  project: string;
  needed_from: string;
  needed_until?: string | null;
  priority: number;
  source_text?: string | null;
  lines: { trade: string; headcount: number; min_level?: number | null }[];
};

// --------------------------------------------------------------------------- mobilization

export type MobStage = "pending_checklist" | "in_progress" | "ready" | "on_site";

export type MobilizationBrief = {
  mob_no: string;
  status: string;
  stage: MobStage;
  tasks_done: number;
  tasks_total: number;
};

export type MobilizationRow = {
  mob_no: string;
  stage: MobStage;
  status: string;
  worker_code: string;
  worker_name: string;
  trade: string | null;
  project_code: string;
  project_name: string;
  report_on: string;
  tasks_done: number;
  tasks_total: number;
  /** Tasks not done whose due date has passed. */
  overdue: number;
  arrived_on: string | null;
};

export type MobilizationList = { today: string; items: MobilizationRow[] };

export type MobilizationTask = {
  id: string;
  department: string;
  department_name: string;
  title: string;
  due_on: string | null;
  status: "open" | "in_progress" | "done" | "blocked";
  overdue: boolean;
  done_by: string | null;
  done_at: string | null;
};

export type MobilizationDetail = MobilizationRow & {
  tasks: MobilizationTask[];
  can_update: boolean;
  /** Why this person cannot tick tasks, shown instead of dead buttons. */
  update_note: string | null;
  can_confirm_arrival: boolean;
  /** Why arrival cannot be confirmed (by this person, or right now). */
  arrival_note: string | null;
};

// --------------------------------------------------------------------------- alerts

export type AlertSeverity = "critical" | "action_needed" | "info";
export type AlertStatus = "open" | "in_progress" | "snoozed" | "resolved" | "dismissed";
export type AlertType =
  | "upcoming_shortfall"
  | "ending_without_next"
  | "document_expiry"
  | "mobilization_stuck"
  | "transfer_dependency_broken"
  | "approval_waiting"
  | "midday_ban_conflict";

export type AlertRow = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  /** Project code; null = company-wide. */
  project: string | null;
  raised_at: string;
  due_at: string | null;
  assignee: string | null;
  assignee_id: string | null;
  escalation_level: number;
  /** "HR Manager" or "Operations Manager" once it has moved up. */
  escalated_to: string | null;
  snoozed_until: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type AlertCounts = { critical: number; action_needed: number; info: number };

export type AlertList = {
  items: AlertRow[];
  counts: AlertCounts;
  snoozed: number;
  last_run: string | null;
  /** The server's clock, which can be the simulated one. */
  now: string;
  can_act: boolean;
};

export type AlertSummary = {
  counts: AlertCounts;
  needs_attention: number;
  top: AlertRow[];
  mine: number;
  last_run: string | null;
  now: string;
  can_act: boolean;
};

export type AlertAction = {
  action: string;
  label: string;
  params: Record<string, string | number | null>;
};

export type AlertHistory = { at: string; by: string; what: string };

export type AlertDetail = AlertRow & {
  explanation: string | null;
  /** True once the narrator has rewritten the text (Phase 5); false = template wording. */
  narrated: boolean;
  facts: Record<string, unknown>;
  actions: AlertAction[];
  can_act: boolean;
  can_dismiss: boolean;
  history: AlertHistory[];
};

export type Assignee = { id: string; name: string; role: string };

export type AlertFilters = {
  view?: "open" | "snoozed" | "cleared";
  severity?: AlertSeverity | "";
  type?: AlertType | "";
  project?: string;
  mine?: boolean;
  q?: string;
};

export type ProjectDatesBody = { starts_on?: string; ends_on?: string };

// ---------------------------------------------------------------------------------- the AI agent

/** Which model tiers are switched on, so a screen can disable its AI buttons with a reason. */
export type AiStatus = { light: boolean; mid: boolean };

/** One thing the agent has done so far, worded by the server from its real tool calls. */
export type AgentStep = { title: string; detail: string };

export type AgentSelection = {
  code: string;
  name: string;
  level: number | null;
  group: string;
  reason: string;
  /** Who wrote the reason line: the model, or the rules service when the model's did not check out. */
  reason_by: "ai" | "rules";
};

export type AgentDropped = { code: string; name: string; rule: string; message: string };

export type AgentRecommendation = {
  trade: string;
  open_places: number;
  shortfall: number;
  note: string | null;
  selections: AgentSelection[];
  rejected: AgentDropped[];
};

export type AgentRunBody =
  | { kind: "recommend_line"; request_no: string; line_id: string }
  | { kind: "explain_forecast"; project: string; start?: string | null };

export type AgentRun = {
  id: string;
  kind: "recommend_line" | "explain_forecast";
  status: "running" | "succeeded" | "failed" | "refused";
  steps: AgentStep[];
  recommendation: AgentRecommendation | null;
  /** The explanation of a forecast. */
  answer: string | null;
  error: string | null;
  model: string | null;
  tier: string;
  started_at: string;
  finished_at: string | null;
};
