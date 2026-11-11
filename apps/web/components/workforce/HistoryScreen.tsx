"use client";

import { Bot, History as HistoryIcon, User } from "lucide-react";
import { useState } from "react";
import { FIELD } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

const WHAT: Record<string, string> = {
  added: "Added",
  placed: "Placed on a project",
  moved: "Moved",
  documents_cleared: "Documents cleared",
  joined: "Joined",
  resigned: "Resigned",
  plan_changed: "Plan changed",
  imported: "Imported from Excel",
};

/** Everything done to the workforce, with what the AI decided marked. */
export function HistoryScreen() {
  const [by, setBy] = useState<"" | "ai" | "hr">("");
  const [project, setProject] = useState("");
  const projects = useLoad(() => api.wProjects(), "w-projects");
  const list = useLoad(
    () => api.wHistory(by || undefined, project || undefined),
    `w-history:${by}:${project}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">History</h1>
        <p className="m-0 text-sm text-muted">
          What was done to the workforce: placements, moves, steps and plan changes. What the AI
          decided is marked, with its reason.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Who decided" className="flex gap-2">
          {(
            [
              ["", "Everything"],
              ["ai", "By the AI"],
              ["hr", "By HR"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={by === value}
              onClick={() => setBy(value)}
              className={cn(
                "press inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                by === value ? "bg-hover text-fg" : "bg-surface text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Project
          <select
            className={cn(FIELD, "min-w-56")}
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.loading && !list.data ? (
        <SkeletonLoader label="Loading the history" variant="rows" count={6} />
      ) : list.error ? (
        <ErrorState title="Couldn’t load the history" onRetry={list.retry}>
          {list.error}
        </ErrorState>
      ) : list.data && list.data.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nothing here yet">
          Placements, moves and steps will appear as they happen.
        </EmptyState>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {(list.data ?? []).map((h, i) => (
            <li
              key={`${i}:${h.at}:${h.kind}`}
              className="rounded-card border border-border bg-surface px-4 py-3 text-sm"
            >
              <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                {WHAT[h.kind] ?? h.kind}
                {h.person_name && <span>· {h.person_name}</span>}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-normal",
                    h.decided_by === "ai" ? "bg-info-soft text-info-text" : "bg-sunken text-muted",
                  )}
                >
                  {h.decided_by === "ai" ? (
                    <Bot className="size-3" aria-hidden="true" />
                  ) : (
                    <User className="size-3" aria-hidden="true" />
                  )}
                  {h.decided_by === "ai" ? "AI" : (h.by_user ?? "HR")}
                </span>
                <span className="ml-auto text-xs font-normal text-muted">
                  {formatDate(h.at.slice(0, 10))}
                </span>
              </p>
              {(h.from_project || h.to_project) && (
                <p className="m-0 text-xs text-muted">
                  {h.from_project ? `${h.from_project} → ` : ""}
                  {h.to_project ?? ""}
                </p>
              )}
              {h.reason && <p className="m-0 mt-1 text-xs">{h.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
