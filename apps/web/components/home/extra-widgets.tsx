"use client";

import { CalendarClock, CircleAlert, ClipboardList, UserCheck, UserMinus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import { STAGE_NAME } from "@/components/recruitment/stages";
import { WorkerStatusChip } from "@/components/workers/WorkerStatusChip";
import type { RecruitmentList, RecruitmentStage, TradeStrength, WorkerRow } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { ChartCard } from "./charts";

/** The state of something a widget loads for itself. */
export type Load<T> = { data: T | null; error: string | null; loading: boolean; retry: () => void };

function Body<T>({
  load,
  empty,
  children,
}: {
  load: Load<T>;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (load.loading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-9 w-full" />
        ))}
      </div>
    );
  }
  if (load.error) {
    return (
      <ErrorState title="Couldn’t load" onRetry={load.retry}>
        {load.error}
      </ErrorState>
    );
  }
  if (!load.data) return null;
  return <>{children(load.data) ?? empty}</>;
}

const MORE = "text-xs text-accent-text underline-offset-2 hover:underline";

/** Exits and contract ends where nobody is being recruited to replace the person. */
export function LeavingSoon({ load, canOpen }: { load: Load<RecruitmentList>; canOpen: boolean }) {
  return (
    <ChartCard
      title="Leaving soon"
      subtitle="Nobody is being recruited to replace them"
      action={
        canOpen ? (
          <Link href="/recruitment" className={MORE}>
            Open Recruitment
          </Link>
        ) : undefined
      }
    >
      <Body load={load} empty={null}>
        {(data) =>
          data.leaving.length === 0 ? (
            <EmptyState icon={UserCheck} title="Everyone leaving has a replacement">
              Exits and contract ends in the next six months are all covered.
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {data.leaving.slice(0, 5).map((w) => (
                <li
                  key={w.code}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{w.name}</span>{" "}
                    <span className="font-mono text-xs text-subtle">{w.code}</span>
                    <span className="block text-xs text-muted">
                      {w.trade}
                      {w.project_code ? ` on ${w.project_code}` : ""}
                    </span>
                  </span>
                  <StatusChip
                    tone={w.kind === "contract_end" ? "warning" : "danger"}
                    icon={w.kind === "contract_end" ? CalendarClock : UserMinus}
                    label={`${w.kind === "contract_end" ? "Contract" : "Leaves"} ${formatDate(w.on)}`}
                  />
                </li>
              ))}
              {data.leaving.length > 5 && (
                <li className="py-2 text-xs text-muted">and {data.leaving.length - 5} more</li>
              )}
            </ul>
          )
        }
      </Body>
    </ChartCard>
  );
}

const OPEN: RecruitmentStage[] = ["open", "sourcing", "offer_issued", "visa_processing", "arrived"];

/** People on the way, by pipeline stage, and how many arrive after the project needs them. */
export function RecruitmentPipeline({
  load,
  canOpen,
}: {
  load: Load<RecruitmentList>;
  canOpen: boolean;
}) {
  return (
    <ChartCard
      title="Recruitment pipeline"
      subtitle="People on the way, by stage"
      action={
        canOpen ? (
          <Link href="/recruitment" className={MORE}>
            Open
          </Link>
        ) : undefined
      }
    >
      <Body load={load} empty={null}>
        {(data) => {
          const open = data.requests.filter((r) => OPEN.includes(r.stage));
          const total = open.reduce((sum, r) => sum + r.headcount, 0);
          const late = open.filter((r) => r.arrives_late).reduce((s, r) => s + r.headcount, 0);
          if (total === 0)
            return (
              <EmptyState icon={ClipboardList} title="Nobody is being recruited">
                Raise a request from a project when a trade is short.
              </EmptyState>
            );
          const most = Math.max(
            ...OPEN.map((s) =>
              open.filter((r) => r.stage === s).reduce((sum, r) => sum + r.headcount, 0),
            ),
          );
          return (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm">
                <b className="text-lg font-semibold">{total}</b>{" "}
                <span className="text-muted">{total === 1 ? "person" : "people"} on the way</span>
                {late > 0 && (
                  <span className="ml-2 inline-block align-middle">
                    <StatusChip tone="warning" icon={CircleAlert} label={`${late} arrive late`} />
                  </span>
                )}
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {OPEN.map((stage) => {
                  const n = open
                    .filter((r) => r.stage === stage)
                    .reduce((s, r) => s + r.headcount, 0);
                  return (
                    <li key={stage} className="text-sm">
                      <span className="flex justify-between gap-2">
                        <span className="text-muted">{STAGE_NAME[stage]}</span>
                        <b className="font-semibold tabular-nums">{n}</b>
                      </span>
                      <span className="mt-1 block h-1.5 rounded-full bg-sunken" aria-hidden="true">
                        <span
                          className="block h-full rounded-full bg-(--chart-strong)"
                          style={{ width: most ? `${(n / most) * 100}%` : 0 }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }}
      </Body>
    </ChartCard>
  );
}

const STACK = [
  { key: "deployed", label: "On a project", color: "var(--chart-strong)" },
  { key: "mobilizing", label: "Mobilizing", color: "var(--info)" },
  { key: "available", label: "Available", color: "var(--success)" },
  { key: "unavailable", label: "Not available", color: "var(--chart-mid)" },
] as const;

/** Where each trade's people are, biggest trades first. */
export function PeopleByTrade({ load }: { load: Load<TradeStrength[]> }) {
  return (
    <ChartCard title="People by trade" subtitle="Where each trade's people are">
      <Body load={load} empty={null}>
        {(rows) => {
          const data = rows.slice(0, 8);
          if (data.length === 0)
            return (
              <EmptyState icon={UserMinus} title="No people yet">
                People appear here once they are added.
              </EmptyState>
            );
          return (
            <div>
              <div
                className="h-64"
                role="img"
                aria-label={`People by trade: ${data
                  .map(
                    (d) =>
                      `${d.trade} ${d.total} (${d.deployed} on projects, ${d.available} available)`,
                  )
                  .join(", ")}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data}
                    layout="vertical"
                    margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid horizontal={false} stroke="var(--border)" />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "var(--text-subtle)" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="trade"
                      width={118}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--hover)" }}
                      content={({ active, payload }) => {
                        const row = payload?.[0]?.payload as TradeStrength | undefined;
                        if (!active || !row) return null;
                        return (
                          <div className="rounded-control border border-border bg-raised px-3 py-2 text-xs shadow-(--shadow-pop)">
                            <p className="mb-1 font-medium">
                              {row.trade} · {row.total}
                            </p>
                            {STACK.map((s) => (
                              <p key={s.key} className="text-muted">
                                {s.label}: <b className="font-semibold text-fg">{row[s.key]}</b>
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    {STACK.map((s) => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        stackId="t"
                        fill={s.color}
                        animationDuration={400}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted">
                {STACK.map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: s.color }}
                      aria-hidden="true"
                    />
                    {s.label}
                  </li>
                ))}
              </ul>
            </div>
          );
        }}
      </Body>
    </ChartCard>
  );
}

/** Who is on leave or medical, so HR knows who is not coming back this week. */
export function PeopleNotAvailable({
  load,
  total,
}: {
  load: Load<{ total: number; items: WorkerRow[] }>;
  total: number;
}) {
  return (
    <ChartCard
      title="People not available"
      subtitle={`${total} on leave or medical`}
      action={
        <Link href="/workers?status=unavailable" className={MORE}>
          See all
        </Link>
      }
    >
      <Body load={load} empty={null}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon={UserCheck} title="Everyone is available">
              Nobody is on leave or medical today.
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {data.items.slice(0, 6).map((w) => (
                <li key={w.code} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{w.name}</span>
                    <span className="block text-xs text-muted">{w.trade}</span>
                  </span>
                  {w.status && <WorkerStatusChip status={w.status} />}
                </li>
              ))}
            </ul>
          )
        }
      </Body>
    </ChartCard>
  );
}
