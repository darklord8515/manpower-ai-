"use client";

import {
  CircleCheck,
  Clock,
  ListChecks,
  MapPin,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { PRIMARY_BUTTON, SMALL_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { MobStage, MobilizationDetail, MobilizationTask } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { STAGE_TITLE } from "./stages";

const STAGE_TONE: Record<MobStage, Tone> = {
  pending_checklist: "neutral",
  in_progress: "info",
  ready: "success",
  on_site: "success",
};

const STAGE_ICON: Record<MobStage, LucideIcon> = {
  pending_checklist: Clock,
  in_progress: ListChecks,
  ready: CircleCheck,
  on_site: MapPin,
};

const DEPARTMENT_ORDER = ["hr", "operations", "site"];

type Props = {
  /** The mobilization to show; null closes the sheet. */
  mobNo: string | null;
  /** The worker's name from the board, so the title is right while the checklist loads. */
  fallbackName?: string;
  onClose: () => void;
  /** Something changed on the server: the board behind the sheet reloads. */
  onChanged: (message?: string) => void;
};

function groupByDepartment(tasks: MobilizationTask[]) {
  const groups = new Map<string, { name: string; tasks: MobilizationTask[] }>();
  for (const task of tasks) {
    const group = groups.get(task.department) ?? { name: task.department_name, tasks: [] };
    group.tasks.push(task);
    groups.set(task.department, group);
  }
  return [...groups.entries()].sort(
    ([a], [b]) => DEPARTMENT_ORDER.indexOf(a) - DEPARTMENT_ORDER.indexOf(b),
  );
}

function Checklist({
  detail,
  onAnswer,
  onChanged,
}: {
  detail: MobilizationDetail;
  /** The server answers every change with the whole checklist; the sheet shows that answer. */
  onAnswer: (answer: MobilizationDetail) => void;
  onChanged: Props["onChanged"];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function run(key: string, change: () => Promise<MobilizationDetail>, success: string) {
    setPending(key);
    setMessage(null);
    try {
      const answer = await change();
      onAnswer(answer);
      setMessage({ tone: "success", text: success });
      onChanged(
        answer.stage === "on_site"
          ? `${answer.worker_name} arrived and is now Deployed.`
          : undefined,
      );
    } catch (e) {
      setMessage({
        tone: "error",
        text: e instanceof ApiError ? e.message : "Something went wrong. Try again.",
      });
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;
  const open = detail.tasks_total - detail.tasks_done;

  return (
    <>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Worker</dt>
        <dd className="m-0">
          {detail.worker_name}{" "}
          <span className="font-mono text-xs text-subtle">{detail.worker_code}</span>
        </dd>
        {detail.trade && (
          <>
            <dt className="text-muted">Trade</dt>
            <dd className="m-0">{detail.trade}</dd>
          </>
        )}
        <dt className="text-muted">Project</dt>
        <dd className="m-0">
          <span className="font-mono text-xs text-subtle">{detail.project_code}</span>{" "}
          {detail.project_name}
        </dd>
        <dt className="text-muted">{detail.arrived_on ? "Arrived" : "Reports on"}</dt>
        <dd className="m-0">{formatDate(detail.arrived_on ?? detail.report_on)}</dd>
      </dl>

      <div className="flex flex-col gap-1">
        <div
          role="progressbar"
          aria-label="Tasks done"
          aria-valuemin={0}
          aria-valuemax={detail.tasks_total}
          aria-valuenow={detail.tasks_done}
          className="h-1.5 overflow-hidden rounded-full bg-sunken"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-(--dur-base)"
            style={{
              width: `${detail.tasks_total ? Math.round((detail.tasks_done / detail.tasks_total) * 100) : 0}%`,
            }}
          />
        </div>
        <p className="m-0 text-xs text-muted">
          {detail.tasks_done} of {detail.tasks_total} tasks done
          {detail.overdue > 0 ? `, ${detail.overdue} overdue` : ""}
        </p>
      </div>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`m-0 rounded-control px-3 py-2 text-sm ${
            message.tone === "error"
              ? "bg-danger-soft text-danger-text"
              : "bg-success-soft text-success-text"
          }`}
        >
          {message.text}
        </p>
      )}
      {!detail.can_update && detail.update_note && (
        <p className="m-0 text-xs text-muted">{detail.update_note}</p>
      )}

      {detail.tasks.length === 0 ? (
        <p className="m-0 rounded-control border border-dashed border-border-strong px-3 py-4 text-center text-sm text-muted">
          The checklist starts once this mobilization is approved.
        </p>
      ) : (
        groupByDepartment(detail.tasks).map(([code, group]) => (
          <section key={code} aria-label={group.name} className="flex flex-col gap-1">
            <h3 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">
              {group.name}
            </h3>
            <ul className="m-0 flex list-none flex-col rounded-control border border-border p-0">
              {group.tasks.map((task) => (
                <li
                  key={task.id}
                  data-task={task.title}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={task.status === "done" ? "text-muted" : "font-medium"}>
                      {task.title}
                    </span>
                    <span className="text-xs text-muted">
                      {task.status === "done"
                        ? `Done${task.done_by ? ` by ${task.done_by}` : ""}${task.done_at ? `, ${formatDate(task.done_at)}` : ""}`
                        : task.due_on
                          ? `Due ${formatDate(task.due_on)}`
                          : "No due date"}
                    </span>
                  </span>
                  {task.overdue && (
                    <StatusChip tone="warning" icon={TriangleAlert} label="Overdue" />
                  )}
                  {task.status === "done" && (
                    <CircleCheck className="size-4 text-success-text" aria-label="Done" />
                  )}
                  {detail.can_update &&
                    (task.status === "done" ? (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        disabled={busy}
                        aria-label={`Reopen ${task.title}`}
                        onClick={() =>
                          run(
                            task.id,
                            () => api.reopenTask(detail.mob_no, task.id),
                            `${task.title} is open again.`,
                          )
                        }
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        {pending === task.id ? "Reopening…" : "Reopen"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        disabled={busy}
                        aria-label={`Mark done: ${task.title}`}
                        onClick={() =>
                          run(
                            task.id,
                            () => api.markTaskDone(detail.mob_no, task.id),
                            `${task.title} is done.`,
                          )
                        }
                      >
                        {pending === task.id ? "Saving…" : "Mark done"}
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {detail.stage !== "on_site" && (
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          {detail.arrival_note && <p className="m-0 text-xs text-muted">{detail.arrival_note}</p>}
          {open === 0 && detail.can_confirm_arrival && (
            <p className="m-0 text-xs text-muted">
              Every task is done. Confirm when {detail.worker_name} has arrived on site.
            </p>
          )}
          {(detail.can_confirm_arrival || detail.can_update) && (
            <div>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy || !detail.can_confirm_arrival}
                onClick={() =>
                  run("arrival", () => api.confirmArrival(detail.mob_no), "Arrival confirmed.")
                }
              >
                <MapPin className="size-4" aria-hidden="true" />
                {pending === "arrival" ? "Confirming…" : "Confirm arrival"}
              </button>
            </div>
          )}
        </div>
      )}
      {detail.stage === "on_site" && detail.arrival_note && (
        <p className="m-0 mt-auto border-t border-border pt-4 text-sm text-success-text">
          {detail.arrival_note}
        </p>
      )}
    </>
  );
}

export function MobilizationSheet({ mobNo, fallbackName, onClose, onChanged }: Props) {
  const load = useLoad(() => api.mobilization(mobNo ?? ""), mobNo ?? "", mobNo !== null);
  const loaded = load.data && load.data.mob_no === mobNo ? load.data : null;
  // A change answers with the whole checklist. It is shown until the sheet loads a newer copy.
  const [fresh, setFresh] = useState<{
    base: MobilizationDetail | null;
    answer: MobilizationDetail;
  } | null>(null);
  const detail = fresh && fresh.base === loaded ? fresh.answer : loaded;
  return (
    <DetailSheet
      open={mobNo !== null}
      onOpenChange={(open) => !open && onClose()}
      title={detail?.worker_name ?? fallbackName ?? "Mobilization"}
      meta={
        mobNo && (
          <>
            <span className="font-mono">{mobNo}</span>
            {detail && (
              <StatusChip
                tone={STAGE_TONE[detail.stage]}
                icon={STAGE_ICON[detail.stage]}
                label={STAGE_TITLE[detail.stage]}
              />
            )}
          </>
        )
      }
    >
      {mobNo && !detail && !load.error && (
        <SkeletonLoader label="Loading the checklist" variant="rows" count={5} />
      )}
      {load.error && !detail && (
        <ErrorState title="Couldn’t load" onRetry={load.retry}>
          {load.error}
        </ErrorState>
      )}
      {detail && (
        <Checklist
          key={detail.mob_no}
          detail={detail}
          onAnswer={(answer) => setFresh({ base: loaded, answer })}
          onChanged={onChanged}
        />
      )}
    </DetailSheet>
  );
}
