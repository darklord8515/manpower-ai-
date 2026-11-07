"use client";

import { CircleCheck, Info, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ChartCard } from "@/components/home/charts";
import type { Load } from "@/components/home/extra-widgets";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { ageText, lastRunText } from "@/lib/alerts";
import type { AlertSeverity, AlertSummary } from "@/lib/api-types";

const MORE = "text-xs text-accent-text underline-offset-2 hover:underline";

const SEVERITIES: { id: AlertSeverity; label: string; icon: LucideIcon; colour: string }[] = [
  { id: "critical", label: "Critical", icon: OctagonX, colour: "text-danger-text" },
  { id: "action_needed", label: "Action needed", icon: TriangleAlert, colour: "text-warning-text" },
  { id: "info", label: "Info", icon: Info, colour: "text-info-text" },
];

/** The three counts, each a link to the list filtered to that severity. */
function Counts({ summary, canOpen }: { summary: AlertSummary; canOpen: boolean }) {
  return (
    <ul className="m-0 mb-3 grid list-none grid-cols-3 gap-2 p-0">
      {SEVERITIES.map(({ id, label, icon: Icon, colour }) => {
        const body = (
          <>
            <span className={`flex items-center gap-1.5 text-xs ${colour}`}>
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </span>
            <span className="text-xl leading-7 font-semibold tabular-nums">
              {summary.counts[id]}
            </span>
          </>
        );
        return (
          <li key={id}>
            {canOpen ? (
              <Link
                href={`/todo?severity=${id}`}
                className="flex flex-col rounded-control border border-border px-3 py-2 transition-colors hover:bg-hover"
                aria-label={`${label}: ${summary.counts[id]}`}
              >
                {body}
              </Link>
            ) : (
              <div
                className="flex flex-col rounded-control border border-border px-3 py-2"
                aria-label={`${label}: ${summary.counts[id]}`}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading alerts">
      <div className="skeleton h-14 w-full" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-9 w-full" />
      ))}
    </div>
  );
}

/** HR's first look: how many alerts there are by severity, and the five most urgent. */
export function ActionCenter({ load, canOpen }: { load: Load<AlertSummary>; canOpen: boolean }) {
  const summary = load.data;
  return (
    <ChartCard
      title="Action Center"
      subtitle="What needs attention first"
      action={
        canOpen ? (
          <Link href="/todo" className={MORE}>
            Open To-do
          </Link>
        ) : undefined
      }
    >
      {load.loading ? (
        <Loading />
      ) : load.error && !summary ? (
        <ErrorState title="Couldn’t load" onRetry={load.retry}>
          {load.error}
        </ErrorState>
      ) : summary ? (
        <>
          <Counts summary={summary} canOpen={canOpen} />
          {summary.top.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Nothing needs attention">
              {lastRunText(summary.last_run)}
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {summary.top.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <SeverityChip severity={a.severity} />
                  {canOpen ? (
                    <Link
                      href={`/todo?alert=${a.id}`}
                      className="min-w-0 flex-1 basis-56 font-medium hover:underline hover:underline-offset-4"
                    >
                      {a.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 basis-56 font-medium">{a.title}</span>
                  )}
                  <span className="text-xs text-subtle">{ageText(a.raised_at, summary.now)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </ChartCard>
  );
}

/** The MD/CEO's tile: the same counts HR sees, each linking to the read-only list. */
export function AlertCounts({ load, canOpen }: { load: Load<AlertSummary>; canOpen: boolean }) {
  const summary = load.data;
  return (
    <ChartCard
      title="Open alerts"
      subtitle="By severity"
      action={
        canOpen ? (
          <Link href="/todo" className={MORE}>
            Open the list
          </Link>
        ) : undefined
      }
    >
      {load.loading ? (
        <Loading />
      ) : load.error && !summary ? (
        <ErrorState title="Couldn’t load" onRetry={load.retry}>
          {load.error}
        </ErrorState>
      ) : summary ? (
        <>
          <Counts summary={summary} canOpen={canOpen} />
          <p className="m-0 text-xs text-muted">{lastRunText(summary.last_run)}</p>
        </>
      ) : null}
    </ChartCard>
  );
}
