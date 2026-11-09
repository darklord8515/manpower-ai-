"use client";

import {
  Building2,
  CalendarClock,
  CalendarRange,
  CircleCheck,
  Clock,
  Plus,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { ProjectRow } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AddProjectSheet } from "./AddProjectSheet";
import { EditDatesSheet } from "./EditDatesSheet";
import { rememberAdded } from "./just-added";

const STATUS: Record<string, { tone: Tone; icon: typeof Clock; label: string }> = {
  planning: { tone: "info", icon: CalendarClock, label: "Planning" },
  active: { tone: "success", icon: CircleCheck, label: "Active" },
  on_hold: { tone: "warning", icon: Clock, label: "On hold" },
  completed: { tone: "neutral", icon: CircleCheck, label: "Completed" },
  cancelled: { tone: "neutral", icon: Clock, label: "Cancelled" },
};

function ProjectStatus({ status }: { status: string }) {
  const { tone, icon, label } = STATUS[status] ?? STATUS.planning;
  return <StatusChip tone={tone} icon={icon} label={label} />;
}

const dates = (p: ProjectRow) =>
  p.starts && p.ends ? `${formatDate(p.starts)} to ${formatDate(p.ends)}` : "Dates not set";

function Staffing({ p }: { p: ProjectRow }) {
  if (p.status === "planning") return <span className="text-muted">{p.planned} needed</span>;
  const short = Math.max(p.planned - p.deployed, 0);
  return (
    <span>
      {p.deployed} of {p.planned}
      {short > 0 && <span className="ml-2 font-semibold text-danger-text">{short} short</span>}
    </span>
  );
}

export function ProjectsScreen() {
  const user = useUser();
  const router = useRouter();
  const canAdd = user.permissions.includes("project:write");
  const canForecast = user.permissions.includes("forecast:read");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const projects = useLoad(() => api.projects(), "projects");
  const trades = useLoad(() => api.trades(), "trades");
  const [added, setAdded] = useState("");

  const rows = projects.data ?? [];
  const planning = rows.filter((p) => p.status === "planning").length;

  const columns: Column<ProjectRow>[] = [
    {
      key: "project",
      header: "Project",
      cell: (p) => (
        <Link
          href={`/projects/${p.code}`}
          className="font-medium underline-offset-2 hover:underline"
          aria-label={`Open the ${p.name} overview`}
        >
          <span className="font-mono text-xs text-subtle">{p.code}</span> {p.name}
        </Link>
      ),
    },
    { key: "status", header: "Status", cell: (p) => <ProjectStatus status={p.status} /> },
    { key: "dates", header: "Dates", cell: (p) => <span className="text-muted">{dates(p)}</span> },
    { key: "staffing", header: "Workers", cell: (p) => <Staffing p={p} /> },
    ...(canForecast
      ? [
          {
            key: "forecast",
            header: "",
            align: "right" as const,
            cell: (p: ProjectRow) => (
              <Link href={`/projects/${p.code}/forecast`} className={BUTTON}>
                <TrendingUp className="size-4" aria-hidden="true" />
                Forecast
              </Link>
            ),
          },
        ]
      : []),
    ...(canAdd
      ? [
          {
            key: "dates",
            header: "",
            align: "right" as const,
            cell: (p: ProjectRow) =>
              p.status === "completed" || p.status === "cancelled" ? null : (
                <button
                  type="button"
                  className={BUTTON}
                  aria-label={`Change dates of ${p.code}`}
                  onClick={() => setEditing(p)}
                >
                  <CalendarRange className="size-4" aria-hidden="true" />
                  Change dates
                </button>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {projects.data
              ? `${rows.length} ${rows.length === 1 ? "project" : "projects"}${planning ? `, ${planning} in planning` : ""}`
              : "Loading projects"}
          </p>
        </div>
        {canAdd && (
          <button
            type="button"
            className={PRIMARY_BUTTON}
            onClick={() => setAdding(true)}
            disabled={!trades.data}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add project
          </button>
        )}
      </header>

      {added && (
        <p
          role="status"
          className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {added}
        </p>
      )}

      <section aria-label="Projects" className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Projects"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.code}
          loading={projects.loading}
          error={projects.error ? { message: projects.error, onRetry: projects.retry } : undefined}
          empty={
            <EmptyState
              icon={Building2}
              title="No projects yet"
              action={
                canAdd ? (
                  <button type="button" className={PRIMARY_BUTTON} onClick={() => setAdding(true)}>
                    <Plus className="size-4" aria-hidden="true" />
                    Add project
                  </button>
                ) : undefined
              }
            >
              Add the first project to plan who works on it.
            </EmptyState>
          }
          mobileCard={(p) => (
            <div className="flex flex-col gap-1.5 px-4 py-3 text-sm">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  <span className="font-mono text-xs text-subtle">{p.code}</span> {p.name}
                </span>
                <ProjectStatus status={p.status} />
              </span>
              <span className="text-xs text-muted">{dates(p)}</span>
              <span className="text-xs">
                <Staffing p={p} />
              </span>
              {canForecast && (
                <Link href={`/projects/${p.code}/forecast`} className={`${BUTTON} self-start`}>
                  <TrendingUp className="size-4" aria-hidden="true" />
                  Forecast
                </Link>
              )}
              {canAdd && p.status !== "completed" && p.status !== "cancelled" && (
                <button
                  type="button"
                  className={`${BUTTON} self-start`}
                  aria-label={`Change dates of ${p.code}`}
                  onClick={() => setEditing(p)}
                >
                  <CalendarRange className="size-4" aria-hidden="true" />
                  Change dates
                </button>
              )}
            </div>
          )}
        />
      </section>

      {canAdd && (
        <EditDatesSheet
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={(project) => {
            setEditing(null);
            setAdded(
              `${project.code} now runs from ${formatDate(project.starts ?? "")} to ${formatDate(project.ends ?? "")}.`,
            );
            projects.retry();
          }}
        />
      )}

      {canAdd && trades.data && (
        <AddProjectSheet
          open={adding}
          onClose={() => setAdding(false)}
          trades={trades.data}
          onCreated={(project) => {
            setAdding(false);
            setAdded(`${project.code} ${project.name} was added.`);
            rememberAdded(project.code);
            if (canForecast) router.push(`/projects/${project.code}/forecast`);
            else projects.retry();
          }}
        />
      )}
    </div>
  );
}
