"use client";

import {
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  FileWarning,
  HardHat,
  Inbox,
  Search,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AiAnswerCard, type TraceStep } from "@/components/ui/AiAnswerCard";
import { AlertList, type AlertView } from "@/components/ui/AlertCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { InsightLine } from "@/components/ui/InsightLine";
import { KpiTile } from "@/components/ui/KpiTile";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { formatDate } from "@/lib/format";
import { MotionDemo } from "./MotionDemo";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  SAMPLE_ALERTS,
  SAMPLE_EXCLUDED,
  SAMPLE_STEPS,
  SAMPLE_WORKERS,
  type SampleWorker,
} from "./sample-data";

const BUTTON =
  "press inline-flex h-8 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium transition-[transform,background-color] duration-120 hover:bg-hover";
const BUTTON_PRIMARY =
  "press inline-flex h-8 items-center justify-center gap-2 rounded-control border border-accent bg-accent px-3 text-sm font-medium text-accent-on transition-[transform,background-color,border-color] duration-120 hover:border-accent-hover hover:bg-accent-hover";

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="text-md font-semibold">
          {title}
        </h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const CHIP_STATES: { tone: Tone; icon: typeof Inbox; label: string }[] = [
  { tone: "neutral", icon: Inbox, label: "Open" },
  { tone: "info", icon: CircleDot, label: "In progress" },
  { tone: "success", icon: CheckCircle2, label: "Resolved" },
];

type TableMode = "data" | "loading" | "empty" | "error";

export function GalleryClient() {
  const reduced = usePrefersReducedMotion();

  // KPI demo: approving a request changes the numbers and they count to the new values.
  const [approved, setApproved] = useState(false);
  const [kpiLoading, setKpiLoading] = useState(false);

  // Chip demo
  const [chipIndex, setChipIndex] = useState(0);

  // Alerts demo
  const [alerts, setAlerts] = useState<AlertView[]>(SAMPLE_ALERTS);
  const [sheetAlert, setSheetAlert] = useState<AlertView | null>(null);
  const counts = useMemo(
    () => ({
      critical: alerts.filter((a) => a.severity === "critical").length,
      action_needed: alerts.filter((a) => a.severity === "action_needed").length,
      info: alerts.filter((a) => a.severity === "info").length,
    }),
    [alerts],
  );

  // Agent demo: steps arrive one by one, like the agent's real tool calls completing.
  const [steps, setSteps] = useState<TraceStep[]>(SAMPLE_STEPS);
  const [pending, setPending] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [agentDone, setAgentDone] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function runAgent() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSteps([]);
    setAgentDone(false);
    setRunning(true);
    const gap = reduced ? 0 : 420;
    SAMPLE_STEPS.forEach((step, i) => {
      timers.current.push(setTimeout(() => setPending(step.title), i * gap));
      timers.current.push(setTimeout(() => setSteps((s) => [...s, step]), i * gap + gap * 0.8));
    });
    timers.current.push(
      setTimeout(
        () => {
          setPending(undefined);
          setRunning(false);
          setAgentDone(true);
        },
        SAMPLE_STEPS.length * gap + 50,
      ),
    );
  }

  // Table demo
  const [mode, setMode] = useState<TableMode>("data");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const columns: Column<SampleWorker>[] = [
    {
      key: "name",
      header: "Worker",
      sortValue: (w) => w.name,
      cell: (w) => (
        <span className="font-medium">
          {w.name} <span className="font-mono text-xs text-subtle">{w.code}</span>
        </span>
      ),
    },
    { key: "trade", header: "Trade", sortValue: (w) => w.trade, cell: (w) => w.trade },
    {
      key: "level",
      header: "Level",
      align: "right",
      sortValue: (w) => w.level,
      cell: (w) => w.level,
    },
    { key: "available", header: "Availability", cell: (w) => w.available },
    {
      key: "docs",
      header: "Docs valid until",
      sortValue: (w) => w.docsUntil,
      cell: (w) => formatDate(w.docsUntil),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-360 flex-col gap-8 px-4 pb-16 md:px-6">
      <header className="flex h-14 items-center gap-3 border-b border-border">
        <h1 className="text-md font-semibold">Design system gallery</h1>
        <span className="rounded-full border border-border px-2 text-xs leading-5 text-muted">
          Development only
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <InsightLine href="/gallery#alerts" linkLabel="Open alerts">
        3 projects short of welders by 12 Feb
      </InsightLine>

      <Section
        id="kpi"
        title="KpiTile"
        note="Counts up on first load, and from the old value to the new one when data changes."
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON_PRIMARY} onClick={() => setApproved((v) => !v)}>
            <ClipboardCheck className="size-4" aria-hidden="true" />
            {approved ? "Undo approval" : "Simulate approval"}
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => setKpiLoading((v) => !v)}
            aria-pressed={kpiLoading}
          >
            {kpiLoading ? "Show data" : "Show loading"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpiLoading ? (
            Array.from({ length: 4 }, (_, i) => (
              <SkeletonLoader key={i} label="Loading figure" variant="tile" />
            ))
          ) : (
            <>
              <KpiTile
                label="Deployed"
                icon={HardHat}
                value={approved ? 120 : 112}
                of="of 150"
                trend="+6 this week"
                detail={`${approved ? 17 : 9} mobilizing`}
              />
              <KpiTile
                label="Available"
                icon={Users}
                value={approved ? 13 : 21}
                detail="Free to assign"
              />
              <KpiTile
                label="Pending approvals"
                icon={ClipboardCheck}
                value={approved ? 2 : 3}
                detail="1 due today"
              />
              <KpiTile
                label="Doc compliance"
                icon={FileWarning}
                value={94.7}
                format="percent"
                detail="8 documents expire within 30 days"
              />
            </>
          )}
        </div>
      </Section>

      <Section
        id="chips"
        title="StatusChip and SeverityChip"
        note="Icon + label + colour, never colour alone. The label cross-fades when the state changes."
      >
        <div className="flex flex-wrap items-center gap-3">
          {(["success", "warning", "danger", "info", "neutral"] as Tone[]).map((tone) => (
            <StatusChip
              key={tone}
              tone={tone}
              icon={tone === "danger" ? TriangleAlert : CheckCircle2}
              label={tone[0].toUpperCase() + tone.slice(1)}
            />
          ))}
          <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
          <SeverityChip severity="critical" />
          <SeverityChip severity="action_needed" />
          <SeverityChip severity="info" />
        </div>
        <div className="flex items-center gap-3">
          <StatusChip {...CHIP_STATES[chipIndex]} />
          <button
            type="button"
            className={BUTTON}
            onClick={() => setChipIndex((i) => (i + 1) % CHIP_STATES.length)}
          >
            Change state
          </button>
        </div>
      </Section>

      <Section
        id="alerts"
        title="AlertCard"
        note="Resolving an alert collapses it, and every counter updates with it."
      >
        <div className="rounded-card border border-border bg-surface">
          <div
            className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 text-sm"
            aria-live="polite"
          >
            <span className="font-semibold">Action Center</span>
            <span data-testid="count-critical" className="inline-flex items-center gap-1">
              <SeverityChip severity="critical" /> {counts.critical}
            </span>
            <span data-testid="count-action" className="inline-flex items-center gap-1">
              <SeverityChip severity="action_needed" /> {counts.action_needed}
            </span>
            <span data-testid="count-info" className="inline-flex items-center gap-1">
              <SeverityChip severity="info" /> {counts.info}
            </span>
            <button
              type="button"
              className={`${BUTTON} ml-auto`}
              onClick={() => setAlerts(SAMPLE_ALERTS)}
            >
              Reset alerts
            </button>
          </div>
          {alerts.length > 0 ? (
            <AlertList
              label="Open alerts"
              alerts={alerts}
              onOpen={setSheetAlert}
              onResolve={(alert) => setAlerts((list) => list.filter((a) => a.id !== alert.id))}
            />
          ) : (
            <EmptyState icon={CheckCircle2} title="No open alerts">
              Detectors last ran at 07:00. New problems appear here as soon as a detector finds
              them.
            </EmptyState>
          )}
        </div>
      </Section>

      <Section
        id="agent"
        title="AiAnswerCard"
        note="Steps appear one by one as the agent's tool calls complete, then the answer, then a collapsed Trace."
      >
        <div>
          <button type="button" className={BUTTON_PRIMARY} onClick={runAgent} disabled={running}>
            {running ? "Agent is working…" : "Ask Workforce Agent"}
          </button>
        </div>
        <AiAnswerCard
          agent="Workforce Agent"
          tier="mid"
          steps={steps}
          pending={pending}
          running={running}
          summary={
            agentDone ? "8 cleared, 2 excluded for 8 × steel fixer from 8 Nov 2026." : undefined
          }
          excluded={SAMPLE_EXCLUDED}
          why={
            <>
              <b className="font-medium text-fg">Why:</b> ranked by availability, verified level and
              history on this project. Every worker was checked by the rules engine, not the model.
            </>
          }
          actions={
            <button type="button" className={BUTTON_PRIMARY}>
              Review on Allocation board
            </button>
          }
        >
          <ul className="m-0 list-none p-0">
            {SAMPLE_WORKERS.slice(0, 3).map((w) => (
              <li
                key={w.code}
                className="flex items-center gap-3 border-t border-border px-4 py-2 text-sm"
              >
                <span className="font-medium">{w.name}</span>
                <span className="font-mono text-xs text-subtle">{w.code}</span>
                <span className="ml-auto text-xs text-muted">Level {w.level}</span>
              </li>
            ))}
          </ul>
        </AiAnswerCard>
      </Section>

      <Section
        id="table"
        title="DataTable"
        note="Sort by clicking a header. Loading, empty and error states are part of the table."
      >
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Table state"
            className="inline-flex overflow-hidden rounded-control border border-border"
          >
            {(["data", "loading", "empty", "error"] as TableMode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className="h-7 px-3 text-xs text-muted not-first:border-l not-first:border-border aria-pressed:bg-sunken aria-pressed:font-medium aria-pressed:text-fg"
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <span className="text-xs text-muted">{selected.size} selected</span>
          )}
        </div>
        <div className="rounded-card border border-border bg-surface">
          <DataTable
            caption="Available steel fixers"
            columns={columns}
            rows={mode === "empty" ? [] : SAMPLE_WORKERS}
            rowKey={(w) => w.code}
            loading={mode === "loading"}
            error={
              mode === "error"
                ? {
                    message:
                      "The API didn’t answer. On free hosting it sleeps after 15 minutes and takes about a minute to wake.",
                    onRetry: () => setMode("data"),
                  }
                : undefined
            }
            empty={
              <EmptyState
                icon={Search}
                title="No candidates match these filters"
                action={
                  <button type="button" className={BUTTON} onClick={() => setMode("data")}>
                    Clear filters
                  </button>
                }
              >
                Lower the level, include people available later, or clear the filters.
              </EmptyState>
            }
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            mobileCard={(w) => (
              <div className="flex flex-col gap-1 px-4 py-3 text-sm">
                <span className="font-medium">
                  {w.name} <span className="font-mono text-xs text-subtle">{w.code}</span>
                </span>
                <span className="text-xs text-muted">
                  {w.trade} · level {w.level} · {w.available} · docs to {formatDate(w.docsUntil)}
                </span>
              </div>
            )}
          />
        </div>
      </Section>

      <Section
        id="motion"
        title="Motion primitives"
        note="Transform and opacity only, 120–200ms, off under reduced motion. Each demo shows one behaviour."
      >
        <MotionDemo />
      </Section>

      <Section id="states" title="EmptyState, ErrorState, SkeletonLoader">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-card border border-border bg-surface">
            <EmptyState icon={Inbox} title="Nothing waiting">
              New requests from project managers appear here as soon as they are submitted.
            </EmptyState>
          </div>
          <div className="rounded-card border border-border bg-surface p-5">
            <ErrorState title="Couldn’t load requests" onRetry={() => undefined}>
              The API didn’t answer. Try again in a moment.
            </ErrorState>
          </div>
          <div className="rounded-card border border-border bg-surface p-5">
            <SkeletonLoader label="Loading requests" count={4} />
          </div>
        </div>
      </Section>

      <DetailSheet
        open={sheetAlert !== null}
        onOpenChange={(open) => !open && setSheetAlert(null)}
        title={sheetAlert?.title ?? "Alert"}
        meta={
          sheetAlert && (
            <>
              <SeverityChip severity={sheetAlert.severity} />
              <span className="font-mono">{sheetAlert.id}</span>
              <span>{sheetAlert.project ?? "Company-wide"}</span>
            </>
          )
        }
        footer="Resolving here updates the Action Center and the counters behind this sheet."
      >
        <p className="text-sm">
          Detectors raised this from the facts below. Every number was checked against them.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-xs text-muted">Raised</dt>
          <dd>{sheetAlert?.raised}</dd>
          <dt className="text-xs text-muted">Assignee</dt>
          <dd>{sheetAlert?.assignee ?? "HR team"}</dd>
        </dl>
        <div>
          <button
            type="button"
            className={BUTTON_PRIMARY}
            onClick={() => {
              if (!sheetAlert) return;
              setAlerts((list) => list.filter((a) => a.id !== sheetAlert.id));
              setSheetAlert(null);
            }}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Mark resolved
          </button>
        </div>
      </DetailSheet>
    </div>
  );
}
