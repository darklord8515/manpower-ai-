"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CircleAlert, Link2, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { ApproveResponse } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { Violations, plural } from "./parts";

type Props = {
  requestNo: string;
  lineId: string;
  trade: string;
  /** What approving did, or why it could not. Called once, then the dialog closes. */
  onApproved: (result: ApproveResponse) => void;
  onClose: () => void;
};

const STATUS_AFTER: Record<string, string> = {
  filled: "The request will be filled.",
  partially_filled: "The request will stay partly filled; the gap stays open.",
};

/**
 * "What will happen if I approve": the preview comes from the server (it writes nothing), the
 * confirm button asks the server to do it, and the rules run again at that moment.
 */
export function ApprovalDialog({ requestNo, lineId, trade, onApproved, onClose }: Props) {
  const [preview, setPreview] = useState<ApproveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .approveLine(requestNo, lineId, true)
      .then((p) => !cancelled && setPreview(p))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof ApiError ? e.message : "Couldn’t check the line."),
      );
    return () => {
      cancelled = true;
    };
  }, [requestNo, lineId]);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.approveLine(requestNo, lineId, false);
      if (!result.ok) {
        setPreview(result); // something changed since the preview: show who, and why
        return;
      }
      onApproved(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t approve. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const blocked = preview && !preview.ok;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !saving && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-70 bg-(--scrim)" />
        <Dialog.Content
          aria-describedby="approval-help"
          className="fixed top-1/2 left-1/2 z-80 flex max-h-[85vh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border bg-surface shadow-(--shadow-pop)"
        >
          <div className="border-b border-border px-5 py-4">
            <Dialog.Title className="m-0 text-md font-semibold">
              Approve {trade.toLowerCase()} for {requestNo}
            </Dialog.Title>
            <p id="approval-help" className="m-0 mt-1 text-xs text-muted">
              This is what will happen. Nothing is saved until you press Approve.
            </p>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">
            {!preview && !error && (
              <div
                role="status"
                aria-busy="true"
                aria-label="Checking the line"
                className="flex flex-col gap-2"
              >
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-5 w-1/2" />
                <div className="skeleton h-5 w-3/4" />
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="m-0 rounded-control bg-danger-soft px-3 py-2 text-danger-text"
              >
                {error}
              </p>
            )}
            {preview && (
              <>
                {blocked && (
                  <p
                    role="alert"
                    className="m-0 flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-danger-text"
                  >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    Someone no longer passes the rules, so nothing was saved. Take them off the line
                    or fix the problem, then try again.
                  </p>
                )}
                <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                  {preview.people.map((p) => (
                    <li key={p.code} className="py-2">
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="font-mono text-xs text-subtle">{p.code}</span>
                      <span className="block text-xs text-muted">
                        Starts {formatDate(p.starts_on)}
                        {p.moving_from
                          ? `, after finishing on ${p.moving_from}${p.moving_from_ends ? ` (${formatDate(p.moving_from_ends)})` : ""}`
                          : ""}
                        {p.becomes_mobilizing ? ". Becomes Mobilizing now." : ""}
                      </span>
                      <Violations items={p.violations} />
                    </li>
                  ))}
                </ul>
                {!blocked && (
                  <ul className="m-0 flex list-none flex-col gap-1 rounded-control bg-sunken p-3 text-sm">
                    <li className="flex items-center gap-2">
                      <UserCheck className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      {plural(preview.assignments, "assignment")} planned,{" "}
                      {plural(preview.mobilizations, "mobilization")} started.
                    </li>
                    {preview.depend_on_other_jobs > 0 && (
                      <li className="flex items-center gap-2">
                        <Link2 className="size-4 shrink-0 text-muted" aria-hidden="true" />
                        {preview.depend_on_other_jobs}{" "}
                        {preview.depend_on_other_jobs === 1 ? "depends" : "depend"} on another job
                        finishing on time.
                      </li>
                    )}
                    <li>
                      The line will be {preview.filled_after} of {preview.headcount}.{" "}
                      {STATUS_AFTER[preview.request_status_after] ?? ""}
                    </li>
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="flex gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={!preview || blocked || saving}
              onClick={confirm}
            >
              {saving
                ? "Approving…"
                : preview
                  ? `Approve ${plural(preview.people.length, "worker")}`
                  : "Approve"}
            </button>
            <button type="button" className={BUTTON} onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
