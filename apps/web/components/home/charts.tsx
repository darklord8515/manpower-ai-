"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { formatDate } from "@/lib/format";
import type { ProjectRow, Summary } from "@/lib/api-types";

const AXIS = { fontSize: 12, fill: "var(--text-subtle)" } as const;

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`h-full rounded-card border border-border bg-surface p-4 md:p-5 ${className ?? ""}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Small dark tooltip shared by the charts. */
function Tip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: { name: string; value: number }[];
}) {
  if (!active) return null;
  return (
    <div className="rounded-control border border-border bg-raised px-3 py-2 text-xs shadow-(--shadow-pop)">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {rows.map((row) => (
        <p key={row.name} className="text-muted">
          {row.name}: <b className="font-semibold text-fg">{row.value}</b>
        </p>
      ))}
    </div>
  );
}

const RANGES = [
  { id: "4", label: "4 weeks" },
  { id: "8", label: "8 weeks" },
  { id: "13", label: "90 days" },
];

/** How many documents run out each week. Red tint under a dark line: the thing to watch. */
export function ExpiryChart({ weeks }: { weeks: Summary["expiry_by_week"] }) {
  const [range, setRange] = useState("13");
  const data = useMemo(
    () =>
      weeks.slice(0, Number(range)).map((w) => ({
        label: formatDate(w.week_start).slice(0, -5),
        full: `Week of ${formatDate(w.week_start)}`,
        count: w.count,
      })),
    [weeks, range],
  );
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <ChartCard
      title="Documents running out"
      subtitle={`${total} in this period, by week`}
      action={<SlidingTabs tabs={RANGES} value={range} onChange={setRange} label="Period" />}
    >
      <div
        className="h-64"
        role="img"
        aria-label={`Documents running out per week: ${data.map((d) => `${d.label} ${d.count}`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={AXIS}
              interval="preserveStartEnd"
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS} />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)" }}
              content={({ active, payload }) => (
                <Tip
                  active={active}
                  label={payload?.[0]?.payload.full as string | undefined}
                  rows={[{ name: "Documents", value: Number(payload?.[0]?.value ?? 0) }]}
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--chart-strong)"
              strokeWidth={2}
              fill="var(--accent)"
              fillOpacity={0.14}
              animationDuration={400}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

const WORKFORCE = [
  { key: "deployed", label: "On a project", color: "var(--chart-strong)" },
  { key: "mobilizing", label: "Mobilizing", color: "var(--info)" },
  { key: "available", label: "Available", color: "var(--success)" },
  { key: "unavailable", label: "Not available", color: "var(--chart-mid)" },
] as const;

/** Where all the people are right now. */
export function WorkforceDonut({ workforce }: { workforce: Summary["workforce"] }) {
  const data = WORKFORCE.map((s) => ({ ...s, value: workforce[s.key] }));
  return (
    <ChartCard title="Where everyone is" subtitle={`${workforce.total} people on the books`}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative h-44 w-44"
          role="img"
          aria-label={data.map((d) => `${d.label} ${d.value}`).join(", ")}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={52}
                outerRadius={80}
                paddingAngle={2}
                stroke="none"
                animationDuration={400}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <b className="block text-xl leading-6 font-semibold">{workforce.deployed}</b>
              <span className="text-xs text-muted">on projects</span>
            </div>
          </div>
        </div>
        <ul className="m-0 grid w-full list-none grid-cols-2 gap-x-4 gap-y-2 p-0 text-sm">
          {data.map((d) => (
            <li key={d.key} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: d.color }}
                aria-hidden="true"
              />
              <span className="text-muted">{d.label}</span>
              <b className="ml-auto font-semibold">{d.value}</b>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

/** Deployed against planned for each live project. The red-tinted part is the shortfall. */
export function ProjectsChart({
  projects,
  className,
}: {
  projects: ProjectRow[];
  className?: string;
}) {
  const data = projects
    .filter((p) => p.status === "active")
    .map((p) => ({
      code: p.code,
      deployed: p.deployed,
      short: Math.max(p.planned - p.deployed, 0),
      planned: p.planned,
    }));
  return (
    <ChartCard
      title="Projects: planned and deployed"
      subtitle="The red-tinted part is people still missing"
      className={className}
    >
      <div
        className="h-64"
        role="img"
        aria-label={`Deployed against planned: ${data.map((d) => `${d.code} ${d.deployed} of ${d.planned}`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
            barCategoryGap="28%"
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="code" tickLine={false} axisLine={false} tick={AXIS} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS} />
            <Tooltip
              cursor={{ fill: "var(--hover)" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return (
                  <Tip
                    active={active}
                    label={row?.code}
                    rows={
                      row
                        ? [
                            { name: "Deployed", value: row.deployed },
                            { name: "Short", value: row.short },
                            { name: "Planned", value: row.planned },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Bar
              dataKey="deployed"
              stackId="p"
              fill="var(--chart-strong)"
              radius={[0, 0, 3, 3]}
              animationDuration={400}
            />
            <Bar
              dataKey="short"
              stackId="p"
              fill="var(--danger)"
              fillOpacity={0.3}
              stroke="var(--danger)"
              strokeWidth={1}
              radius={[3, 3, 0, 0]}
              animationDuration={400}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
