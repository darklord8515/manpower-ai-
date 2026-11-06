"use client";

import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Link2,
  RotateCcw,
  UserPlus,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { BUTTON, FIELD } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { Advice, ProjectForecast, TradeForecast } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { forgetAdded, wasJustAdded } from "./just-added";

const VERDICT: Record<
  Advice["verdict"],
  { tone: Tone; icon: typeof Clock; label: (a: Advice) => string }
> = {
  covered: { tone: "success", icon: CircleCheck, label: () => "Covered" },
  covered_with_dependencies: {
    tone: "info",
    icon: Link2,
    label: () => "Covered, depends on others",
  },
  recruitment_pending: { tone: "info", icon: Clock, label: () => "Recruiting" },
  recruit: { tone: "danger", icon: UserPlus, label: (a) => `Recruit ${a.recruit_count}` },
};

const REASON: Record<string, string> = {
  on_leave: "On leave",
  documents: "Documents",
  already_reserved: "Already planned elsewhere",
  unavailable: "Not available",
};

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`m-0 text-lg font-semibold tabular-nums ${danger ? "text-danger-text" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function People({
  trade,
  start,
  bufferDays,
}: {
  trade: TradeForecast;
  start: string;
  bufferDays: number;
}) {
  const free = trade.sources.filter((s) => s.kind === "available_now");
  const ending = trade.sources.filter((s) => s.kind === "ending_before_start");
  const total = trade.deployable + trade.late_candidates.length + trade.excluded.length;
  if (total === 0)
    return <p className="m-0 text-sm text-muted">Nobody with this trade is on file.</p>;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {free.map((s) => (
        <section key="free" aria-label="Free now">
          <h4 className="m-0 mb-1 text-sm font-semibold">Free now ({s.workers.length})</h4>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-muted">
            {s.workers.map((w) => (
              <li key={w.code}>
                {w.name} <span className="font-mono text-xs text-subtle">{w.code}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ending.map((s) => (
        <section key={`${s.project_code}:${s.ends_on}`} aria-label={`From ${s.project_code}`}>
          <h4 className="m-0 mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
            From {s.project_code}, last day {s.ends_on ? formatDate(s.ends_on) : ""} (
            {s.workers.length})
            {s.must_finish_by && (
              <StatusChip
                tone="warning"
                icon={Link2}
                label={`depends on ${s.project_code} finishing by ${formatDate(s.must_finish_by)}`}
              />
            )}
          </h4>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-muted">
            {s.workers.map((w) => (
              <li key={w.code}>
                {w.name} <span className="font-mono text-xs text-subtle">{w.code}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {trade.late_candidates.length > 0 && (
        <section aria-label="Could join late">
          <h4 className="m-0 mb-1 text-sm font-semibold">
            Could join late ({trade.late_candidates.length})
          </h4>
          <p className="m-0 mb-2 text-xs text-muted">
            Not counted above. They finish on another project just inside the {bufferDays}-day
            handover buffer, or shortly after {formatDate(start)}. You decide.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {trade.late_candidates.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {c.name} <span className="font-mono text-xs text-subtle">{c.code}</span>
                </span>
                <span className="text-xs text-muted">
                  {c.project_code}, last day {formatDate(c.ends_on)}
                </span>
                <StatusChip
                  tone="warning"
                  icon={CalendarClock}
                  label={
                    c.days_after_start < 0
                      ? `${-c.days_after_start} d before the start (inside the buffer)`
                      : c.days_after_start === 0
                        ? "last day is the start"
                        : `${c.days_after_start} d after the start`
                  }
                />
                {!c.documents_valid && (
                  <StatusChip tone="danger" icon={CircleAlert} label="documents end early" />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {trade.excluded.length > 0 && (
        <section aria-label="Not counted">
          <h4 className="m-0 mb-1 text-sm font-semibold">Not counted ({trade.excluded.length})</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-muted">
            {trade.excluded.map((e) => (
              <li key={e.code}>
                {e.name} <span className="font-mono text-xs text-subtle">{e.code}</span>
                {": "}
                <span className="font-medium text-fg">{REASON[e.reason]}</span>, {e.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TradeCard({ trade, forecast }: { trade: TradeForecast; forecast: ProjectForecast }) {
  const [open, setOpen] = useState(false);
  const verdict = VERDICT[trade.advice.verdict];
  const id = `trade-${trade.trade_code}`;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-card border border-border bg-surface p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="m-0 text-base font-semibold">
          {trade.trade}
        </h3>
        <StatusChip tone={verdict.tone} icon={verdict.icon} label={verdict.label(trade.advice)} />
      </div>
      <dl className="m-0 mt-3 grid grid-cols-3 gap-4 sm:grid-cols-5">
        <Stat label="Needed" value={trade.needed} />
        <Stat label="Already assigned" value={trade.already_assigned} />
        <Stat label="Deployable" value={trade.deployable} />
        <Stat label="Recruitment pending" value={trade.recruitment_pending} />
        <Stat label="Gap" value={trade.gap} danger={trade.gap > 0} />
      </dl>
      <p className="m-0 mt-3 text-sm">{trade.advice.headline}</p>
      <button
        type="button"
        className={`${BUTTON} mt-3`}
        aria-expanded={open}
        aria-controls={`${id}-people`}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          className={`size-4 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        {open ? "Hide people" : "Show people"}
      </button>
      {open && (
        <div id={`${id}-people`} className="mt-3 border-t border-border pt-3">
          <People trade={trade} start={forecast.start} bufferDays={forecast.buffer_days} />
        </div>
      )}
    </section>
  );
}

function ForecastSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-40 rounded-card" />
      ))}
    </div>
  );
}

function readAddress() {
  if (typeof window === "undefined") return { start: "" };
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start") ?? "";
  return { start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : "" };
}

export function ForecastScreen({ code }: { code: string }) {
  const [initial] = useState(readAddress);
  const [start, setStart] = useState(initial.start);
  const [notice, setNotice] = useState(() => wasJustAdded(code));
  useEffect(() => forgetAdded(), []); // the banner is for the first visit only
  const forecast = useLoad(() => api.forecast(code, start || undefined), `${code}:${start}`);

  // The address bar keeps the what-if date, so the view can be shared or reloaded.
  useEffect(() => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, [start]);

  const data = forecast.data;
  const notFound = forecast.error === "Project not found";
  const needsDate = forecast.error?.includes("no start date") ?? false;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Projects
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {data ? (
              <>
                <span className="font-mono text-base font-normal text-subtle">
                  {data.project.code}
                </span>{" "}
                {data.project.name}
              </>
            ) : (
              "Manpower forecast"
            )}
          </h1>
          <p className="text-sm text-muted" aria-live="polite">
            {data
              ? `Who could work here from ${formatDate(data.start)} to ${formatDate(data.window_end)}`
              : "Working out who could join"}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            What if it starts on
            <input
              type="date"
              className={`${FIELD} w-40!`}
              value={start || data?.start || ""}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          {start && data && start !== data.project.starts_on && (
            <button type="button" className={BUTTON} onClick={() => setStart("")}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Back to project start
            </button>
          )}
        </div>
      </header>

      {notice && data && (
        <p
          role="status"
          className="m-0 flex items-center justify-between gap-3 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          <span>{data.project.code} was added. Here is who could work on it.</span>
          <button type="button" className="underline" onClick={() => setNotice(false)}>
            Dismiss
          </button>
        </p>
      )}

      {forecast.loading && <ForecastSkeleton />}
      {notFound && (
        <EmptyState icon={UserX} title="Project not found">
          It is not in your list, or it was removed.
        </EmptyState>
      )}
      {needsDate && (
        <EmptyState icon={CalendarClock} title="Choose a start date">
          This project has no start date yet. Pick one above to see the forecast.
        </EmptyState>
      )}
      {forecast.error && !notFound && !needsDate && (
        <ErrorState title="Couldn’t load" onRetry={forecast.retry}>
          {forecast.error}
        </ErrorState>
      )}

      {data && (
        <div
          aria-busy={forecast.refreshing}
          className={forecast.refreshing ? "opacity-60 transition-opacity" : ""}
        >
          <p className="m-0 mb-3 text-xs text-muted">
            Deployable people are not held for this project until you reserve them. The same person
            can appear in more than one forecast. A person must finish on their current project by{" "}
            {formatDate(subtractDays(data.start, data.buffer_days))} to count.
          </p>
          {data.trades.length === 0 ? (
            <EmptyState icon={UserX} title="No workers needed yet">
              This project has no manpower lines for these dates.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {data.trades.map((trade) => (
                <TradeCard key={trade.trade_code} trade={trade} forecast={data} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** ISO date minus days, without time zones (the forecast works in whole days). */
function subtractDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}
