"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NumberTicker } from "@/components/motion/NumberTicker";

type Props = {
  label: string;
  icon: LucideIcon;
  value: number;
  format?: "int" | "percent";
  /** "of 150" beside the number. */
  of?: string;
  /** Trend on its own line under the number, e.g. "+6 this week". */
  trend?: ReactNode;
  detail?: ReactNode;
  /** A small visual under the number (e.g. a segment bar). */
  children?: ReactNode;
};

/** Counts up on first load and from the old value to the new one whenever `value` changes. */
export function KpiTile({
  label,
  icon: Icon,
  value,
  format = "int",
  of,
  trend,
  detail,
  children,
}: Props) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-center gap-2 text-sm whitespace-nowrap text-muted">
        <Icon className="size-4 text-subtle" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <NumberTicker value={value} format={format} className="text-xl leading-8 font-semibold" />
        {of && <span className="text-sm text-subtle">{of}</span>}
      </div>
      {trend && <div className="flex items-center gap-1 text-xs text-muted">{trend}</div>}
      {children}
      {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
    </section>
  );
}
