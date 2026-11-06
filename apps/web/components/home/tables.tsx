"use client";

import { Building2, CalendarClock, CircleAlert, TriangleAlert, UserCheck } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import type { ExpiringDocument, ProjectRow } from "@/lib/api-types";
import { DOCUMENT_NAME, timeLeft } from "@/lib/documents";
import { formatDate } from "@/lib/format";
const DUE_COLUMNS: Column<ExpiringDocument>[] = [
  {
    key: "worker",
    header: "Worker",
    cell: (d) => (
      <span className="font-medium">
        {d.worker_name} <span className="font-mono text-xs text-subtle">{d.worker_code}</span>
      </span>
    ),
  },
  { key: "type", header: "Document", cell: (d) => DOCUMENT_NAME[d.type] ?? d.type },
  { key: "expiry", header: "Expires", cell: (d) => formatDate(d.expiry) },
  {
    key: "left",
    header: "Time left",
    cell: (d) => {
      const { tone, label } = timeLeft(d.days_left);
      return (
        <StatusChip
          tone={tone}
          icon={tone === "danger" ? CircleAlert : CalendarClock}
          label={label}
        />
      );
    },
  },
  {
    key: "project",
    header: "Project",
    cell: (d) =>
      d.project ? (
        <span className="font-mono text-xs">{d.project}</span>
      ) : (
        <span className="text-subtle">None</span>
      ),
  },
];

export function DocumentsDue({ rows }: { rows: ExpiringDocument[] }) {
  return (
    <section
      aria-labelledby="due-title"
      className="h-full rounded-card border border-border bg-surface"
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4 md:px-5 md:pt-5">
        <div>
          <h2 id="due-title" className="text-base font-semibold">
            Documents to deal with first
          </h2>
          <p className="text-xs text-muted">Expired first, then the soonest to run out</p>
        </div>
        <Link
          href="/documents"
          className="text-xs text-accent-text underline-offset-2 hover:underline"
        >
          See all
        </Link>
      </div>
      <div className="mt-3">
        <DataTable
          caption="Documents to deal with first"
          columns={DUE_COLUMNS}
          rows={rows.slice(0, 5)}
          rowKey={(d) => `${d.worker_code}:${d.type}`}
          empty={
            <EmptyState icon={UserCheck} title="Nothing is running out">
              Every document is valid for more than 30 days.
            </EmptyState>
          }
          mobileCard={(d) => {
            const { tone, label } = timeLeft(d.days_left);
            return (
              <div className="flex flex-col gap-1 px-4 py-3 text-sm">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.worker_name}</span>
                  <StatusChip
                    tone={tone}
                    icon={tone === "danger" ? CircleAlert : CalendarClock}
                    label={label}
                  />
                </span>
                <span className="text-xs text-muted">
                  {DOCUMENT_NAME[d.type] ?? d.type} · {formatDate(d.expiry)} ·{" "}
                  {d.project ?? "No project"}
                </span>
              </div>
            );
          }}
        />
      </div>
    </section>
  );
}

const PROJECT_COLUMNS: Column<ProjectRow>[] = [
  {
    key: "project",
    header: "Project",
    cell: (p) => (
      <span className="font-medium">
        <span className="font-mono text-xs text-subtle">{p.code}</span> {p.name}
      </span>
    ),
  },
  { key: "deployed", header: "Deployed", align: "right", cell: (p) => p.deployed },
  { key: "planned", header: "Planned", align: "right", cell: (p) => p.planned },
  {
    key: "short",
    header: "Short by",
    align: "right",
    cell: (p) => {
      const short = Math.max(p.planned - p.deployed, 0);
      return short > 0 && p.status === "active" ? (
        <span className="font-semibold text-danger-text">{short}</span>
      ) : (
        <span className="text-subtle">—</span>
      );
    },
  },
  {
    key: "status",
    header: "Status",
    cell: (p) =>
      p.status === "planning" ? (
        <StatusChip tone="neutral" icon={CalendarClock} label="Planning" />
      ) : p.planned - p.deployed > 0 ? (
        <StatusChip tone="warning" icon={TriangleAlert} label="Short of people" />
      ) : (
        <StatusChip tone="success" icon={UserCheck} label="Fully staffed" />
      ),
  },
];

export function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  return (
    <section
      aria-labelledby="projects-title"
      className="h-full rounded-card border border-border bg-surface"
    >
      <div className="px-4 pt-4 md:px-5 md:pt-5">
        <h2 id="projects-title" className="text-base font-semibold">
          Projects
        </h2>
        <p className="text-xs text-muted">People on site against the plan</p>
      </div>
      <div className="mt-3">
        <DataTable
          caption="Projects"
          columns={PROJECT_COLUMNS}
          rows={projects}
          rowKey={(p) => p.code}
          empty={
            <EmptyState icon={Building2} title="No projects yet">
              Projects appear here once they are set up.
            </EmptyState>
          }
          mobileCard={(p) => (
            <div className="flex flex-col gap-1 px-4 py-3 text-sm">
              <span className="font-medium">
                <span className="font-mono text-xs text-subtle">{p.code}</span> {p.name}
              </span>
              <span className="text-xs text-muted">
                {p.deployed} of {p.planned} deployed
              </span>
            </div>
          )}
        />
      </div>
    </section>
  );
}
