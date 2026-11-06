"use client";

import { Search, TriangleAlert, UserPlus, UsersRound } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusChip } from "@/components/ui/StatusChip";
import { FIELD } from "@/components/ui/button-styles";
import type { LineCandidates, Violation } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { GroupLabel, Level, SMALL_BUTTON, Violations } from "./parts";

export type PoolFilters = { q: string; minLevel: number; documentsValid: boolean };

type Props = {
  trade: string;
  data: LineCandidates | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  filters: PoolFilters;
  search: string;
  onSearch: (text: string) => void;
  onFilters: (changes: Partial<PoolFilters>) => void;
  /** No place left on the line, and no swap under way. */
  full: boolean;
  /** Name of the worker being replaced, while a swap is under way. */
  swappingName: string | null;
  busy: boolean;
  onAdd: (code: string) => void;
  /** Why a person was refused, by worker code. */
  problems: Record<string, Violation[]>;
  window: { from: string; until: string | null };
};

/** The people HR can put on the active line, in the narrow candidate projection. */
export function CandidatePool({
  trade,
  data,
  loading,
  error,
  onRetry,
  filters,
  search,
  onSearch,
  onFilters,
  full,
  swappingName,
  busy,
  onAdd,
  problems,
  window: needed,
}: Props) {
  const people = (data?.candidates ?? []).filter((c) => !c.picked);
  const swap = swappingName !== null;

  return (
    <aside
      aria-label="Candidate pool"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 lg:sticky lg:top-[calc(var(--topbar-h)+1rem)] lg:max-h-[calc(100vh-var(--topbar-h)-2rem)]"
    >
      <header>
        <h3 className="m-0 text-md font-semibold">Pool: {trade}</h3>
        <p className="m-0 mt-0.5 text-xs text-muted">
          {swap
            ? `Choose who takes ${swappingName}’s place.`
            : `Free for ${formatDate(needed.from)}${needed.until ? ` to ${formatDate(needed.until)}` : ""}.`}
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search the pool"
            placeholder="Name or code"
            className={`${FIELD} pl-9`}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Minimum level"
            className={`${FIELD} w-auto!`}
            value={filters.minLevel}
            onChange={(e) => onFilters({ minLevel: Number(e.target.value) })}
          >
            <option value={0}>Any level</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Level {n}+
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.documentsValid}
              onChange={(e) => onFilters({ documentsValid: e.target.checked })}
              className="size-4 accent-accent-hover"
            />
            Documents valid only
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && !data ? (
          <ErrorState title="Couldn’t load the pool" onRetry={onRetry}>
            {error}
          </ErrorState>
        ) : loading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading the pool"
            className="flex flex-col gap-2"
          >
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="skeleton h-12 rounded-control" />
            ))}
          </div>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-muted">
            <UsersRound className="size-5 text-subtle" aria-hidden="true" />
            {filters.q || filters.minLevel || filters.documentsValid
              ? "No one matches these filters."
              : "No one else is free for these dates."}
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {people.map((c) => (
              <li
                key={c.code}
                data-candidate={c.code}
                className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {c.name}{" "}
                    <span className="font-mono text-xs font-normal text-subtle">{c.code}</span>
                  </span>
                  <span className="text-xs text-muted">
                    <Level level={c.level} />
                  </span>
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={busy || (full && !swap)}
                    title={full && !swap ? "No open slot: remove or swap someone first" : undefined}
                    aria-label={`${swap ? "Swap in" : "Add"} ${c.name}`}
                    onClick={() => onAdd(c.code)}
                  >
                    <UserPlus className="size-3.5" aria-hidden="true" />
                    {swap ? "Swap in" : "Add"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <GroupLabel
                    group={c.group}
                    fromProject={c.from_project}
                    endsOn={c.ends_on}
                    startsOn={c.starts_on}
                  />
                  {!c.documents_valid && (
                    <StatusChip tone="warning" icon={TriangleAlert} label="Documents end first" />
                  )}
                </div>
                {problems[c.code] && (
                  <div role="alert">
                    <Violations items={problems[c.code]} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
