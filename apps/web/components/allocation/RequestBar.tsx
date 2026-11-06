"use client";

import { ClipboardList, Search } from "lucide-react";
import { useRef } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { FIELD } from "@/components/ui/button-styles";
import type { RequestRow } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RequestStatusChip } from "./parts";

export type RequestFilters = { q: string; status: string; project: string };

const STATUSES = [
  { value: "", label: "Every status" },
  { value: "submitted", label: "Waiting for approval" },
  { value: "partially_filled", label: "Partly filled" },
  { value: "filled", label: "Filled" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

type Props = {
  requests: RequestRow[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selected: string | null;
  onSelect: (requestNo: string) => void;
  filters: RequestFilters;
  /** Search text as typed; `filters.q` follows after a pause. */
  search: string;
  onSearch: (text: string) => void;
  onFilters: (changes: Partial<RequestFilters>) => void;
  projects: { code: string; name: string }[];
  /** The "New request" button, when this person may raise one. */
  action?: React.ReactNode;
};

const PRIORITY_LABEL: Record<number, string> = { 1: "Urgent", 2: "High" };

function Progress({ request }: { request: RequestRow }) {
  const total = request.lines.reduce((n, l) => n + l.headcount, 0);
  const filled = request.lines.reduce((n, l) => n + l.filled, 0);
  const chosen = request.lines.reduce((n, l) => n + (l.status === "open" ? l.chosen : 0), 0);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={`${request.request_no} filled`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-(--dur-base)"
          style={{ width: `${total ? Math.round((filled / total) * 100) : 0}%` }}
        />
      </div>
      <span className="text-xs text-muted">
        {filled} of {total} approved{chosen > 0 ? `, ${chosen} chosen` : ""}
      </span>
    </div>
  );
}

function Card({
  request,
  selected,
  onSelect,
}: {
  request: RequestRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const shown = request.lines.slice(0, 2);
  const more = request.lines.length - shown.length;
  return (
    <button
      type="button"
      data-request={request.request_no}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "press flex w-72 shrink-0 snap-start flex-col gap-1.5 rounded-card border bg-surface p-3 text-left transition-colors hover:bg-hover",
        selected ? "border-accent ring-1 ring-accent" : "border-border",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium whitespace-nowrap">
          {request.request_no}
        </span>
        <RequestStatusChip status={request.status} />
      </span>
      <span className="min-w-0 truncate text-sm font-medium">
        <span className="font-mono text-xs text-subtle">{request.project_code}</span>{" "}
        {request.project_name}
      </span>
      <span className="text-xs text-muted">
        {shown.map((l) => `${l.headcount} × ${l.trade}`).join(", ")}
        {more > 0 ? ` and ${more} more` : ""}
      </span>
      <span className="text-xs text-muted">
        Needed from {formatDate(request.needed_from)}
        {PRIORITY_LABEL[request.priority] ? ` · ${PRIORITY_LABEL[request.priority]}` : ""}
      </span>
      <Progress request={request} />
    </button>
  );
}

/** Search, two filters and one card per request. ←/→ move between the cards; Enter opens one. */
export function RequestBar({
  requests,
  loading,
  error,
  onRetry,
  selected,
  onSelect,
  filters,
  search,
  onSearch,
  onFilters,
  projects,
  action,
}: Props) {
  const row = useRef<HTMLDivElement>(null);

  function arrows(event: React.KeyboardEvent) {
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (!step || !row.current) return;
    const cards = [...row.current.querySelectorAll<HTMLButtonElement>("button[data-request]")];
    const at = cards.findIndex((c) => c === document.activeElement);
    const next = cards[Math.min(Math.max(at + step, 0), cards.length - 1)];
    if (next) {
      event.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  const filtered = filters.q !== "" || filters.status !== "" || filters.project !== "";

  return (
    <section aria-label="Staffing requests" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search requests"
            placeholder="Request, project or trade"
            className={`${FIELD} pl-9`}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter by status"
          className={`${FIELD} w-auto!`}
          value={filters.status}
          onChange={(e) => onFilters({ status: e.target.value })}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by project"
          className={`${FIELD} w-auto! max-w-56`}
          value={filters.project}
          onChange={(e) => onFilters({ project: e.target.value })}
        >
          <option value="">Every project</option>
          {projects.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        {action && <div className="ml-auto">{action}</div>}
      </div>

      {error && !requests ? (
        <ErrorState title="Couldn’t load requests" onRetry={onRetry}>
          {error}
        </ErrorState>
      ) : loading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading requests"
          className="flex gap-3 overflow-hidden"
        >
          {[0, 1, 2].map((n) => (
            <div key={n} className="skeleton h-36 w-72 shrink-0 rounded-card" />
          ))}
        </div>
      ) : requests && requests.length === 0 ? (
        <p className="m-0 flex items-center gap-2 rounded-card border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
          <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
          {filtered
            ? "No request matches these filters."
            : "No staffing requests yet. Send one to start filling a project."}
        </p>
      ) : (
        <div
          ref={row}
          role="group"
          aria-label="Requests"
          onKeyDown={arrows}
          className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
        >
          {requests?.map((r) => (
            <Card
              key={r.request_no}
              request={r}
              selected={r.request_no === selected}
              onSelect={() => onSelect(r.request_no)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
