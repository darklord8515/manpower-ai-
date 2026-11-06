"use client";

import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  ClipboardList,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import { BUTTON } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { LeavingWorker, RecruitmentRow, RecruitmentStage } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdvanceSheet } from "./AdvanceSheet";
import { RecruitSheet } from "./RecruitSheet";
import { STAGE_NAME, STAGE_TONE, isOpenStage, nextStage } from "./stages";

type Move = { request: RecruitmentRow; to: RecruitmentStage };
type Replacement = { worker: LeavingWorker; key: number };

function StageChip({ stage }: { stage: RecruitmentStage }) {
  const icon =
    stage === "filled"
      ? CircleCheck
      : stage === "arrived"
        ? CalendarClock
        : stage === "cancelled"
          ? Clock
          : ClipboardList;
  return <StatusChip tone={STAGE_TONE[stage]} icon={icon} label={STAGE_NAME[stage]} />;
}

function Arrival({ r }: { r: RecruitmentRow }) {
  if (!r.expected_arrival) return <span className="text-subtle">Not set</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {formatDate(r.expected_arrival)}
      {r.arrives_late && <StatusChip tone="warning" icon={CircleAlert} label="late" />}
    </span>
  );
}

export function RecruitmentScreen() {
  const user = useUser();
  const canAct = user.permissions.includes("recruitment:create");
  const data = useLoad(() => api.recruitment(), "recruitment");
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [move, setMove] = useState<Move | null>(null);
  const [replacing, setReplacing] = useState<Replacement | null>(null);
  const [notice, setNotice] = useState("");

  const all = data.data?.requests ?? [];
  const today = data.data?.today ?? "";
  const open = all.filter((r) => isOpenStage(r.stage));
  const closed = all.filter((r) => !isOpenStage(r.stage));
  const rows = tab === "open" ? open : closed;
  const leaving = data.data?.leaving ?? [];
  const people = (list: RecruitmentRow[]) => list.reduce((sum, r) => sum + r.headcount, 0);

  const columns: Column<RecruitmentRow>[] = [
    {
      key: "request",
      header: "Request",
      cell: (r) => (
        <span className="font-medium">
          <span className="font-mono text-xs text-subtle">{r.request_no}</span> {r.trade}
          {r.replaces_name && (
            <span className="block text-xs font-normal text-muted">Replaces {r.replaces_name}</span>
          )}
        </span>
      ),
    },
    {
      key: "project",
      header: "Project",
      cell: (r) =>
        r.project_code ? (
          <span className="font-mono text-xs">{r.project_code}</span>
        ) : (
          <span className="text-subtle">None</span>
        ),
    },
    { key: "people", header: "People", align: "right", cell: (r) => r.headcount },
    { key: "stage", header: "Stage", cell: (r) => <StageChip stage={r.stage} /> },
    { key: "source", header: "Hiring", cell: (r) => (r.source === "local" ? "Local" : "Overseas") },
    { key: "arrival", header: "Expected", cell: (r) => <Arrival r={r} /> },
    ...(canAct
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            cell: (r: RecruitmentRow) => {
              const next = nextStage(r.stage);
              if (!next || !isOpenStage(r.stage)) return null;
              return (
                <span className="inline-flex gap-2">
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() => setMove({ request: r, to: next })}
                    aria-label={`Move ${r.request_no} to ${STAGE_NAME[next].toLowerCase()}`}
                  >
                    Move to {STAGE_NAME[next].toLowerCase()}
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() => setMove({ request: r, to: "cancelled" })}
                    aria-label={`Cancel ${r.request_no}`}
                  >
                    Cancel
                  </button>
                </span>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">Recruitment</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {data.data
            ? `${people(open)} ${people(open) === 1 ? "person" : "people"} on the way in ${open.length} ${open.length === 1 ? "request" : "requests"}`
            : "Loading recruitment"}
        </p>
      </header>

      {notice && (
        <p
          role="status"
          className="m-0 flex items-center justify-between gap-3 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          <span>{notice}</span>
          <button type="button" className="underline" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </p>
      )}

      {leaving.length > 0 && (
        <section
          aria-labelledby="leaving-title"
          className="rounded-card border border-border bg-surface p-4 md:p-5"
        >
          <h2 id="leaving-title" className="m-0 text-base font-semibold">
            Leaving, with nobody to replace them ({leaving.length})
          </h2>
          <p className="m-0 mt-1 text-xs text-muted">
            Exits and contract ends in the next six months where no replacement has been requested.
          </p>
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-border p-0">
            {leaving.map((w) => (
              <li
                key={w.code}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{w.name}</span>{" "}
                  <span className="font-mono text-xs text-subtle">{w.code}</span>
                  <span className="block text-xs text-muted">
                    {w.trade}
                    {w.project_code ? ` on ${w.project_code}` : ""} · {w.detail}
                  </span>
                </span>
                {canAct ? (
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() => setReplacing({ worker: w, key: Date.now() })}
                    aria-label={`Raise a replacement for ${w.name}`}
                  >
                    <UserPlus className="size-4" aria-hidden="true" />
                    Raise replacement
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Requests" className="rounded-card border border-border bg-surface">
        <div className="border-b border-border p-3 md:p-4">
          <SlidingTabs
            label="Requests"
            value={tab}
            onChange={(id) => setTab(id as "open" | "closed")}
            tabs={[
              { id: "open", label: "In progress", count: data.data ? open.length : undefined },
              {
                id: "closed",
                label: "Finished or cancelled",
                count: data.data ? closed.length : undefined,
              },
            ]}
          />
        </div>
        <DataTable
          caption="Recruitment requests"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={data.loading}
          error={data.error ? { message: data.error, onRetry: data.retry } : undefined}
          empty={
            <EmptyState
              icon={tab === "open" ? UserMinus : ClipboardList}
              title={tab === "open" ? "Nobody is being recruited" : "Nothing finished yet"}
            >
              {tab === "open"
                ? "Raise a request from a project's forecast when a trade is short."
                : "Requests appear here once the people are active, or the request is cancelled."}
            </EmptyState>
          }
          mobileCard={(r) => {
            const next = nextStage(r.stage);
            return (
              <div className="flex flex-col gap-1.5 px-4 py-3 text-sm">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    <span className="font-mono text-xs text-subtle">{r.request_no}</span> {r.trade}
                  </span>
                  <StageChip stage={r.stage} />
                </span>
                <span className="text-xs text-muted">
                  {r.headcount} {r.headcount === 1 ? "person" : "people"}
                  {r.project_code ? ` · ${r.project_code}` : ""} ·{" "}
                  {r.source === "local" ? "Local" : "Overseas"}
                  {r.replaces_name ? ` · replaces ${r.replaces_name}` : ""}
                </span>
                <span className="text-xs">
                  Expected: <Arrival r={r} />
                </span>
                {canAct && next && isOpenStage(r.stage) && (
                  <span className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => setMove({ request: r, to: next })}
                    >
                      Move to {STAGE_NAME[next].toLowerCase()}
                    </button>
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => setMove({ request: r, to: "cancelled" })}
                    >
                      Cancel
                    </button>
                  </span>
                )}
              </div>
            );
          }}
        />
      </section>

      {move && (
        <AdvanceSheet
          key={`${move.request.id}:${move.to}`}
          request={move.request}
          to={move.to}
          today={today}
          onClose={() => setMove(null)}
          onDone={(message) => {
            setMove(null);
            setNotice(message);
            data.retry();
          }}
        />
      )}
      {replacing && (
        <RecruitSheet
          key={replacing.key}
          open
          onClose={() => setReplacing(null)}
          defaults={{
            project: replacing.worker.project_code,
            projectName: undefined,
            tradeCode: replacing.worker.trade_code,
            tradeName: replacing.worker.trade,
            headcount: 1,
            localBy: replacing.worker.on,
            overseasBy: replacing.worker.on,
            today,
            replaces: { code: replacing.worker.code, name: replacing.worker.name },
            reason: `Replacing ${replacing.worker.name}: ${replacing.worker.detail.toLowerCase()}`,
          }}
          onRaised={(row) => {
            setReplacing(null);
            setNotice(
              `${row.request_no} was raised to replace ${row.replaces_name ?? "a leaver"}.`,
            );
            data.retry();
          }}
        />
      )}
    </div>
  );
}
