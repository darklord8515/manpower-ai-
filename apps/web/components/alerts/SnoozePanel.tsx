"use client";

import { useState } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import {
  gulfDay,
  lastSnoozeDay,
  snoozeChoices,
  snoozeLimitHours,
  snoozeProblem,
  untilForDay,
} from "@/lib/alerts";
import type { AlertSeverity } from "@/lib/api-types";
import { formatDate } from "@/lib/format";

type Props = {
  /** The server's clock, so the choices are right on the simulated date too. */
  now: string;
  /** The most severe alert being snoozed: it decides how long the snooze may be. */
  severity: AlertSeverity;
  busy: boolean;
  onSnooze: (until: string) => void;
  onCancel: () => void;
};

/** 4 hours, tomorrow 07:00, 3 days or a day of your choice, never longer than the rules allow. */
export function SnoozePanel({ now, severity, busy, onSnooze, onCancel }: Props) {
  const [day, setDay] = useState("");
  const critical = severity === "critical";
  const problem = day ? snoozeProblem(untilForDay(day), now, severity) : null;
  return (
    <div
      role="group"
      aria-label="Snooze until"
      className="flex flex-col gap-3 rounded-control border border-border bg-sunken p-3"
    >
      <p className="m-0 text-sm font-medium">Snooze until</p>
      <div className="flex flex-wrap gap-2">
        {snoozeChoices(now, severity).map((choice) => (
          <button
            key={choice.label}
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => onSnooze(choice.until)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {!critical && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Or pick a day
            <input
              type="date"
              className={`${FIELD} w-44!`}
              min={gulfDay(now)}
              max={lastSnoozeDay(now, severity)}
              value={day}
              aria-invalid={Boolean(problem)}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={busy || !day || Boolean(problem)}
            onClick={() => onSnooze(untilForDay(day))}
          >
            {day ? `Snooze until ${formatDate(day)}` : "Snooze"}
          </button>
        </div>
      )}
      <p role={problem ? "alert" : undefined} className="m-0 text-xs text-muted">
        {problem ??
          `It comes back at 07:00 that day if the cause is still there. At most ${
            snoozeLimitHours(severity) === 24 ? "24 hours" : "7 days"
          }${critical ? " for a critical alert" : ""}.`}
      </p>
      <div>
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
