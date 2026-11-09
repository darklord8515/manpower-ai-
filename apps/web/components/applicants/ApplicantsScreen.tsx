"use client";

import { FlaskConical, Sparkles, UserSearch } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { FIELD } from "@/components/ui/button-styles";
import { initialsOf } from "@/components/workers/WorkerAvatar";
import { api } from "@/lib/api";
import type { ApplicantRow, ApplicantTier } from "@/lib/api-types";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { ApplicantSheet } from "./ApplicantSheet";

export const TIER: Record<ApplicantTier, { label: string; tone: Tone }> = {
  strong: { label: "Strong match", tone: "success" },
  good: { label: "Good match", tone: "info" },
  partial: { label: "Partial match", tone: "neutral" },
};

export const STATUS_LABEL: Record<ApplicantRow["status"], string> = {
  new: "New",
  shortlisted: "Shortlisted",
  interview_sent: "Interview sent",
  rejected: "Rejected",
};

const LEVELS = [
  ["All", 0],
  ["90% and above", 90],
  ["80% and above", 80],
] as const;

/** Applicants for open jobs (demo data), ranked by how well they fit what the job needs. */
export function ApplicantsScreen() {
  const [category, setCategory] = useState("");
  const [min, setMin] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => api.applicants(category, min), `applicants:${category}:${min}`);
  const data = list.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            Applicants
            <StatusChip tone="warning" icon={FlaskConical} label="Demo data" />
          </h1>
          <p className="m-0 text-sm text-muted">
            People who applied, ranked by how well they fit the job. Open one to see why, and to
            invite them to an interview.
          </p>
        </div>
      </header>

      {data && (
        <p className="m-0 flex items-center gap-2 rounded-card border border-border bg-surface px-4 py-3 text-sm">
          <Sparkles className="size-4 shrink-0 text-accent-text" aria-hidden="true" />
          <span>
            <b>Match check (demo):</b> {data.summary}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Job category
          <select
            className={cn(FIELD, "min-w-48")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Match level" className="flex gap-2">
          {LEVELS.map(([label, value]) => (
            <button
              key={value}
              type="button"
              aria-pressed={min === value}
              onClick={() => setMin(value)}
              className={cn(
                "press inline-flex h-9 items-center rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                min === value ? "bg-hover text-fg" : "bg-surface text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {list.loading && !data ? (
        <SkeletonLoader label="Loading applicants" variant="rows" count={6} />
      ) : list.error ? (
        <ErrorState title="Couldn’t load the applicants" onRetry={list.retry}>
          {list.error}
        </ErrorState>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={UserSearch} title="No applicants match">
          Try another job category, or lower the match level.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {(data?.items ?? []).map((a) => (
            <li key={a.code}>
              <button
                type="button"
                onClick={() => setOpen(a.code)}
                className="press flex w-full flex-col gap-3 rounded-card border border-border bg-surface p-4 text-left transition-colors hover:bg-hover"
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken text-sm font-semibold text-muted">
                    {initialsOf(a.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.category} · {a.years} {a.years === 1 ? "year" : "years"}
                      {a.location ? ` · ${a.location}` : ""}
                    </span>
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{a.percent}%</span>
                </span>
                <span
                  className="block h-1.5 overflow-hidden rounded-full bg-(--track)"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-(--chart-strong)"
                    style={{ width: `${a.percent}%` }}
                  />
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={TIER[a.tier].tone} icon={Sparkles} label={TIER[a.tier].label} />
                  <span className="text-xs text-muted">{STATUS_LABEL[a.status]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ApplicantSheet code={open} onClose={() => setOpen(null)} onChanged={list.retry} />
    </div>
  );
}
