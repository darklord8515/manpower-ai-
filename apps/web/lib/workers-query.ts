import type { WorkerStatus } from "./api-types";

/** What the Workers screen filters and sorts by. It lives in the address bar, so a view can be shared. */
export type WorkersQuery = {
  q: string;
  trade: string;
  project: string;
  status: WorkerStatus | "";
  /** "" = everyone, "expired" = a document already expired, "30" = a document runs out within 30 days. */
  documents: "" | "expired" | "30";
  sort: "name" | "trade" | "level" | "project" | "docs";
  dir: "asc" | "desc";
  page: number;
};

export const PAGE_SIZE = 25;

export const DEFAULT_QUERY: WorkersQuery = {
  q: "",
  trade: "",
  project: "",
  status: "",
  documents: "",
  sort: "name",
  dir: "asc",
  page: 1,
};

const STATUSES: readonly string[] = [
  "available",
  "deployed",
  "mobilizing",
  "demobilizing",
  "unavailable",
];
const SORTS: readonly string[] = ["name", "trade", "level", "project", "docs"];

/** The API's query string for this view. Empty filters are left out. */
export function toApiParams(query: WorkersQuery, paged = true): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.trade) params.set("trade", query.trade);
  if (query.project) params.set("project", query.project);
  if (query.status) params.set("status", query.status);
  if (query.documents === "expired") params.set("expired", "true");
  if (query.documents === "30") params.set("expiring_within", "30");
  params.set("sort", query.sort);
  params.set("dir", query.dir);
  if (paged) {
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String((query.page - 1) * PAGE_SIZE));
  }
  return params;
}

/** The address-bar form: only what differs from the defaults. */
export function toSearch(query: WorkersQuery, open?: string | null): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.trade) params.set("trade", query.trade);
  if (query.project) params.set("project", query.project);
  if (query.status) params.set("status", query.status);
  if (query.documents) params.set("documents", query.documents);
  if (query.sort !== DEFAULT_QUERY.sort) params.set("sort", query.sort);
  if (query.dir !== DEFAULT_QUERY.dir) params.set("dir", query.dir);
  if (query.page > 1) params.set("page", String(query.page));
  if (open) params.set("worker", open);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Reads a view back from the address bar. Anything unexpected falls back to the default. */
export function fromSearch(search: string): { query: WorkersQuery; open: string | null } {
  const params = new URLSearchParams(search);
  const status = params.get("status") ?? "";
  const documents = params.get("documents") ?? "";
  const sort = params.get("sort") ?? "";
  const page = Number(params.get("page"));
  const open = params.get("worker");
  return {
    query: {
      q: (params.get("q") ?? "").slice(0, 100),
      trade: (params.get("trade") ?? "").slice(0, 60),
      project: (params.get("project") ?? "").slice(0, 20),
      status: STATUSES.includes(status) ? (status as WorkerStatus) : "",
      documents: documents === "expired" || documents === "30" ? documents : "",
      sort: SORTS.includes(sort) ? (sort as WorkersQuery["sort"]) : DEFAULT_QUERY.sort,
      dir: params.get("dir") === "desc" ? "desc" : "asc",
      page: Number.isInteger(page) && page > 1 ? page : 1,
    },
    open: open && /^[A-Za-z0-9-]{1,20}$/.test(open) ? open : null,
  };
}
