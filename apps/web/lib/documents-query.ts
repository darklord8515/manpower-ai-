import type { ExpiryWindow } from "./api";

/** What the Documents screen is looking at. It lives in the address bar, so a view can be shared. */
export type DocumentsQuery = {
  window: ExpiryWindow;
  q: string;
  type: string;
  project: string;
};

export const DEFAULT_DOCUMENTS_QUERY: DocumentsQuery = {
  window: "d30",
  q: "",
  type: "",
  project: "",
};

const WINDOWS: readonly string[] = ["expired", "d30", "d60", "d90"];

export function toDocumentsSearch(query: DocumentsQuery, open?: string | null): string {
  const params = new URLSearchParams();
  if (query.window !== DEFAULT_DOCUMENTS_QUERY.window) params.set("window", query.window);
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.type) params.set("type", query.type);
  if (query.project) params.set("project", query.project);
  if (open) params.set("worker", open);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Reads a view back from the address bar. Anything unexpected falls back to the default. */
export function fromDocumentsSearch(search: string): {
  query: DocumentsQuery;
  open: string | null;
} {
  const params = new URLSearchParams(search);
  const window = params.get("window") ?? "";
  const open = params.get("worker");
  return {
    query: {
      window: WINDOWS.includes(window) ? (window as ExpiryWindow) : DEFAULT_DOCUMENTS_QUERY.window,
      q: (params.get("q") ?? "").slice(0, 100),
      type: /^[a-z_]{1,30}$/.test(params.get("type") ?? "") ? (params.get("type") ?? "") : "",
      project: /^[A-Za-z0-9-]{1,20}$/.test(params.get("project") ?? "")
        ? (params.get("project") ?? "")
        : "",
    },
    open: open && /^[A-Za-z0-9-]{1,20}$/.test(open) ? open : null,
  };
}
