"use client";

import { ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { KanbanBoard } from "@/components/ui/KanbanBoard";
import { BUTTON, FIELD } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import { useAddress } from "@/lib/use-address";
import { useLoad } from "@/lib/use-load";
import { MobilizationCard } from "./MobilizationCard";
import { MobilizationSheet } from "./MobilizationSheet";
import { byStage, summaryLine } from "./stages";

function BoardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the pipeline"
      className="grid gap-4 lg:grid-cols-4"
    >
      {[0, 1, 2, 3].map((n) => (
        <div
          key={n}
          className="flex flex-col gap-3 rounded-card border border-border bg-sunken p-3"
        >
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-28 rounded-card" />
          <div className="skeleton h-28 rounded-card" />
        </div>
      ))}
    </div>
  );
}

/** Everyone being mobilized, by stage, and each person's checklist behind a click. */
export function MobilizationScreen() {
  const user = useUser();
  const canOpenRequests = user.permissions.includes("staffing:read");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [overdue, setOverdue] = useState(false);
  const address = useAddress();
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(address).get("mob"));
  const [version, setVersion] = useState(0); // goes up after every change made on the server
  const [banner, setBanner] = useState("");

  const list = useLoad(
    () => api.mobilizations({ q, project, overdue }),
    `${q}|${project}|${overdue}|${version}`,
  );
  const projects = useLoad(() => api.projects(), "projects");

  // The search box waits for a pause in typing before asking the API.
  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => setQ(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, q]);

  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${open ? `?mob=${encodeURIComponent(open)}` : ""}`,
    );
  }, [open]);

  const changed = useCallback((message?: string) => {
    if (message) setBanner(message);
    setVersion((v) => v + 1);
  }, []);

  const items = list.data?.items ?? [];
  const filtered = q !== "" || project !== "" || overdue;
  const openName = items.find((i) => i.mob_no === open)?.worker_name;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Mobilization</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {list.data ? summaryLine(items) : "Loading the pipeline"}
        </p>
      </header>

      {banner && (
        <p
          role="status"
          className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {banner}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search the pipeline"
            placeholder="Name, code, MOB number or project"
            className={`${FIELD} pl-9`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter by project"
          className={`${FIELD} w-auto! max-w-56`}
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">Every project</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
            className="size-4 accent-accent-hover"
          />
          Overdue only
        </label>
      </div>

      {list.error && !list.data ? (
        <ErrorState title="Couldn’t load the pipeline" onRetry={list.retry}>
          {list.error}
        </ErrorState>
      ) : list.loading ? (
        <BoardSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-card border border-border bg-surface">
          <EmptyState
            icon={ClipboardList}
            title={filtered ? "No one matches these filters" : "Nobody is being mobilized"}
            action={
              !filtered && canOpenRequests ? (
                <Link href="/requests" className={BUTTON}>
                  Open Allocation
                </Link>
              ) : undefined
            }
          >
            {filtered
              ? "Try a different search, project or turn off Overdue only."
              : "Approving a request line on the Allocation board starts a mobilization for each person."}
          </EmptyState>
        </div>
      ) : (
        <KanbanBoard
          label="Mobilization pipeline"
          columns={byStage(items)}
          keyOf={(row) => row.mob_no}
          renderCard={(row) => (
            <MobilizationCard
              row={row}
              selected={row.mob_no === open}
              onOpen={() => setOpen(row.mob_no)}
            />
          )}
        />
      )}

      <MobilizationSheet
        mobNo={open}
        fallbackName={openName}
        onClose={() => setOpen(null)}
        onChanged={changed}
      />
    </div>
  );
}
