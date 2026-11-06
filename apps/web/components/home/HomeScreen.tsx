"use client";

import {
  Building2,
  CalendarClock,
  CircleAlert,
  HardHat,
  TriangleAlert,
  UserCheck,
  Users,
} from "lucide-react";
import { useUser } from "@/components/auth/AuthProvider";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { KpiTile } from "@/components/ui/KpiTile";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import type { ExpiringDocument, ProjectRow, Summary } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { ExpiryChart, ProjectsChart, WorkforceDonut } from "./charts";
import { Hero } from "./Hero";
import { useHomeData } from "./useHomeData";

const ROLE_LABEL: Record<string, string> = {
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  ceo: "MD / CEO",
};

const DOCUMENT_NAME: Record<string, string> = {
  residency_visa: "Residency visa",
  medical_fitness: "Medical fitness",
  labour_card: "Labour card",
  passport: "Passport",
  work_permit: "Work permit",
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function timeLeft(days: number): { tone: Tone; label: string } {
  if (days < 0) return { tone: "danger", label: `Expired ${-days} d ago` };
  if (days <= 30) return { tone: "danger", label: `${days} d left` };
  if (days <= 60) return { tone: "warning", label: `${days} d left` };
  return { tone: "info", label: `${days} d left` };
}

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

function DocumentsDue({ rows }: { rows: ExpiringDocument[] }) {
  return (
    <section aria-labelledby="due-title" className="rounded-card border border-border bg-surface">
      <div className="px-4 pt-4 md:px-5 md:pt-5">
        <h2 id="due-title" className="text-base font-semibold">
          Documents to deal with first
        </h2>
        <p className="text-xs text-muted">Expired first, then the soonest to run out</p>
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

function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  return (
    <section
      aria-labelledby="projects-title"
      className="rounded-card border border-border bg-surface"
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

function HrKpis({ summary }: { summary: Summary }) {
  const { workforce, documents } = summary;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        label="Deployed"
        icon={HardHat}
        value={workforce.deployed}
        of={`of ${workforce.total}`}
        detail={`${plural(workforce.mobilizing, "person", "people")} mobilizing`}
      />
      <KpiTile
        label="Available now"
        icon={Users}
        value={workforce.available}
        detail="Free to assign"
      />
      <KpiTile
        label="Mobilizing"
        icon={CalendarClock}
        value={workforce.mobilizing}
        detail="Getting ready to start"
      />
      <KpiTile
        label="Documents running out"
        icon={TriangleAlert}
        value={documents.d30}
        detail={documents.expired ? `${documents.expired} already expired` : "In the next 30 days"}
      />
    </div>
  );
}

function CeoKpis({ summary }: { summary: Summary }) {
  const { workforce, documents, projects } = summary;
  const active = projects.filter((p) => p.status === "active");
  const shortProjects = active.filter((p) => p.planned > p.deployed).length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        label="Active projects"
        icon={Building2}
        value={active.length}
        detail={`${projects.length - active.length} in planning`}
      />
      <KpiTile
        label="Deployed"
        icon={HardHat}
        value={workforce.deployed}
        of={`of ${workforce.total}`}
        detail={`${workforce.available} available now`}
      />
      <KpiTile
        label="People short"
        icon={Users}
        value={summary.short_total}
        detail={`Across ${plural(shortProjects, "project")}`}
      />
      <KpiTile
        label="Documents need attention"
        icon={TriangleAlert}
        value={documents.expired + documents.d30}
        detail={`${documents.expired} expired, ${documents.d30} in 30 days`}
      />
    </div>
  );
}

function insightFor(isCeo: boolean, summary: Summary): string {
  const { documents } = summary;
  const docs = documents.d30 + documents.expired;
  const docText = docs
    ? `${plural(documents.d30, "document")} run out in the next 30 days${documents.expired ? `, and ${documents.expired} already have` : ""}.`
    : "No documents are running out in the next 30 days.";
  if (isCeo) {
    return summary.short_total
      ? `${plural(summary.short_total, "person", "people")} short across active projects. ${docText}`
      : `Every active project is fully staffed. ${docText}`;
  }
  return docText;
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="skeleton h-44 rounded-card md:h-52" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonLoader key={i} label="Loading figure" variant="tile" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="skeleton h-80 rounded-card lg:col-span-2" />
        <div className="skeleton h-80 rounded-card" />
      </div>
    </div>
  );
}

/** Home for HR (Manager and Executive) and the MD/CEO, on live data from the API. */
export function HomeScreen() {
  const user = useUser();
  const isCeo = user.landing === "executive";
  const { state, retry } = useHomeData(!isCeo);
  const roleLabel = ROLE_LABEL[user.roles[0] ?? ""] ?? "";

  if (state.status === "loading") {
    return (
      <>
        <Hero fullName={user.full_name} roleLabel={roleLabel} />
        <div className="mt-4">
          <HomeSkeleton />
        </div>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <Hero fullName={user.full_name} roleLabel={roleLabel} />
        <div className="mt-4 rounded-card border border-border bg-surface p-5">
          <ErrorState title="Couldn’t load Home" onRetry={retry}>
            {state.message}
          </ErrorState>
        </div>
      </>
    );
  }

  const { summary, due } = state.data;
  return (
    <div className="flex flex-col gap-4">
      <Hero fullName={user.full_name} roleLabel={roleLabel} insight={insightFor(isCeo, summary)} />
      {isCeo ? <CeoKpis summary={summary} /> : <HrKpis summary={summary} />}
      <div className="grid gap-4 lg:grid-cols-3">
        {isCeo ? (
          <ProjectsChart projects={summary.projects} className="lg:col-span-2" />
        ) : (
          <ExpiryChart weeks={summary.expiry_by_week} />
        )}
        <WorkforceDonut workforce={summary.workforce} />
      </div>
      {isCeo ? (
        <ProjectsTable projects={summary.projects} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DocumentsDue rows={due} />
          </div>
          <ProjectsChart projects={summary.projects} />
        </div>
      )}
    </div>
  );
}
