"use client";

import { ArrowUpRight, CircleCheck, Clock, Hand, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { TYPE_LABEL, ageText, factRows, gulfDay } from "@/lib/alerts";
import { api, ApiError } from "@/lib/api";
import type { AlertAction, AlertDetail } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { SnoozePanel } from "./SnoozePanel";

const MIN_REASON = 10;

/** Where an action button goes. Only screens that exist are listed (docs/rules.md, ALERT_ACTIONS). */
export function hrefFor(action: AlertAction): string | null {
  const p = action.params;
  const text = (key: string) => (p[key] ? encodeURIComponent(String(p[key])) : null);
  switch (action.action) {
    case "open_forecast":
      return text("project") ? `/projects/${text("project")}/forecast` : null;
    case "open_allocation":
      return text("request") ? `/requests?request=${text("request")}` : "/requests";
    case "open_mobilization":
      return text("mob_no") ? `/mobilization?mob=${text("mob_no")}` : "/mobilization";
    case "open_worker":
      return text("worker") ? `/workers?worker=${text("worker")}` : "/workers";
    default:
      return null;
  }
}

type Props = {
  /** The alert to show; null closes the sheet. */
  alertId: string | null;
  /** Its title from the list, so the sheet has a name while the alert loads. */
  fallbackTitle?: string;
  /** The server's clock, or null until the list has said what time it is. */
  now: string | null;
  onClose: () => void;
  /** Something changed on the server: the list behind the sheet reloads. */
  onChanged: (message?: string) => void;
};

type Mode = "assign" | "snooze" | "dismiss" | null;

function Body({
  detail,
  now,
  onAnswer,
  onChanged,
}: {
  detail: AlertDetail;
  now: string;
  onAnswer: (answer: AlertDetail) => void;
  onChanged: Props["onChanged"];
}) {
  const me = useUser();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const people = useLoad(() => api.alertAssignees(), "assignees", detail.can_act);

  async function run(key: string, change: () => Promise<AlertDetail>, success: string) {
    setPending(key);
    setMessage(null);
    try {
      onAnswer(await change());
      setMode(null);
      setReason("");
      setMessage({ tone: "success", text: success });
      onChanged();
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
  const mine = detail.status === "in_progress" && detail.assignee_id === me.id;
  const rows = factRows(detail.type, detail.facts);
  const closed = detail.status === "resolved" || detail.status === "dismissed";

  return (
    <div className="flex flex-col gap-5">
      {detail.explanation && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm">{detail.explanation}</p>
          {detail.narrated && (
            <p className="m-0 text-xs text-subtle">Written by AI from the facts below</p>
          )}
        </div>
      )}

      {detail.escalated_to && !closed && (
        <p className="m-0 flex items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text">
          <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
          Nobody took this in time, so it moved up to the {detail.escalated_to}.
        </p>
      )}

      {closed && (
        <p className="m-0 rounded-control bg-sunken px-3 py-2 text-sm text-muted">
          {detail.status === "dismissed" ? "Dismissed" : "Resolved"}
          {detail.resolved_at ? ` on ${formatDate(gulfDay(detail.resolved_at))}` : ""}
          {detail.resolution_note ? `: ${detail.resolution_note}` : "."}
        </p>
      )}

      {rows.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Facts behind this alert</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-border first:border-t-0">
                <th
                  scope="row"
                  className="w-2/5 py-1.5 pr-3 text-left align-top font-normal text-muted"
                >
                  {r.label}
                </th>
                <td
                  className={`py-1.5 align-top ${r.kind === "number" ? "tabular-nums" : ""} ${
                    r.kind === "code" ? "font-mono text-xs" : ""
                  }`}
                >
                  {Array.isArray(r.value) ? (
                    <ul className="m-0 list-none p-0">
                      {r.value.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    r.value
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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

      {detail.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.actions.map((a, i) => {
            const href = hrefFor(a);
            return href ? (
              <Link key={a.action} href={href} className={i === 0 ? PRIMARY_BUTTON : BUTTON}>
                {a.label}
              </Link>
            ) : null;
          })}
        </div>
      )}

      {detail.can_act ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {mine ? (
              <span className="inline-flex h-9 items-center text-sm text-muted">
                You are working on this.
              </span>
            ) : (
              <button
                type="button"
                className={BUTTON}
                disabled={busy}
                onClick={() => run("take", () => api.takeAlert(detail.id), "You took this alert.")}
              >
                <Hand className="size-4" aria-hidden="true" />
                {pending === "take" ? "Taking…" : "Take it"}
              </button>
            )}
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              aria-expanded={mode === "assign"}
              onClick={() => setMode(mode === "assign" ? null : "assign")}
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Assign
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              aria-expanded={mode === "snooze"}
              onClick={() => setMode(mode === "snooze" ? null : "snooze")}
            >
              Snooze
            </button>
            {detail.can_dismiss && (
              <button
                type="button"
                className={BUTTON}
                disabled={busy}
                aria-expanded={mode === "dismiss"}
                onClick={() => setMode(mode === "dismiss" ? null : "dismiss")}
              >
                Dismiss
              </button>
            )}
          </div>

          {mode === "assign" && (
            <form
              aria-label="Assign this alert"
              className="flex flex-wrap items-end gap-2 rounded-control border border-border bg-sunken p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  "assign",
                  () => api.assignAlert(detail.id, assignTo),
                  `Assigned to ${people.data?.find((p) => p.id === assignTo)?.name ?? "them"}.`,
                );
              }}
            >
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
                Assign to
                <select
                  className={FIELD}
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                >
                  <option value="">Choose a person</option>
                  {(people.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.role}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={PRIMARY_BUTTON} disabled={busy || !assignTo}>
                {pending === "assign" ? "Assigning…" : "Assign"}
              </button>
            </form>
          )}

          {mode === "snooze" && (
            <SnoozePanel
              now={now}
              severity={detail.severity}
              busy={busy}
              onCancel={() => setMode(null)}
              onSnooze={(until) =>
                run(
                  "snooze",
                  () => api.snoozeAlert(detail.id, until),
                  `Snoozed until ${formatDate(gulfDay(until))}.`,
                )
              }
            />
          )}

          {mode === "dismiss" && (
            <form
              aria-label="Dismiss this alert"
              className="flex flex-col gap-2 rounded-control border border-border bg-sunken p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run("dismiss", () => api.dismissAlert(detail.id, reason.trim()), "Dismissed.");
              }}
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                Why is this being dismissed?
                <textarea
                  autoFocus
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm font-normal"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className={PRIMARY_BUTTON}
                  disabled={busy || reason.trim().length < MIN_REASON}
                >
                  {pending === "dismiss" ? "Dismissing…" : "Dismiss alert"}
                </button>
                <button type="button" className={BUTTON} onClick={() => setMode(null)}>
                  Cancel
                </button>
                <span className="text-xs text-muted">
                  {reason.trim().length} of {MIN_REASON} characters. It stays away until it gets
                  worse.
                </span>
              </div>
            </form>
          )}
        </div>
      ) : (
        !closed && <p className="m-0 text-xs text-muted">Only HR works on alerts.</p>
      )}

      <section aria-label="History" className="flex flex-col gap-1">
        <h3 className="m-0 text-xs font-semibold tracking-wide text-muted uppercase">History</h3>
        <ul className="m-0 flex list-none flex-col p-0 text-sm">
          {detail.history.map((h, i) => (
            <li
              key={`${h.at}-${i}`}
              className="flex flex-wrap justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
            >
              <span>{h.what}</span>
              <span className="text-xs text-subtle">
                {h.by}, {ageText(h.at, now)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function AlertSheet({ alertId, fallbackTitle, now, onClose, onChanged }: Props) {
  const load = useLoad(() => api.alert(alertId ?? ""), alertId ?? "", alertId !== null);
  const loaded = load.data && load.data.id === alertId ? load.data : null;
  // A change answers with the whole alert. It is shown until the sheet loads a newer copy.
  const [fresh, setFresh] = useState<{ base: AlertDetail | null; answer: AlertDetail } | null>(
    null,
  );
  const detail = fresh && fresh.base === loaded ? fresh.answer : loaded;
  return (
    <DetailSheet
      open={alertId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={detail?.title ?? fallbackTitle ?? "Alert"}
      meta={
        detail && (
          <>
            <SeverityChip severity={detail.severity} />
            <StatusChip
              tone={detail.status === "resolved" ? "success" : "neutral"}
              icon={detail.status === "resolved" ? CircleCheck : Clock}
              label={STATUS_LABEL[detail.status]}
            />
            <span>{TYPE_LABEL[detail.type]}</span>
            <span className="font-mono">{detail.project ?? "Company-wide"}</span>
          </>
        )
      }
    >
      {alertId && !detail && !load.error && (
        <SkeletonLoader label="Loading the alert" variant="lines" count={5} />
      )}
      {load.error && !detail && (
        <ErrorState title="Couldn’t load" onRetry={load.retry}>
          {load.error}
        </ErrorState>
      )}
      {detail && (
        <Body
          key={detail.id}
          detail={detail}
          now={now ?? new Date().toISOString()}
          onAnswer={(answer) => setFresh({ base: loaded, answer })}
          onChanged={onChanged}
        />
      )}
    </DetailSheet>
  );
}

const STATUS_LABEL = {
  open: "Open",
  in_progress: "In progress",
  snoozed: "Snoozed",
  resolved: "Resolved",
  dismissed: "Dismissed",
} as const;
