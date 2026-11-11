"use client";

import { Download, Plus, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/auth/AuthProvider";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api } from "@/lib/api";
import type { WKind } from "@/lib/api-types";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { AddPersonSheet } from "./AddPersonSheet";
import { ImportSheet } from "./ImportSheet";
import { PersonSheet } from "./PersonSheet";
import { PeopleTable, STATUS_FILTERS } from "./shared";

/** Everyone, as two lists: Staff and Labour. Filter by project, by step, or by name. */
export function PeopleScreen() {
  const canWrite = useUser().permissions.includes("employee:write");
  const linked = useSearchParams().get("worker");
  const [kind, setKind] = useState<WKind>("staff");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(linked);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const projects = useLoad(() => api.wProjects(), "w-projects");
  const list = useLoad(
    () => api.wPeople({ kind, project, status, q, limit: 300 }),
    `w-people:${kind}:${project}:${status}:${q}`,
  );
  const data = list.data;
  const counts = data?.by_status ?? {};
  const everyone = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">People</h1>
          <p className="m-0 text-sm text-muted">
            Staff and labour, and where each person is. Open one to move them or take them through
            offer, documents and joining.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} onClick={() => setImporting(true)}>
              <Download className="size-4" aria-hidden="true" />
              Import from Excel
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add person
            </button>
          </div>
        )}
      </header>

      <SlidingTabs
        label="Staff or labour"
        value={kind}
        onChange={(id) => {
          setKind(id as WKind);
          setStatus("");
        }}
        tabs={[
          { id: "staff", label: "Staff" },
          { id: "labour", label: "Labour" },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
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
        <label className="relative flex flex-col gap-1 text-xs font-medium text-muted">
          Search
          <Search
            className="pointer-events-none absolute bottom-2.5 left-2.5 size-4 text-subtle"
            aria-hidden="true"
          />
          <input
            className={cn(FIELD, "min-w-56 pl-8")}
            value={search}
            placeholder="Name, ID or designation"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div role="group" aria-label="Filter by step" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(([value, label]) => {
          const n = value === "" ? everyone : (counts[value] ?? 0);
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              className={cn(
                "press inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                status === value ? "bg-hover text-fg" : "bg-surface text-muted",
              )}
            >
              {label}
              <span className="tabular-nums text-subtle">{n}</span>
            </button>
          );
        })}
      </div>

      {list.loading && !data ? (
        <SkeletonLoader label="Loading people" variant="rows" count={8} />
      ) : list.error ? (
        <ErrorState title="Couldn’t load people" onRetry={list.retry}>
          {list.error}
        </ErrorState>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Users} title="No one matches">
          Try another project, or clear the search. {canWrite ? "You can also add a person." : ""}
        </EmptyState>
      ) : data ? (
        <>
          <PeopleTable
            items={data.items}
            showProject
            onOpen={setOpen}
            caption={kind === "staff" ? "Staff" : "Labour"}
          />
          <p className="m-0 text-xs text-muted">
            {data.items.length < data.total
              ? `Showing the first ${data.items.length} of ${data.total}. Use the filters to narrow it down.`
              : `${data.total} ${data.total === 1 ? "person" : "people"}`}
          </p>
        </>
      ) : null}

      <PersonSheet code={open} onClose={() => setOpen(null)} onChanged={list.retry} />
      <AddPersonSheet open={adding} onClose={() => setAdding(false)} onChanged={list.retry} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} onChanged={list.retry} />
    </div>
  );
}
