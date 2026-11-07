"use client";

import { ArrowUpRight, Clock, UserRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { TYPE_LABEL, ageText, gulfDay } from "@/lib/alerts";
import type { AlertRow, AlertStatus } from "@/lib/api-types";
import { formatDate } from "@/lib/format";

const COLLAPSE = { duration: 0.18, ease: "easeOut" } as const;

const STATUS: Partial<Record<AlertStatus, { tone: Tone; label: (a: AlertRow) => string }>> = {
  in_progress: { tone: "info", label: () => "In progress" },
  snoozed: {
    tone: "neutral",
    label: (a) =>
      `Snoozed until ${a.snoozed_until ? formatDate(gulfDay(a.snoozed_until)) : "later"}`,
  },
  resolved: { tone: "success", label: () => "Resolved" },
  dismissed: { tone: "neutral", label: () => "Dismissed" },
};

type Props = {
  alerts: AlertRow[];
  label: string;
  /** The server's clock, for "3 h ago". */
  now: string;
  /** Someone who may act can tick rows for a bulk change. */
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  onOpen: (alert: AlertRow) => void;
};

/**
 * The alerts, one row each: severity, title, project, status, who has it, how long ago. A row
 * collapses out when it is snoozed or dismissed, so the counters moving with it make sense.
 */
export function AlertItems({
  alerts,
  label,
  now,
  selectable = false,
  selected,
  onToggle,
  onOpen,
}: Props) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      <AnimatePresence initial={false}>
        {alerts.map((alert) => {
          const status = STATUS[alert.status];
          return (
            <motion.li
              key={alert.id}
              data-alert={alert.id}
              layout="position"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={COLLAPSE}
              className="overflow-hidden border-t border-border first:border-t-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={`Select: ${alert.title}`}
                    checked={selected?.has(alert.id) ?? false}
                    onChange={() => onToggle?.(alert.id)}
                    className="size-4 accent-accent-hover"
                  />
                )}
                <SeverityChip severity={alert.severity} />
                <button
                  type="button"
                  onClick={() => onOpen(alert)}
                  className="min-w-0 flex-1 basis-60 text-left text-sm font-medium hover:underline hover:underline-offset-4"
                >
                  {alert.title}
                </button>
                {status && (
                  <StatusChip tone={status.tone} icon={Clock} label={status.label(alert)} />
                )}
                {alert.escalated_to && (
                  <StatusChip
                    tone="warning"
                    icon={ArrowUpRight}
                    label={`Escalated to ${alert.escalated_to}`}
                  />
                )}
                <span className="text-xs text-muted">{TYPE_LABEL[alert.type]}</span>
                <span className="font-mono text-xs text-muted">
                  {alert.project ?? "Company-wide"}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-subtle">
                  <UserRound className="size-3.5" aria-hidden="true" />
                  {alert.assignee ?? "HR team"}
                </span>
                <span className="text-xs text-subtle">
                  {alert.resolved_at
                    ? formatDate(gulfDay(alert.resolved_at))
                    : ageText(alert.raised_at, now)}
                </span>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
