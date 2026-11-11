"use client";

import { CalendarClock, TriangleAlert, Truck } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api } from "@/lib/api";
import type { WKind, WMobilizationPerson } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { PersonSheet } from "./PersonSheet";
import { messageOf } from "./shared";

/**
 * People on the way, in three columns: offer issued, documents cleared, can join. Beside every name is
 * the date HR expects them to join, which HR can change at any time. "Can join" is someone whose
 * documents are cleared and who has a date. Joining takes them off the board and into People.
 */
export function MobilizationBoard() {
  const canWrite = useUser().permissions.includes("employee:write");
  const [project, setProject] = useState("");
  const [kind, setKind] = useState<WKind | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const projects = useLoad(() => api.wProjects(), "w-projects");
  const board = useLoad(
    () => api.wMobilization(project || undefined, kind || undefined),
    `w-mobilization:${project}:${kind}`,
  );
  const data = board.data;

  async function run(code: string, job: () => Promise<string>) {
    setWorking(code);
    setProblem(null);
    try {
      setNotice(await job());
      board.retry();
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setWorking(null);
    }
  }

  const setDate = (p: WMobilizationPerson, value: string) =>
    run(p.code, async () => {
      await api.wSetJoinDate(p.code, value || null);
      return value
        ? `${p.name} is expected to join on ${formatDate(value)}.`
        : `${p.name}’s joining date was cleared.`;
    });

  const advance = (p: WMobilizationPerson) =>
    run(p.code, async () => {
      const to = p.status === "offer_issued" ? "documents_cleared" : "active";
      await api.wMilestone(p.code, to);
      return to === "active" ? `${p.name} has joined.` : `${p.name}’s documents are cleared.`;
    });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Mobilization</h1>
        <p className="m-0 text-sm text-muted">
          People on the way: offer issued, documents cleared, then can join. Set the date each
          person is expected to join; it becomes their joining date when you mark them as joined.
        </p>
      </header>

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
        <div role="group" aria-label="Show" className="flex gap-2">
          {(
            [
              ["", "Staff and labour"],
              ["staff", "Staff"],
              ["labour", "Labour"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "press inline-flex h-9 items-center rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                kind === value ? "bg-hover text-fg" : "bg-surface text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {notice}
        </p>
      )}
      {problem && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}
      {data && data.late > 0 && (
        <p className="m-0 flex items-center gap-2 text-sm text-warning-text">
          <TriangleAlert className="size-4" aria-hidden="true" />
          {data.late} {data.late === 1 ? "person's" : "people's"} expected joining date has passed.
        </p>
      )}

      {board.loading && !data ? (
        <SkeletonLoader label="Loading mobilization" variant="rows" count={6} />
      ) : board.error ? (
        <ErrorState title="Couldn’t load mobilization" onRetry={board.retry}>
          {board.error}
        </ErrorState>
      ) : data && data.total === 0 ? (
        <EmptyState icon={Truck} title="Nobody is on the way">
          People appear here when they are added with an offer issued.
        </EmptyState>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {data.columns.map((col) => (
            <section
              key={col.id}
              aria-label={col.label}
              className="flex flex-col gap-3 rounded-card border border-border bg-sunken p-3"
            >
              <header>
                <h2 className="m-0 flex items-center justify-between text-sm font-semibold">
                  {col.label}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs tabular-nums">
                    {col.people.length}
                  </span>
                </h2>
                <p className="m-0 text-xs text-muted">{col.hint}</p>
              </header>
              {col.people.length === 0 ? (
                <p className="m-0 rounded-control bg-surface p-3 text-sm text-muted">
                  Nobody here.
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {col.people.map((p) => (
                    <li
                      key={p.code}
                      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setOpen(p.code)}
                            className="block text-left font-medium hover:underline"
                          >
                            {p.name}
                          </button>
                          <span className="block truncate text-xs text-muted">
                            {p.designation} · {p.project_name ?? "Not placed"}
                          </span>
                        </span>
                        {p.late && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-text">
                            <CalendarClock className="size-3" aria-hidden="true" />
                            Date passed
                          </span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-0.5 text-xs text-muted">
                          Expected to join
                          {canWrite ? (
                            <input
                              type="date"
                              className={cn(FIELD, "w-40")}
                              aria-label={`Expected joining date for ${p.name}`}
                              defaultValue={p.expected_join_on ?? ""}
                              key={`${p.code}:${p.expected_join_on ?? ""}`}
                              disabled={working === p.code}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              onBlur={(e) => {
                                if (e.target.value !== (p.expected_join_on ?? ""))
                                  void setDate(p, e.target.value);
                              }}
                            />
                          ) : (
                            <span className="text-sm text-fg">
                              {p.expected_join_on ? formatDate(p.expected_join_on) : "Not set"}
                            </span>
                          )}
                        </label>
                        {canWrite && (
                          <button
                            type="button"
                            className={p.status === "offer_issued" ? BUTTON : PRIMARY_BUTTON}
                            disabled={working === p.code}
                            onClick={() => void advance(p)}
                          >
                            {p.status === "offer_issued" ? "Documents cleared" : "Mark as joined"}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}

      <PersonSheet code={open} onClose={() => setOpen(null)} onChanged={board.retry} />
    </div>
  );
}
