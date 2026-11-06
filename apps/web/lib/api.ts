import type {
  DemoRole,
  ExpiringList,
  Me,
  AdvanceResult,
  NewProject,
  NewRecruitment,
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
  WorkerFacets,
  WorkerList,
} from "./api-types";
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
  expiring: (window: "expired" | "d30" | "d60" | "d90") =>
    request<ExpiringList>(`/documents/expiring?window=${window}`),
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
  /** The eye icon: one number in full. The API records who looked. */
  revealNumber: (code: string, documentType: string) =>
    request<{ number: string }>(
      `/workers/${encodeURIComponent(code)}/documents/${encodeURIComponent(documentType)}/reveal`,
      { method: "POST" },
    ),
  /** A link the browser downloads (same site, so the sign-in cookie goes with it). */
  workersCsvUrl: (query: WorkersQuery) => `/api/workers/export.csv?${toApiParams(query, false)}`,
};

/** Only paths on our own site may be used as a "go here after signing in" target. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}
