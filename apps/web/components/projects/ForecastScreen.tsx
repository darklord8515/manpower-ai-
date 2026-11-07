"use client";

import {
  ArrowLeft,
  Bot,
  CalendarClock,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Link2,
  RotateCcw,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { BUTTON, FIELD } from "@/components/ui/button-styles";
import { useUser } from "@/components/auth/AuthProvider";
import { RecruitSheet } from "@/components/recruitment/RecruitSheet";
import { api, ApiError } from "@/lib/api";
import type { Advice, ProjectForecast, TradeForecast } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { ExplainPanel } from "./ExplainPanel";
import { forgetAdded, wasJustAdded } from "./just-added";
import { ReserveSheet } from "./ReserveSheet";

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
  leaving: "Leaving",
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
  onRelease,
}: {
  trade: TradeForecast;
  start: string;
  bufferDays: number;
  /** Present only for people who may approve assignments. */
  onRelease?: (code: string, name: string) => void;
}) {
  const free = trade.sources.filter((s) => s.kind === "available_now");
  const ending = trade.sources.filter((s) => s.kind === "ending_before_start");
  const total =
    trade.deployable +
    trade.late_candidates.length +
    trade.excluded.length +
    trade.arriving.length +
    trade.reserved.length;
  if (total === 0)
    return <p className="m-0 text-sm text-muted">Nobody with this trade is on file.</p>;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {trade.reserved.length > 0 && (
        <section aria-label="Reserved">
          <h4 className="m-0 mb-1 text-sm font-semibold">Reserved ({trade.reserved.length})</h4>
          <p className="m-0 mb-2 text-xs text-muted">
            Held for this project and already counted in &quot;Already assigned&quot;.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {trade.reserved.map((r) => (
              <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {r.name} <span className="font-mono text-xs text-subtle">{r.code}</span>
                </span>
                <span className="text-xs text-muted">
                  from {formatDate(r.starts_on)}
                  {r.moving_from ? `, after leaving ${r.moving_from}` : ""}
                </span>
                {onRelease && (
                  <button
                    type="button"
                    className="text-xs text-accent-text underline"
                    onClick={() => onRelease(r.code, r.name)}
                    aria-label={`Release ${r.name}`}
                  >
                    Release
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
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
      {trade.arriving.length > 0 && (
        <section aria-label="On the way">
          <h4 className="m-0 mb-1 text-sm font-semibold">
            On the way ({trade.arriving.reduce((sum, a) => sum + a.headcount, 0)})
          </h4>
          <p className="m-0 mb-2 text-xs text-muted">
            People already being recruited for this trade. Those who arrive by the start close the
            gap; those who arrive later do not.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {trade.arriving.map((a, i) => (
              <li key={`${a.stage}:${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {a.headcount} {a.headcount === 1 ? "person" : "people"}{" "}
                  <span className="text-muted">
                    · {a.stage_label}, {a.source === "local" ? "local" : "overseas"}
                  </span>
                </span>
                {a.expected_arrival && (
                  <StatusChip
                    tone={a.late ? "warning" : "success"}
                    icon={a.late ? CalendarClock : CircleCheck}
                    label={
                      a.late
                        ? `arrives ${formatDate(a.expected_arrival)}, ${a.days_after_start} d after the start`
                        : `arrives ${formatDate(a.expected_arrival)}, in time`
                    }
                  />
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

function TradeCard({
  trade,
  forecast,
  onChanged,
}: {
  trade: TradeForecast;
  forecast: ProjectForecast;
  onChanged: () => void;
}) {
  const user = useUser();
  const canReserve = user.permissions.includes("assignment:approve");
  const canRecruit = user.permissions.includes("recruitment:create");
  const [open, setOpen] = useState(false);
  const [reserving, setReserving] = useState(0); // opens the sheet; a new number resets its form
  const [recruiting, setRecruiting] = useState(0);
  const [done, setDone] = useState("");
  const [problem, setProblem] = useState("");
  const verdict = VERDICT[trade.advice.verdict];
  const id = `trade-${trade.trade_code}`;
  const code = forecast.project.code;
  const nobodyToReserve =
    trade.sources.every((s) => s.workers.length === 0) && trade.late_candidates.length === 0;

  async function release(workerCode: string, name: string) {
    setProblem("");
    try {
      const result = await api.release(code, [workerCode]);
      if (result.released.length === 0) setProblem(`${name} was not reserved on this project.`);
      else setDone(`${name} was released.`);
      onChanged();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Couldn’t release. Try again.");
    }
  }

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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BUTTON}
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
        <button
          type="button"
          className={BUTTON}
          disabled={!canReserve || nobodyToReserve}
          title={
            !canReserve
              ? "Reserving needs permission to approve assignments (HR Manager)."
              : nobodyToReserve
                ? "Nobody can be reserved for this trade."
                : undefined
          }
          onClick={() => setReserving((n) => n + 1)}
        >
          <UserCheck className="size-4" aria-hidden="true" />
          Reserve people
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={!canRecruit}
          title={!canRecruit ? "Raising a request needs the HR Manager." : undefined}
          onClick={() => setRecruiting((n) => n + 1)}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Raise recruitment request
        </button>
        {(!canReserve || !canRecruit) && (
          <span className="text-xs text-muted">Some actions need the HR Manager.</span>
        )}
      </div>
      {done && (
        <p
          role="status"
          className="m-0 mt-3 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {done}
        </p>
      )}
      {problem && (
        <p
          role="alert"
          className="m-0 mt-3 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}
      {open && (
        <div id={`${id}-people`} className="mt-3 border-t border-border pt-3">
          <People
            trade={trade}
            start={forecast.start}
            bufferDays={forecast.buffer_days}
            onRelease={canReserve ? release : undefined}
          />
        </div>
      )}
      {reserving > 0 && (
        <ReserveSheet
          key={`reserve-${reserving}`}
          open
          onClose={() => setReserving(0)}
          forecast={forecast}
          trade={trade}
          onChanged={() => {
            setDone("");
            onChanged();
          }}
        />
      )}
      {recruiting > 0 && (
        <RecruitSheet
          key={`recruit-${recruiting}`}
          open
          onClose={() => setRecruiting(0)}
          defaults={{
            project: code,
            projectName: forecast.project.name,
            tradeCode: trade.trade_code,
            tradeName: trade.trade,
            headcount: Math.max(trade.uncovered_gap, 1),
            localBy: trade.advice.recruit_by,
            overseasBy: trade.advice.recruit_by_overseas,
            today: forecast.today,
            reason: `${Math.max(trade.uncovered_gap, 1)} ${trade.trade.toLowerCase()} needed for ${forecast.project.name} from ${formatDate(forecast.start)}`,
          }}
          onRaised={(row) => {
            setRecruiting(0);
            setProblem("");
            setDone(
              `${row.request_no} was raised for ${row.headcount} ${row.trade.toLowerCase()}.`,
            );
            onChanged();
          }}
        />
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
  const user = useUser();
  const [initial] = useState(readAddress);
  const [start, setStart] = useState(initial.start);
  const [notice, setNotice] = useState(() => wasJustAdded(code));
  useEffect(() => forgetAdded(), []); // the banner is for the first visit only
  const forecast = useLoad(() => api.forecast(code, start || undefined), `${code}:${start}`);
  // "Explain" is for people who may use AI. It is shown switched off, with the reason, when the
  // server has no model. The explanation belongs to the date it was asked for.
  const canExplain =
    user.permissions.includes("ai:use") && user.permissions.includes("forecast:read");
  const ai = useLoad(() => api.aiStatus(), "ai-status", canExplain);
  const [explain, setExplain] = useState<{ n: number; start: string } | null>(null);

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
          {canExplain && data && ai.data && (
            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                className={BUTTON}
                disabled={!ai.data.mid}
                aria-describedby={ai.data.mid ? undefined : "explain-note"}
                onClick={() => setExplain((e) => ({ n: (e?.n ?? 0) + 1, start }))}
              >
                <Bot className="size-4" aria-hidden="true" />
                Explain
              </button>
              {!ai.data.mid && (
                <span id="explain-note" className="text-xs text-muted">
                  The AI model is not set up on this server.
                </span>
              )}
            </div>
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

      {explain && explain.start === start && data && (
        <ExplainPanel
          key={explain.n}
          project={code}
          start={start}
          onClose={() => setExplain(null)}
        />
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
                <TradeCard
                  key={trade.trade_code}
                  trade={trade}
                  forecast={data}
                  onChanged={forecast.retry}
                />
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
