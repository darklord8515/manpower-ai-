"use client";

import { ChevronDown, Plus, UserSearch } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api } from "@/lib/api";
import type { WKind } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { AddPersonSheet } from "./AddPersonSheet";

const FILTERS: [WKind | "", string][] = [
  ["", "All"],
  ["staff", "Staff"],
  ["labour", "Labour"],
];

/** Who is still to be hired, per role, with a simple table per project underneath. */
export function RecruitmentBoard() {
  const canWrite = useUser().permissions.includes("employee:write");
  const [kind, setKind] = useState<WKind | "">("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const board = useLoad(() => api.wBoard(kind || undefined), `w-board:${kind}`);
  const data = board.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Recruitment</h1>
          <p className="m-0 text-sm text-muted">
            How many people each role still needs. When someone is added to Staff or Labour, the
            number here goes down by itself.
          </p>
        </div>
        {canWrite && (
          <button type="button" className={PRIMARY_BUTTON} onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add person
          </button>
        )}
      </header>

      <div role="group" aria-label="Show" className="flex gap-2">
        {FILTERS.map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "press inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
              kind === value ? "bg-hover text-fg" : "bg-surface text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {board.loading && !data ? (
        <SkeletonLoader label="Loading recruitment" variant="rows" count={6} />
      ) : board.error ? (
        <ErrorState title="Couldn’t load recruitment" onRetry={board.retry}>
          {board.error}
        </ErrorState>
      ) : data && data.rows.length === 0 ? (
        <EmptyState icon={UserSearch} title="Nothing to hire">
          Every planned place has someone in it.
        </EmptyState>
      ) : data ? (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["To hire", data.totals.to_hire, "All open places"],
              ["Staff", data.totals.staff, "Open staff places"],
              ["Labour", data.totals.labour, "Open labour places"],
              ["Hire after moving", data.totals.hire, "If people who can move are moved first"],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-card border border-border bg-surface p-4">
                <p className="m-0 text-xs text-muted">{label}</p>
                <p className="m-0 text-2xl font-semibold tabular-nums">{value}</p>
                <p className="m-0 text-xs text-muted">{hint}</p>
              </div>
            ))}
          </section>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.rows.map((row) => {
              const id = `${row.kind}:${row.designation}`;
              const expanded = openRow === id;
              return (
                <li key={id} className="rounded-card border border-border bg-surface">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`panel-${id}`}
                    onClick={() => setOpenRow(expanded ? null : id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{row.designation}</span>
                      <span className="block text-xs text-muted">
                        {row.kind === "staff" ? "Staff" : "Labour"}
                        {row.department ? ` · ${row.department}` : ""}
                      </span>
                    </span>
                    <span className="hidden max-w-sm text-xs text-muted md:block">
                      {row.advice}
                    </span>
                    <span className="text-right">
                      <span className="block text-2xl font-semibold tabular-nums">
                        {row.to_hire}
                      </span>
                      <span className="block text-xs text-muted">to hire</span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted transition-transform",
                        expanded && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  {expanded && (
                    <div id={`panel-${id}`} className="border-t border-border p-4">
                      <p className="mt-0 mb-3 text-sm md:hidden">{row.advice}</p>
                      <div className="overflow-x-auto rounded-control border border-border">
                        <table className="w-full min-w-max border-collapse text-sm">
                          <caption className="sr-only">{row.designation} by project</caption>
                          <thead>
                            <tr className="bg-sunken text-left text-xs text-muted">
                              {[
                                "Project",
                                "Planned",
                                "Joined",
                                "On the way",
                                "To hire",
                                "Needed by",
                                "Recruit",
                              ].map((h) => (
                                <th key={h} scope="col" className="px-3 py-2 font-medium">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {row.projects.map((p) => (
                              <tr key={p.project_code} className="border-t border-border">
                                <td className="px-3 py-2 font-medium">{p.project_name}</td>
                                <td className="px-3 py-2 tabular-nums">{p.planned}</td>
                                <td className="px-3 py-2 tabular-nums">{p.active}</td>
                                <td className="px-3 py-2 tabular-nums">{p.pipeline}</td>
                                <td className="px-3 py-2 font-semibold tabular-nums">
                                  {p.to_hire}
                                </td>
                                <td className="px-3 py-2">
                                  {p.needed_by ? formatDate(p.needed_by) : "Not set"}
                                </td>
                                <td className="px-3 py-2">
                                  {p.source === "overseas"
                                    ? "Overseas"
                                    : p.source === "local"
                                      ? "Local"
                                      : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {canWrite && (
                        <div className="mt-3">
                          <button type="button" className={BUTTON} onClick={() => setAdding(true)}>
                            <Plus className="size-4" aria-hidden="true" />
                            Add a {row.designation}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <AddPersonSheet open={adding} onClose={() => setAdding(false)} onChanged={board.retry} />
    </div>
  );
}
