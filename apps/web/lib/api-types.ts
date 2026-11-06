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
};

export type WorkerRisk = {
  kind: "expired" | "ends_before_assignment";
  severity: "critical" | "warning";
  document_type: string;
  expiry: string;
  project_code: string | null;
  days_short: number | null;
  message: string;
};

export type WorkerDetail = WorkerRow & {
  documents: WorkerDocument[];
  assignments: WorkerAssignment[];
  risks: WorkerRisk[];
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
  reason: "on_leave" | "documents" | "already_reserved" | "unavailable";
  detail: string;
};

export type Advice = {
  verdict: "covered" | "covered_with_dependencies" | "recruitment_pending" | "recruit";
  headline: string;
  recruit_count: number;
  recruit_by: string | null;
  recruit_by_passed: boolean;
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
