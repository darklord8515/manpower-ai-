"use client";

import { useId, useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { RecruitmentRow, RecruitmentStage } from "@/lib/api-types";
import { STAGE_NAME } from "./stages";

type Props = {
  request: RecruitmentRow;
  /** The step to take: the next stage, or cancel. */
  to: RecruitmentStage;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
};

/** Move people on in the pipeline. Moving only some of them splits the request in two. */
export function AdvanceSheet({ request, to, today, onClose, onDone }: Props) {
  const ids = useId();
  const cancelling = to === "cancelled";
  const [count, setCount] = useState(String(request.headcount));
  const [arrival, setArrival] = useState(request.expected_arrival ?? "");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= request.headcount;
  const staying = valid ? request.headcount - n : 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!cancelling && !valid) {
      setError(`Enter a number from 1 to ${request.headcount}.`);
      return;
    }
    if (arrival && arrival < today) {
      setError("The expected arrival cannot be in the past.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await api.advanceRecruitment(request.id, {
        to,
        count: cancelling ? undefined : n,
        expected_arrival: cancelling ? undefined : arrival || null,
      });
      const moved = result.advanced;
      onDone(
        cancelling
          ? `${moved.request_no} was cancelled.`
          : `${moved.headcount} ${moved.headcount === 1 ? "person" : "people"} moved to ${STAGE_NAME[to].toLowerCase()} (${moved.request_no}).`,
      );
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : "Couldn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DetailSheet
      open
      onOpenChange={(next) => !next && !saving && onClose()}
      title={cancelling ? "Cancel this request" : `Move to ${STAGE_NAME[to].toLowerCase()}`}
      meta={
        <span>
          {request.request_no} · {request.headcount} {request.trade.toLowerCase()}
          {request.project_code ? ` for ${request.project_code}` : ""}
        </span>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {cancelling ? (
          <p className="m-0 text-sm">
            This cancels the whole request for {request.headcount}{" "}
            {request.headcount === 1 ? "person" : "people"}. They stop counting in the forecast. The
            request stays in the list as cancelled.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-n`} className="text-sm font-medium">
                How many are moving
              </label>
              <input
                id={`${ids}-n`}
                type="number"
                min={1}
                max={request.headcount}
                inputMode="numeric"
                className={FIELD}
                value={count}
                aria-invalid={Boolean(error)}
                onChange={(e) => setCount(e.target.value)}
              />
              <p role="status" className="m-0 text-xs text-muted">
                {valid && staying > 0
                  ? `${staying} will stay in ${STAGE_NAME[request.stage].toLowerCase()} as a separate request.`
                  : valid
                    ? "Everyone in the request moves."
                    : ""}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-a`} className="text-sm font-medium">
                Expected arrival <span className="font-normal text-muted">(if it changed)</span>
              </label>
              <input
                id={`${ids}-a`}
                type="date"
                min={today}
                className={FIELD}
                value={arrival}
                onChange={(e) => setArrival(e.target.value)}
              />
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="m-0 text-xs text-danger-text">
            {error}
          </p>
        )}
        {failure && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {failure}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={saving}>
            {saving ? "Saving…" : cancelling ? "Cancel request" : "Move"}
          </button>
          <button type="button" className={BUTTON} onClick={onClose} disabled={saving}>
            {cancelling ? "Keep it" : "Cancel"}
          </button>
        </div>
      </form>
    </DetailSheet>
  );
}
