"use client";

import { Check, UserRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { SeverityChip, type Severity } from "./SeverityChip";

export type AlertView = {
  id: string;
  severity: Severity;
  title: string;
  /** Project code, or null for a company-wide alert. */
  project: string | null;
  /** "3 h ago" (the caller formats it). */
  raised: string;
  assignee: string | null;
};

type CardProps = {
  alert: AlertView;
  onOpen: (alert: AlertView) => void;
  /** Absent for read-only viewers: the button is then not shown at all. */
  onResolve?: (alert: AlertView) => void;
};

const COLLAPSE = { duration: 0.18, ease: "easeOut" } as const;

function AlertCard({ alert, onOpen, onResolve }: CardProps) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={COLLAPSE}
      className="overflow-hidden border-t border-border first:border-t-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
        <SeverityChip severity={alert.severity} />
        <button
          type="button"
          onClick={() => onOpen(alert)}
          className="min-w-0 flex-1 basis-60 text-left text-sm font-medium hover:underline hover:underline-offset-4"
        >
          {alert.title}
        </button>
        <span className="font-mono text-xs text-muted">{alert.project ?? "Company-wide"}</span>
        <span className="inline-flex items-center gap-1 text-xs text-subtle">
          <UserRound className="size-3.5" aria-hidden="true" />
          {alert.assignee ?? "HR team"}
        </span>
        <span className="text-xs text-subtle">{alert.raised}</span>
        {onResolve && (
          <button
            type="button"
            onClick={() => onResolve(alert)}
            className="inline-flex h-7 items-center gap-1 rounded-control border border-border-strong bg-surface px-2 text-xs font-medium transition-colors hover:bg-hover"
          >
            <Check className="size-3.5" aria-hidden="true" />
            Mark resolved
          </button>
        )}
      </div>
    </motion.li>
  );
}

type ListProps = {
  alerts: AlertView[];
  label: string;
  onOpen: (alert: AlertView) => void;
  onResolve?: (alert: AlertView) => void;
};

/** A resolved alert collapses out of the list; the counters that read from `alerts` update with it. */
export function AlertList({ alerts, label, onOpen, onResolve }: ListProps) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      <AnimatePresence initial={false}>
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} onOpen={onOpen} onResolve={onResolve} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
