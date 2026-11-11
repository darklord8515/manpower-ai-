"use client";

import { Building2, CalendarDays } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { api } from "@/lib/api";
import type { WCounts, WProject } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { Legend, STAGE_TONE, StackBar } from "./shared";

function Row({ label, c }: { label: string; c: WCounts }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 flex justify-between text-xs text-muted">
        <span className="font-medium text-fg">{label}</span>
        <span className="tabular-nums">
          {c.active} joined · {c.pipeline} on the way · {c.to_hire} to hire · planned {c.planned}
        </span>
      </p>
      <StackBar counts={c} scale={Math.max(c.planned, c.active + c.pipeline)} />
    </div>
  );
}

export function dateLine(p: Pick<WProject, "starts_on" | "ends_on">) {
  if (!p.starts_on && !p.ends_on) return "Dates not set yet";
  return `${p.starts_on ? formatDate(p.starts_on) : "Start not set"} to ${p.ends_on ? formatDate(p.ends_on) : "end not set"}`;
}

function Card({ p }: { p: WProject }) {
  return (
    <li>
      <Link
        href={`/projects/${p.code}`}
        className="press flex flex-col gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:bg-hover"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{p.name}</span>
          <StatusChip
            tone={STAGE_TONE[p.stage] ?? "neutral"}
            icon={CalendarDays}
            label={p.stage_label}
          />
        </span>
        <span className="text-xs text-muted">{dateLine(p)}</span>
        <Row label="Staff" c={p.staff} />
        <Row label="Labour" c={p.labour} />
      </Link>
    </li>
  );
}

/** Every project, with how full its staff and labour are. */
export function ProjectsList() {
  const list = useLoad(() => api.wProjects(), "w-projects");
  const projects = list.data?.filter((p) => p.kind === "project") ?? [];
  const groups = list.data?.filter((p) => p.kind !== "project") ?? [];
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="m-0 text-sm text-muted">
          How many people each project plans and has. Open one to see its staff and labour.
        </p>
      </header>
      <Legend />
      {list.loading && !list.data ? (
        <SkeletonLoader label="Loading projects" variant="rows" count={5} />
      ) : list.error ? (
        <ErrorState title="Couldn’t load projects" onRetry={list.retry}>
          {list.error}
        </ErrorState>
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState icon={Building2} title="No projects yet">
          Import the trackers from the People page to create them.
        </EmptyState>
      ) : (
        <>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
            {projects.map((p) => (
              <Card key={p.code} p={p} />
            ))}
          </ul>
          {groups.length > 0 && (
            <>
              <h2 className="m-0 text-md font-semibold">Head office and other groups</h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
                {groups.map((p) => (
                  <Card key={p.code} p={p} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
