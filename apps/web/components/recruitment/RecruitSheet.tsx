"use client";

import { useId, useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { RecruitmentRow } from "@/lib/api-types";

export type RecruitDefaults = {
  /** Project code, or none for a request that is not tied to a project. */
  project: string | null;
  projectName?: string;
  tradeCode: string;
  tradeName: string;
  headcount: number;
  /** The earliest sensible dates the forecast worked out (ISO). */
  localBy?: string | null;
  overseasBy?: string | null;
  /** Today, from the server's clock (ISO). */
  today: string;
  /** A leaver this request replaces. */
  replaces?: { code: string; name: string } | null;
  reason?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  defaults: RecruitDefaults;
  onRaised: (row: RecruitmentRow) => void;
};

const later = (a: string | null | undefined, b: string) => (a && a > b ? a : b);

/** Ask for people. Pre-filled from the forecast; nothing is sent to anyone, it becomes a tracked request. */
export function RecruitSheet({ open, onClose, defaults, onRaised }: Props) {
  const ids = useId();
  const [headcount, setHeadcount] = useState(String(defaults.headcount));
  const [source, setSource] = useState<"local" | "overseas">("overseas");
  const [neededBy, setNeededBy] = useState(later(defaults.overseasBy, defaults.today));
  const [arrival, setArrival] = useState("");
  const [reason, setReason] = useState(defaults.reason ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function chooseSource(next: "local" | "overseas") {
    setSource(next);
    // The needed-by date follows the longer or shorter lead time, until HR has typed their own.
    setNeededBy(later(next === "local" ? defaults.localBy : defaults.overseasBy, defaults.today));
  }

  function validate() {
    const found: Record<string, string> = {};
    const n = Number(headcount);
    if (!Number.isInteger(n) || n < 1 || n > 500)
      found.headcount = "Enter a whole number from 1 to 500.";
    if (!neededBy) found.neededBy = "Choose the date they are needed by.";
    else if (neededBy < defaults.today)
      found.neededBy = "The needed-by date cannot be in the past.";
    if (arrival && arrival < defaults.today)
      found.arrival = "The expected arrival cannot be in the past.";
    if (reason.trim().length < 10) found.reason = "Give a reason of at least 10 characters.";
    return found;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-recruit-form] [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setSaving(true);
    try {
      const row = await api.raiseRecruitment({
        project: defaults.project,
        trade: defaults.tradeCode,
        headcount: Number(headcount),
        needed_by: neededBy,
        source,
        expected_arrival: arrival || null,
        replaces: defaults.replaces?.code ?? null,
        reason: reason.trim(),
      });
      onRaised(row);
    } catch (error) {
      setFailure(
        error instanceof ApiError ? error.message : "Couldn’t save the request. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];

  return (
    <DetailSheet
      open={open}
      onOpenChange={(next) => !next && !saving && onClose()}
      title="Raise a recruitment request"
      meta={
        <span>
          {defaults.tradeName}
          {defaults.projectName ? ` for ${defaults.project} ${defaults.projectName}` : ""}
          {defaults.replaces ? `, replacing ${defaults.replaces.name}` : ""}
        </span>
      }
    >
      <form onSubmit={submit} noValidate data-recruit-form className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          This records the request and counts it in the forecast. It does not contact anyone.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-n`} className="text-sm font-medium">
              How many
            </label>
            <input
              id={`${ids}-n`}
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              className={FIELD}
              value={headcount}
              aria-invalid={Boolean(err("headcount"))}
              aria-describedby={`${ids}-n-e`}
              onChange={(e) => setHeadcount(e.target.value)}
            />
            <p
              id={`${ids}-n-e`}
              role={err("headcount") ? "alert" : undefined}
              className="m-0 text-xs text-danger-text empty:hidden"
            >
              {err("headcount")}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-s`} className="text-sm font-medium">
              Hiring
            </label>
            <select
              id={`${ids}-s`}
              className={FIELD}
              value={source}
              onChange={(e) => chooseSource(e.target.value as "local" | "overseas")}
            >
              <option value="overseas">Overseas</option>
              <option value="local">Local</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-b`} className="text-sm font-medium">
              Needed by
            </label>
            <input
              id={`${ids}-b`}
              type="date"
              min={defaults.today}
              className={FIELD}
              value={neededBy}
              aria-invalid={Boolean(err("neededBy"))}
              aria-describedby={`${ids}-b-e`}
              onChange={(e) => setNeededBy(e.target.value)}
            />
            <p
              id={`${ids}-b-e`}
              role={err("neededBy") ? "alert" : undefined}
              className="m-0 text-xs text-danger-text empty:hidden"
            >
              {err("neededBy")}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-a`} className="text-sm font-medium">
              Expected arrival <span className="font-normal text-muted">(if known)</span>
            </label>
            <input
              id={`${ids}-a`}
              type="date"
              min={defaults.today}
              className={FIELD}
              value={arrival}
              aria-invalid={Boolean(err("arrival"))}
              aria-describedby={`${ids}-a-e`}
              onChange={(e) => setArrival(e.target.value)}
            />
            <p
              id={`${ids}-a-e`}
              role={err("arrival") ? "alert" : undefined}
              className="m-0 text-xs text-danger-text empty:hidden"
            >
              {err("arrival")}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-r`} className="text-sm font-medium">
            Reason
          </label>
          <textarea
            id={`${ids}-r`}
            rows={3}
            maxLength={500}
            className={`${FIELD} h-auto py-2`}
            value={reason}
            aria-invalid={Boolean(err("reason"))}
            aria-describedby={`${ids}-r-e`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why these people are needed"
          />
          <p
            id={`${ids}-r-e`}
            role={err("reason") ? "alert" : undefined}
            className="m-0 text-xs text-danger-text empty:hidden"
          >
            {err("reason")}
          </p>
        </div>
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
            {saving ? "Saving…" : "Raise request"}
          </button>
          <button type="button" className={BUTTON} onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </DetailSheet>
  );
}
