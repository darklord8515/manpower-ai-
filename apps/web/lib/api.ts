import type {
  AgentRun,
  AgentRunBody,
  AiStatus,
  AlertDetail,
  AlertFilters,
  AlertList,
  AlertSummary,
  ApplicantDetail,
  ApplicantList,
  Assignee,
  InterviewBody,
  InterviewPreview,
  KeyRolesAdded,
  Leadership,
  ProjectEmailKind,
  ProjectEmailPreview,
  ChatRun,
  Brief,
  CalendarEntry,
  CalendarView,
  EmailBody,
  NewEvent,
  NewLeave,
  EmailPreview,
  ExecutiveDashboard,
  ProjectOverview,
  ChatStarted,
  ChatSuggestions,
  Conversation,
  ConversationView,
  DemoRole,
  ExpiringList,
  Me,
  AdvanceResult,
  ApproveResponse,
  LineCandidates,
  MobilizationDetail,
  MobilizationList,
  NewRequestBody,
  PicksResponse,
  RequestDetail,
  RequestRow,
  NewProject,
  NewRecruitment,
  ProjectDatesBody,
  ProjectForecast,
  RecruitmentList,
  RecruitmentRow,
  ReleaseResult,
  ReserveResponse,
  RecruitmentStage,
  ProjectRow,
  Preferences,
  PublicConfig,
  Summary,
  TradeStrength,
  Trade,
  WorkerDetail,
  WorkerEditBody,
  WorkerFacets,
  WorkerList,
} from "./api-types";
import { announceAlertsChanged } from "./alert-events";
import { toApiParams, type WorkersQuery } from "./workers-query";

/** An error from the API, with what the screen needs to explain it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds to wait before trying again (sent with 429). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Set by the app so a 401 anywhere (a session that ended) sends the user to the sign-in page. */
let onSessionEnded: (() => void) | null = null;
export function setSessionEndedHandler(handler: (() => void) | null) {
  onSessionEnded = handler;
}

const SIGN_IN_PATHS = ["/auth/login", "/auth/demo-login", "/auth/config", "/auth/me"];

/** A saved change may have changed an alert, so whatever shows alerts should look again. */
function announceIfWrite(path: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && !path.startsWith("/auth") && !path.startsWith("/assistant")) {
    announceAlertsChanged();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // The server did not answer at all (offline, or the free host is waking up).
    throw new ApiError(0, "We couldn’t reach the server. Check your connection and try again.");
  }
  if (response.ok) announceIfWrite(path, init);
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    if (response.status === 401 && !SIGN_IN_PATHS.includes(path)) onSessionEnded?.();
    let detail = "Something went wrong. Try again.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail.length > 0) {
        // FastAPI validation errors: [{ msg: "Value error, The end date must ..." }, ...]
        const first = body.detail[0] as { msg?: unknown };
        if (typeof first.msg === "string") detail = first.msg.replace(/^Value error, /, "");
      }
    } catch {
      /* no JSON body */
    }
    const retry = Number(response.headers.get("retry-after"));
    throw new ApiError(
      response.status,
      detail,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  config: () => request<PublicConfig>("/auth/config"),
  me: () => request<Me>("/auth/me"),
  login: (email: string, password: string) =>
    request<Me>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  demoLogin: (role: DemoRole) =>
    request<Me>("/auth/demo-login", { method: "POST", body: JSON.stringify({ role }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  summary: () => request<Summary>("/summary"),
  expiring: (window: ExpiryWindow, filters: DocumentFilters = {}) =>
    request<ExpiringList>(`/documents/expiring?${documentParams(window, filters)}`),
  documentsCsvUrl: (window: ExpiryWindow, filters: DocumentFilters = {}) =>
    `/api/documents/export.csv?${documentParams(window, filters)}`,
  requests: (filters: { q?: string; status?: string; project?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.project) params.set("project", filters.project);
    const query = params.toString();
    return request<RequestRow[]>(`/requests${query ? `?${query}` : ""}`);
  },
  requestDetail: (no: string) => request<RequestDetail>(`/requests/${encodeURIComponent(no)}`),
  raiseRequest: (body: NewRequestBody) =>
    request<RequestDetail>("/requests", { method: "POST", body: JSON.stringify(body) }),
  lineCandidates: (
    no: string,
    line: string,
    filters: { q?: string; minLevel?: number; documentsValid?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    if (filters.minLevel) params.set("min_level", String(filters.minLevel));
    if (filters.documentsValid) params.set("documents_valid", "true");
    const query = params.toString();
    return request<LineCandidates>(
      `/requests/${encodeURIComponent(no)}/lines/${line}/candidates${query ? `?${query}` : ""}`,
    );
  },
  /** `agentRun` is set when applying what the Workforce agent recommended. */
  choosePeople: (no: string, line: string, employeeCodes: string[], agentRun?: string) =>
    request<PicksResponse>(`/requests/${encodeURIComponent(no)}/lines/${line}/picks`, {
      method: "POST",
      body: JSON.stringify({
        employee_codes: employeeCodes,
        ...(agentRun ? { agent_run: agentRun } : {}),
      }),
    }),
  removePerson: (no: string, line: string, employeeCode: string, reason: string) =>
    request<void>(`/requests/${encodeURIComponent(no)}/lines/${line}/picks/remove`, {
      method: "POST",
      body: JSON.stringify({ employee_code: employeeCode, reason }),
    }),
  restorePerson: (no: string, line: string, employeeCode: string) =>
    request<PicksResponse>(`/requests/${encodeURIComponent(no)}/lines/${line}/picks/restore`, {
      method: "POST",
      body: JSON.stringify({ employee_code: employeeCode }),
    }),
  suggestPeople: (no: string, line: string) =>
    request<PicksResponse>(`/requests/${encodeURIComponent(no)}/lines/${line}/suggest`, {
      method: "POST",
    }),
  approveLine: (no: string, line: string, preview: boolean, employeeCodes?: string[]) =>
    request<ApproveResponse>(`/requests/${encodeURIComponent(no)}/lines/${line}/approve`, {
      method: "POST",
      body: JSON.stringify({ preview, employee_codes: employeeCodes ?? null }),
    }),
  rejectLine: (no: string, line: string, reason: string) =>
    request<RequestDetail>(`/requests/${encodeURIComponent(no)}/lines/${line}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  cancelRequest: (no: string, reason: string) =>
    request<RequestDetail>(`/requests/${encodeURIComponent(no)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  mobilizations: (filters: { q?: string; project?: string; overdue?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    if (filters.project) params.set("project", filters.project);
    if (filters.overdue) params.set("overdue", "true");
    const query = params.toString();
    return request<MobilizationList>(`/mobilizations${query ? `?${query}` : ""}`);
  },
  mobilization: (no: string) =>
    request<MobilizationDetail>(`/mobilizations/${encodeURIComponent(no)}`),
  markTaskDone: (no: string, taskId: string) =>
    request<MobilizationDetail>(`/mobilizations/${encodeURIComponent(no)}/tasks/${taskId}/done`, {
      method: "POST",
    }),
  reopenTask: (no: string, taskId: string) =>
    request<MobilizationDetail>(`/mobilizations/${encodeURIComponent(no)}/tasks/${taskId}/reopen`, {
      method: "POST",
    }),
  confirmArrival: (no: string) =>
    request<MobilizationDetail>(`/mobilizations/${encodeURIComponent(no)}/arrival`, {
      method: "POST",
    }),
  alerts: (filters: AlertFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.view && filters.view !== "open") params.set("view", filters.view);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.type) params.set("type", filters.type);
    if (filters.project) params.set("project", filters.project);
    if (filters.mine) params.set("mine", "true");
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    const query = params.toString();
    return request<AlertList>(`/alerts${query ? `?${query}` : ""}`);
  },
  alertSummary: () => request<AlertSummary>("/alerts/summary"),
  alertAssignees: () => request<Assignee[]>("/alerts/assignees"),
  alert: (id: string) => request<AlertDetail>(`/alerts/${id}`),
  takeAlert: (id: string) => request<AlertDetail>(`/alerts/${id}/take`, { method: "POST" }),
  assignAlert: (id: string, userId: string) =>
    request<AlertDetail>(`/alerts/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  snoozeAlert: (id: string, until: string) =>
    request<AlertDetail>(`/alerts/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ until }),
    }),
  dismissAlert: (id: string, reason: string) =>
    request<AlertDetail>(`/alerts/${id}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  bulkAlerts: (body: {
    ids: string[];
    action: "snooze" | "assign";
    until?: string;
    user_id?: string;
  }) =>
    request<{ changed: number }>("/alerts/bulk", { method: "POST", body: JSON.stringify(body) }),
  changeProjectDates: (code: string, body: ProjectDatesBody) =>
    request<ProjectRow>(`/projects/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  aiStatus: () => request<AiStatus>("/ai/status"),
  chatSuggestions: () => request<ChatSuggestions>("/assistant/suggestions"),
  /** Takes a question. Answers at once with a run id; the answer arrives by polling `chatAnswer`. */
  sendChat: (message: string, conversationId?: string | null) =>
    request<ChatStarted>("/assistant/messages", {
      method: "POST",
      body: JSON.stringify({
        message,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    }),
  chatAnswer: (runId: string) => request<ChatRun>(`/assistant/messages/${runId}`),
  conversations: () => request<Conversation[]>("/assistant/conversations"),
  conversation: (id: string) => request<ConversationView>(`/assistant/conversations/${id}`),
  deleteConversation: (id: string) =>
    request<void>(`/assistant/conversations/${id}`, { method: "DELETE" }),
  startAgentRun: (body: AgentRunBody) =>
    request<{ id: string }>("/agent/runs", { method: "POST", body: JSON.stringify(body) }),
  agentRun: (id: string) => request<AgentRun>(`/agent/runs/${id}`),
  summaryByTrade: () => request<TradeStrength[]>("/summary/trades"),
  preferences: () => request<Preferences>("/auth/me/preferences"),
  savePreferences: (preferences: Preferences) =>
    request<Preferences>("/auth/me/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    }),
  projects: () => request<ProjectRow[]>("/projects"),
  trades: () => request<Trade[]>("/trades"),
  createProject: (project: NewProject) =>
    request<ProjectRow>("/projects", { method: "POST", body: JSON.stringify(project) }),
  forecast: (code: string, start?: string) =>
    request<ProjectForecast>(
      `/projects/${encodeURIComponent(code)}/forecast${start ? `?start=${start}` : ""}`,
    ),
  reserve: (code: string, trade: string, employeeCodes: string[], start?: string) =>
    request<ReserveResponse>(`/projects/${encodeURIComponent(code)}/reserve`, {
      method: "POST",
      body: JSON.stringify({ trade, employee_codes: employeeCodes, start: start || null }),
    }),
  release: (code: string, employeeCodes: string[]) =>
    request<ReleaseResult>(`/projects/${encodeURIComponent(code)}/release`, {
      method: "POST",
      body: JSON.stringify({ employee_codes: employeeCodes }),
    }),
  recruitment: () => request<RecruitmentList>("/recruitment-requests"),
  raiseRecruitment: (body: NewRecruitment) =>
    request<RecruitmentRow>("/recruitment-requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  advanceRecruitment: (
    id: string,
    body: { to: RecruitmentStage; count?: number; expected_arrival?: string | null },
  ) =>
    request<AdvanceResult>(`/recruitment-requests/${encodeURIComponent(id)}/advance`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  workers: (query: WorkersQuery) => request<WorkerList>(`/workers?${toApiParams(query)}`),
  workerFacets: () => request<WorkerFacets>("/workers/facets"),
  worker: (code: string) => request<WorkerDetail>(`/workers/${encodeURIComponent(code)}`),
  /** HR edits a worker. Only the fields sent change; null clears a date. */
  editWorker: (code: string, body: WorkerEditBody) =>
    request<WorkerDetail>(`/workers/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  calendar: (start: string, end: string) =>
    request<CalendarView>(`/calendar?start=${start}&end=${end}`),
  addCalendarEvent: (body: NewEvent) =>
    request<CalendarEntry>("/calendar/events", { method: "POST", body: JSON.stringify(body) }),
  removeCalendarEvent: (id: string) =>
    request<void>(`/calendar/events/${id}`, { method: "DELETE" }),
  addLeave: (body: NewLeave) =>
    request<CalendarEntry>("/calendar/leaves", { method: "POST", body: JSON.stringify(body) }),
  removeLeave: (id: string) => request<void>(`/calendar/leaves/${id}`, { method: "DELETE" }),
  executiveDashboard: () => request<ExecutiveDashboard>("/executive/dashboard"),
  /** A few lines on where the company stands, worded by AI from the numbers (or by Python). */
  executiveBrief: () => request<Brief>("/executive/brief", { method: "POST" }),
  projectOverview: (code: string) =>
    request<ProjectOverview>(`/projects/${encodeURIComponent(code)}/overview`),
  leadership: (code: string) =>
    request<Leadership>(`/projects/${encodeURIComponent(code)}/leadership`),
  assignLead: (code: string, employeeCode: string) =>
    request<Leadership>(`/projects/${encodeURIComponent(code)}/lead`, {
      method: "PUT",
      body: JSON.stringify({ employee_code: employeeCode }),
    }),
  clearLead: (code: string) =>
    request<Leadership>(`/projects/${encodeURIComponent(code)}/lead`, { method: "DELETE" }),
  addKeyRoles: (code: string) =>
    request<KeyRolesAdded>(`/projects/${encodeURIComponent(code)}/key-roles/add`, {
      method: "POST",
    }),
  /** The Excel downloads are plain links: the browser sends the sign-in cookie. */
  staffXlsxUrl: (code: string) => `/api/projects/${encodeURIComponent(code)}/staff.xlsx`,
  recruitmentXlsxUrl: (code: string) =>
    `/api/projects/${encodeURIComponent(code)}/recruitment.xlsx`,
  previewProjectEmail: (code: string, kind: ProjectEmailKind) =>
    request<ProjectEmailPreview>(`/projects/${encodeURIComponent(code)}/email/preview`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
  sendProjectEmail: (code: string, kind: ProjectEmailKind) =>
    request<ProjectEmailPreview & { sent: boolean }>(
      `/projects/${encodeURIComponent(code)}/email`,
      { method: "POST", body: JSON.stringify({ kind }) },
    ),
  workerPhotoUrl: (code: string, version?: string | number) =>
    `/api/workers/${encodeURIComponent(code)}/photo${version ? `?v=${version}` : ""}`,
  uploadWorkerPhoto: (code: string, file: File) =>
    request<void>(`/workers/${encodeURIComponent(code)}/photo`, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    }),
  removeWorkerPhoto: (code: string) =>
    request<void>(`/workers/${encodeURIComponent(code)}/photo`, { method: "DELETE" }),
  applicants: (category = "", minMatch = 0) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (minMatch > 0) params.set("min_match", String(minMatch));
    const query = params.toString();
    return request<ApplicantList>(`/applicants${query ? `?${query}` : ""}`);
  },
  applicant: (code: string) => request<ApplicantDetail>(`/applicants/${encodeURIComponent(code)}`),
  previewInterview: (code: string, body: InterviewBody) =>
    request<InterviewPreview>(`/applicants/${encodeURIComponent(code)}/interview/preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  inviteApplicant: (code: string, body: InterviewBody) =>
    request<InterviewPreview & { sent: boolean }>(
      `/applicants/${encodeURIComponent(code)}/interview`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  setApplicantStatus: (code: string, status: "new" | "shortlisted" | "rejected") =>
    request<ApplicantDetail>(`/applicants/${encodeURIComponent(code)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  /** The exact email that would go to the worker. Nothing is sent. */
  previewWorkerEmail: (code: string, body: EmailBody) =>
    request<EmailPreview>(`/workers/${encodeURIComponent(code)}/email/preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sendWorkerEmail: (code: string, body: EmailBody) =>
    request<EmailPreview & { sent: boolean }>(`/workers/${encodeURIComponent(code)}/email`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  editDocumentExpiry: (code: string, documentType: string, expiryDate: string) =>
    request<WorkerDetail>(
      `/workers/${encodeURIComponent(code)}/documents/${encodeURIComponent(documentType)}`,
      { method: "PATCH", body: JSON.stringify({ expiry_date: expiryDate }) },
    ),
  /** The eye icon: one number in full. The API records who looked. */
  revealNumber: (code: string, documentType: string) =>
    request<{ number: string }>(
      `/workers/${encodeURIComponent(code)}/documents/${encodeURIComponent(documentType)}/reveal`,
      { method: "POST" },
    ),
  /** A link the browser downloads (same site, so the sign-in cookie goes with it). */
  workersCsvUrl: (query: WorkersQuery) => `/api/workers/export.csv?${toApiParams(query, false)}`,
};

export type ExpiryWindow = "expired" | "d30" | "d60" | "d90";
export type DocumentFilters = { q?: string; type?: string; project?: string };

function documentParams(window: ExpiryWindow, filters: DocumentFilters): URLSearchParams {
  const params = new URLSearchParams({ window });
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.type) params.set("type", filters.type);
  if (filters.project) params.set("project", filters.project);
  return params;
}

/** Only paths on our own site may be used as a "go here after signing in" target. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}
