"use client";

import {
  ArrowDown,
  ArrowRight,
  Building2,
  CalendarDays,
  CircleCheck,
  MapPin,
  Search,
  Sparkles,
  TriangleAlert,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { ProjectLeadership } from "./ProjectLeadership";
import { Reveal } from "@/components/motion/Reveal";
import { WorkerStatusChip } from "@/components/workers/WorkerStatusChip";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { api } from "@/lib/api";
import type { ProjectForecast, ProjectOverview } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { ExplainPanel } from "./ExplainPanel";

const STATUS: Record<string, [string, Tone]> = {
  planning: ["Planning", "info"],
  active: ["Active", "success"],
  on_hold: ["On hold", "warning"],
  completed: ["Completed", "neutral"],
  cancelled: ["Cancelled", "neutral"],
};

function Tile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: "bad" | "good";
  icon: typeof Users;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="m-0 flex items-center gap-2 text-sm text-muted">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </p>
      <p
        className={cn(
          "m-0 mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad" && "text-danger-text",
          tone === "good" && "text-success-text",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="m-0 text-md font-semibold">{title}</h2>
          {subtitle && <p className="m-0 mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Bar({ value, of }: { value: number; of: number }) {
  const width = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-(--track)" aria-hidden="true">
      <span
        className="block h-full rounded-full bg-(--chart-strong) transition-[width] duration-(--dur-count) ease-out"
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

/** The wireframe: older projects whose people finish in time flow into this project's needs. */
function MovesFlow({ forecast }: { forecast: ProjectForecast }) {
  const sources = useMemo(() => {
    const found = new Map<
      string,
      { label: string; people: number; ends: string | null; trades: Set<string> }
    >();
    for (const trade of forecast.trades)
      for (const src of trade.sources) {
        const key = src.project_code ?? "free";
        const entry = found.get(key) ?? {
          label: src.project_code ?? "Free now",
          people: 0,
          ends: src.ends_on,
          trades: new Set<string>(),
        };
        entry.people += src.workers.length;
        entry.trades.add(trade.trade);
        found.set(key, entry);
      }
    return [...found.values()].filter((s) => s.people > 0);
  }, [forecast]);

  return (
    <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1.2fr]">
      <div className="flex flex-col gap-3">
        <p className="m-0 text-xs font-medium text-muted uppercase">Older projects and the bench</p>
        {sources.length === 0 && (
          <p className="m-0 rounded-control border border-dashed border-border-strong p-3 text-sm text-muted">
            Nobody finishes in time to move here. See recruitment below.
          </p>
        )}
        {sources.map((s, i) => (
          <Reveal key={s.label} index={i}>
            <div className="rounded-card border border-border bg-sunken p-3">
              <p className="m-0 flex items-center justify-between text-sm font-semibold">
                <span className={s.label === "Free now" ? undefined : "font-mono"}>{s.label}</span>
                <span className="tabular-nums">{s.people} people</span>
              </p>
              <p className="m-0 mt-1 text-xs text-muted">
                {[...s.trades].join(", ")}
                {s.ends ? ` · free from ${formatDate(s.ends)}` : ""}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
      <ArrowRight className="mx-auto hidden size-6 text-subtle lg:block" aria-hidden="true" />
      <ArrowDown className="mx-auto size-6 text-subtle lg:hidden" aria-hidden="true" />
      <div className="rounded-card border border-border-strong p-3">
        <p className="m-0 text-xs font-medium text-muted uppercase">
          {forecast.project.code} needs, from {formatDate(forecast.start)}
        </p>
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {forecast.trades.map((t) => {
            const covered = t.already_assigned + t.deployable;
            return (
              <li key={t.trade_code} className="flex items-center gap-2 text-sm">
                {t.uncovered_gap > 0 ? (
                  <TriangleAlert className="size-4 shrink-0 text-warning-text" aria-label="Short" />
                ) : (
                  <CircleCheck className="size-4 shrink-0 text-success-text" aria-label="Covered" />
                )}
                <span className="min-w-0 flex-1 truncate">{t.trade}</span>
                <span className="tabular-nums text-muted">
                  {Math.min(covered, t.needed)} of {t.needed}
                </span>
                {t.uncovered_gap > 0 && (
                  <span className="text-xs text-warning-text">{t.uncovered_gap} short</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SummaryTable({ forecast }: { forecast: ProjectForecast }) {
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">Staffing summary by trade</caption>
        <thead>
          <tr className="bg-sunken text-left text-xs text-muted">
            {[
              "Trade",
              "Needed",
              "Assigned",
              "Can move",
              "Recruiting",
              "Still short",
              "Next step",
            ].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {forecast.trades.map((t) => (
            <tr key={t.trade_code} className="border-t border-border">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {t.trade}
              </th>
              <td className="px-3 py-2 tabular-nums">{t.needed}</td>
              <td className="px-3 py-2 tabular-nums">{t.already_assigned}</td>
              <td className="px-3 py-2 tabular-nums">{t.deployable}</td>
              <td className="px-3 py-2 tabular-nums">{t.recruitment_pending}</td>
              <td
                className={cn(
                  "px-3 py-2 tabular-nums",
                  t.uncovered_gap > 0 && "font-semibold text-danger-text",
                )}
              >
                {t.uncovered_gap}
              </td>
              <td className="px-3 py-2 text-muted">{t.advice.headline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One project at a glance, with the people who can move to it and who is on it today. */
export function ProjectOverviewScreen({ code }: { code: string }) {
  const user = useUser();
  const canForecast = user.permissions.includes("forecast:read");
  const canExplain = canForecast && user.permissions.includes("ai:use");
  const overview = useLoad(() => api.projectOverview(code), code);
  const forecast = useLoad(() => api.forecast(code), `forecast:${code}`, canForecast);
  const ai = useLoad(() => api.aiStatus(), "ai-status", canExplain);
  const [explain, setExplain] = useState(false);
  const [query, setQuery] = useState("");
  const [trade, setTrade] = useState("");

  const o: ProjectOverview | null = overview.data;
  // How many people each trade has on this project (the chips above the list).
  const tradeCounts = useMemo(() => {
    const found = new Map<string, number>();
    for (const p of o?.staff ?? []) found.set(p.trade, (found.get(p.trade) ?? 0) + 1);
    return [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [o]);
  const staff = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (o?.staff ?? []).filter(
      (p) =>
        (!trade || p.trade === trade) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.trade.toLowerCase().includes(q)),
    );
  }, [o, query, trade]);

  if (overview.loading)
    return <SkeletonLoader label="Loading the project" variant="rows" count={5} />;
  if (overview.error || !o)
    return overview.error?.startsWith("Project not found") ? (
      <EmptyState
        icon={Building2}
        title="Project not found"
        action={
          <Link href="/projects" className={BUTTON}>
            Back to projects
          </Link>
        }
      >
        This project does not exist, or is not in your access.
      </EmptyState>
    ) : (
      <ErrorState title="Couldn’t load the project" onRetry={overview.retry}>
        {overview.error}
      </ErrorState>
    );

  const [statusLabel, statusTone] = STATUS[o.status] ?? [o.status, "neutral" as Tone];
  const explainOff = canExplain && ai.data && !ai.data.mid;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/projects" className="hover:underline">
          Projects
        </Link>{" "}
        <span aria-hidden="true">/</span> <span className="font-medium text-fg">{o.code}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">
            <span className="font-mono text-base text-subtle">{o.code}</span> {o.name}
          </h1>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <StatusChip tone={statusTone} icon={CalendarDays} label={statusLabel} />
            {o.client && <span>{o.client}</span>}
            {o.starts && (
              <span>
                {formatDate(o.starts)}
                {o.ends ? ` to ${formatDate(o.ends)}` : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canForecast && (
            <Link href={`/projects/${o.code}/forecast`} className={BUTTON}>
              <TrendingUp className="size-4" aria-hidden="true" />
              Forecast
            </Link>
          )}
          {user.permissions.includes("staffing:create") && (
            <Link href="/requests" className={PRIMARY_BUTTON}>
              <UserPlus className="size-4" aria-hidden="true" />
              Deploy people
            </Link>
          )}
        </div>
      </header>

      {o.description && <p className="m-0 max-w-3xl text-sm text-muted">{o.description}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Planned" value={o.planned} icon={Users} />
        <Tile label="Deployed" value={o.deployed} icon={CircleCheck} tone="good" />
        <Tile label="Mobilizing" value={o.mobilizing} icon={UserPlus} />
        <Tile
          label="Still needed"
          value={o.gap}
          icon={TriangleAlert}
          tone={o.gap > 0 ? "bad" : "good"}
        />
      </div>

      {o.progress !== null && (
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="m-0 mb-2 flex justify-between text-sm">
            <span className="font-medium">Time passed</span>
            <span className="tabular-nums text-muted">
              {o.progress}%{o.days_left !== null ? ` · ${o.days_left} days left` : ""}
            </span>
          </p>
          <Bar value={o.progress} of={100} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Trades" subtitle="Planned against deployed on this project">
          {o.trades.length === 0 ? (
            <p className="m-0 text-sm text-muted">No trades are planned for this project yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {o.trades.map((t) => (
                <li
                  key={t.trade}
                  className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm"
                >
                  <span className="truncate">{t.trade}</span>
                  <Bar value={t.deployed} of={t.planned} />
                  <span className="tabular-nums text-muted">
                    {t.deployed} / {t.planned}
                    {t.mobilizing > 0 && ` (+${t.mobilizing})`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Location">
          {o.sites.length === 0 ? (
            <p className="m-0 text-sm text-muted">No site is recorded yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {o.sites.map((s) => (
                <li key={s.name} className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
                  <span>
                    <b className="font-medium">{s.name}</b>
                    <br />
                    <span className="text-muted">
                      {s.emirate} · {s.outdoor ? "outdoor, midday ban applies" : "indoor"}
                    </span>
                    {s.latitude !== null && s.longitude !== null && (
                      <>
                        <br />
                        <a
                          className="text-accent-text hover:underline"
                          href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Maps
                        </a>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {canForecast && (
        <Card
          title="Who can move here"
          subtitle="People finishing other projects in time, against what this project needs"
          action={
            canExplain ? (
              <button
                type="button"
                className={BUTTON}
                onClick={() => setExplain(true)}
                disabled={!!explainOff || explain || !forecast.data}
                title={explainOff ? "The AI model is not set up on this server." : undefined}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Explain with AI
              </button>
            ) : undefined
          }
        >
          {forecast.loading ? (
            <SkeletonLoader label="Working out who can move" variant="rows" count={3} />
          ) : forecast.error || !forecast.data ? (
            <ErrorState title="Couldn’t work out the forecast" onRetry={forecast.retry}>
              {forecast.error}
            </ErrorState>
          ) : (
            <div className="flex flex-col gap-4">
              <MovesFlow forecast={forecast.data} />
              <SummaryTable forecast={forecast.data} />
              {explain && (
                <ExplainPanel project={o.code} start="" onClose={() => setExplain(false)} />
              )}
              <p className="m-0 text-xs text-muted">
                Every number is worked out by the forecast rules.{" "}
                <Link
                  href={`/projects/${o.code}/forecast`}
                  className="text-accent-text hover:underline"
                >
                  Open the full forecast to reserve people or raise recruitment.
                </Link>
              </p>
            </div>
          )}
        </Card>
      )}

      <ProjectLeadership
        code={o.code}
        canForecast={canForecast}
        canPeople={user.permissions.includes("employee:read")}
      />

      <Card
        title="Staff on this project"
        subtitle={`${o.staff_total} ${o.staff_total === 1 ? "person" : "people"} planned or deployed`}
        action={
          o.staff.length > 0 ? (
            <label className="relative block">
              <span className="sr-only">Search staff</span>
              <Search
                className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle"
                aria-hidden="true"
              />
              <input
                className={cn(FIELD, "pl-8")}
                value={query}
                placeholder="Search staff"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          ) : undefined
        }
      >
        {o.staff.length === 0 ? (
          <EmptyState icon={Users} title="Nobody is on this project yet" className="py-6">
            People appear here once a request for this project is approved.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              role="group"
              aria-label="Filter by trade"
              className="flex gap-2 overflow-x-auto pb-1"
            >
              {[
                ["", "All", o.staff.length] as const,
                ...tradeCounts.map(([t, n]) => [t, t, n] as const),
              ].map(([value, label, n]) => (
                <button
                  key={value || "all"}
                  type="button"
                  aria-pressed={trade === value}
                  onClick={() => setTrade(value)}
                  className={cn(
                    "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                    trade === value ? "bg-hover text-fg" : "bg-surface text-muted",
                  )}
                >
                  {label}
                  <span className="tabular-nums text-subtle">{n}</span>
                </button>
              ))}
            </div>
            {staff.length === 0 ? (
              <p className="m-0 text-sm text-muted">
                No one matches{query ? ` “${query}”` : ""}
                {trade ? ` in ${trade}` : ""}.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-control border border-border">
                <table className="w-full min-w-max border-collapse text-sm">
                  <caption className="sr-only">Staff on {o.name}</caption>
                  <thead>
                    <tr className="bg-sunken text-left text-xs text-muted">
                      {["Code", "Name", "Trade", "Level", "Status", "From", "Until"].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((p) => (
                      <tr key={p.code} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/workers?worker=${p.code}`}
                            className="font-medium hover:underline"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{p.trade}</td>
                        <td className="px-3 py-2 tabular-nums">{p.level ?? "—"}</td>
                        <td className="px-3 py-2">
                          <WorkerStatusChip status={p.status as never} />
                        </td>
                        <td className="px-3 py-2">{formatDate(p.starts)}</td>
                        <td className="px-3 py-2">{p.ends ? formatDate(p.ends) : "Open"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
