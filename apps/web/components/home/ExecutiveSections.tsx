"use client";

import {
  Building2,
  CircleCheck,
  FileWarning,
  Hourglass,
  LogOut,
  Sparkles,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { BUTTON } from "@/components/ui/button-styles";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { api, ApiError } from "@/lib/api";
import type { Brief, ExecProject, ExecutiveDashboard } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

const HEALTH: Record<ExecProject["health"], [string, Tone]> = {
  on_track: ["On track", "success"],
  needs_people: ["Needs people", "warning"],
  at_risk: ["At risk", "danger"],
  planning: ["Planning", "info"],
  done: ["Done", "neutral"],
};

function Bar({ value, of, label }: { value: number; of: number; label: string }) {
  const width = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <span
      role="img"
      aria-label={label}
      className="block h-2 overflow-hidden rounded-full bg-(--track)"
    >
      <span
        className="block h-full rounded-full bg-(--chart-strong) transition-[width] duration-(--dur-count) ease-out"
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={`${title} overview`} className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-md font-semibold">{title}</h2>
        {subtitle && <p className="m-0 text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function ProjectCard({ p, index }: { p: ExecProject; index: number }) {
  const [label, tone] = HEALTH[p.health];
  return (
    <Reveal index={index}>
      <Link
        href={`/projects/${p.code}`}
        className="block rounded-card border border-border bg-surface p-4 transition-colors hover:bg-hover"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 font-mono text-xs text-subtle">{p.code}</p>
            <p className="m-0 truncate font-semibold">{p.name}</p>
          </div>
          <StatusChip
            tone={tone}
            icon={p.health === "on_track" || p.health === "done" ? CircleCheck : TriangleAlert}
            label={label}
          />
        </div>
        <dl className="m-0 mt-3 flex flex-col gap-2 text-xs">
          <div>
            <dt className="mb-1 flex justify-between text-muted">
              <span>People</span>
              <span className="tabular-nums">
                {p.deployed} of {p.planned}
                {p.gap > 0 ? ` · ${p.gap} short` : ""}
              </span>
            </dt>
            <dd className="m-0">
              <Bar
                value={p.deployed}
                of={p.planned}
                label={`${p.code}: ${p.deployed} of ${p.planned} people`}
              />
            </dd>
          </div>
          {p.progress !== null && (
            <div>
              <dt className="mb-1 flex justify-between text-muted">
                <span>Time passed</span>
                <span className="tabular-nums">
                  {p.progress}%{p.ends ? ` · ends ${formatDate(p.ends)}` : ""}
                </span>
              </dt>
              <dd className="m-0">
                <Bar
                  value={p.progress}
                  of={100}
                  label={`${p.code}: ${p.progress}% of the time has passed`}
                />
              </dd>
            </div>
          )}
        </dl>
      </Link>
    </Reveal>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  href,
  tone,
}: {
  icon: typeof Hourglass;
  label: string;
  value: number;
  detail: string;
  href: string;
  tone?: "bad" | "warn";
}) {
  return (
    <Link
      href={href}
      className="rounded-card border border-border bg-surface p-4 transition-colors hover:bg-hover"
    >
      <p className="m-0 flex items-center gap-2 text-sm text-muted">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </p>
      <p
        className={cn(
          "m-0 mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad" && "text-danger-text",
          tone === "warn" && "text-warning-text",
        )}
      >
        {value}
      </p>
      <p className="m-0 mt-1 text-xs text-muted">{detail}</p>
    </Link>
  );
}

/** The weekly briefing: a few lines, written by AI from the numbers (or by Python without a model). */
export function Briefing() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write() {
    setBusy(true);
    setError(null);
    try {
      setBrief(await api.executiveBrief());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t write the briefing. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Briefing" className="rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-md font-semibold">
            <Sparkles className="size-4" aria-hidden="true" />
            Briefing
          </h2>
          <p className="m-0 text-xs text-muted">
            Where the company stands today, in a few lines. Every number comes from the system.
          </p>
        </div>
        <button type="button" onClick={write} disabled={busy} className={BUTTON}>
          {busy ? "Writing…" : brief ? "Write it again" : "Brief me"}
        </button>
      </div>
      <div aria-live="polite" className="mt-3">
        {busy && <SkeletonLoader label="Writing the briefing" variant="lines" count={3} />}
        {!busy && error && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {error}
          </p>
        )}
        {!busy && brief && (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {brief.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-(--chart-strong)"
                    aria-hidden="true"
                  />
                  {b}
                </li>
              ))}
            </ul>
            <p className="m-0 mt-3 text-xs text-subtle">
              {brief.ai_worded
                ? "Worded by AI and checked against the numbers"
                : "Worded by the system"}{" "}
              · {brief.as_of}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function HrMonitor({ d }: { d: ExecutiveDashboard }) {
  const { hr } = d;
  const maxStage = Math.max(1, ...hr.stages.map((s) => s.count));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        icon={TriangleAlert}
        label="Alerts in HR"
        value={hr.critical + hr.action_needed}
        detail={`${hr.critical} critical · ${hr.action_needed} need action`}
        href="/todo"
        tone={hr.critical > 0 ? "bad" : hr.action_needed > 0 ? "warn" : undefined}
      />
      <Stat
        icon={Hourglass}
        label="Approvals waiting"
        value={hr.approvals_waiting}
        detail={
          hr.oldest_wait_days !== null
            ? `Oldest waiting ${hr.oldest_wait_days} days`
            : "Nothing waiting"
        }
        href="/requests"
        tone={hr.approvals_waiting > 0 ? "warn" : undefined}
      />
      <Stat
        icon={FileWarning}
        label="Documents"
        value={hr.documents.expired + hr.documents.d30}
        detail={`${hr.documents.expired} expired · ${hr.documents.d30} in 30 days · ${hr.documents.d60} in 60`}
        href="/documents"
        tone={hr.documents.expired > 0 ? "bad" : undefined}
      />
      <Stat
        icon={LogOut}
        label="Leaving in 60 days"
        value={hr.leaving_soon}
        detail="People whose last day is close"
        href="/recruitment"
      />
      <div className="rounded-card border border-border bg-surface p-4 sm:col-span-2 lg:col-span-4">
        <p className="m-0 mb-3 flex items-center gap-2 text-sm font-medium">
          <UserPlus className="size-4 text-muted" aria-hidden="true" />
          Recruitment pipeline
          <span className="font-normal text-muted">
            {hr.recruitment_people} people across {hr.recruitment_open} requests
          </span>
        </p>
        {hr.stages.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nobody is being recruited right now.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-5">
            {hr.stages.map((s) => (
              <li key={s.stage} className="text-xs">
                <p className="m-0 mb-1 flex justify-between text-muted">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{s.count}</span>
                </p>
                <Bar value={s.count} of={maxStage} label={`${s.label}: ${s.count} people`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The MD's view: projects with their health, the HR department at a glance, and a briefing. */
export function ExecutiveSections() {
  const data = useLoad(() => api.executiveDashboard(), "executive");
  if (data.loading)
    return <SkeletonLoader label="Loading the company view" variant="rows" count={4} />;
  if (data.error || !data.data)
    return (
      <ErrorState title="Couldn’t load the company view" onRetry={data.retry}>
        {data.error}
      </ErrorState>
    );
  const d = data.data;
  const live = d.projects.filter((p) => p.health !== "done");
  return (
    <div className="flex flex-col gap-6">
      <Briefing />
      <Section
        title="Projects"
        subtitle={`${live.filter((p) => p.health === "at_risk").length} at risk · ${live.filter((p) => p.health === "needs_people").length} need people · ${live.length} in all`}
      >
        {live.length === 0 ? (
          <p className="m-0 flex items-center gap-2 text-sm text-muted">
            <Building2 className="size-4" aria-hidden="true" />
            No projects yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((p, i) => (
              <ProjectCard key={p.code} p={p} index={i} />
            ))}
          </div>
        )}
      </Section>
      <Section title="HR department" subtitle="What the HR team is working through">
        <HrMonitor d={d} />
      </Section>
    </div>
  );
}
