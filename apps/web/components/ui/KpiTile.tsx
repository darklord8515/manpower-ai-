"use client";

import type { LucideIcon } from "lucide-react";
import { animate } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatInt, formatPercent } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

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
export const COUNT_DURATION_S = 0.6;

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
  const reduced = usePrefersReducedMotion();
  const [animated, setAnimated] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced) return;
    const controls = animate(from.current, value, {
      duration: COUNT_DURATION_S,
      ease: "easeOut",
      onUpdate: (current) => {
        from.current = current;
        setAnimated(current);
      },
    });
    return () => controls.stop();
  }, [value, reduced]);

  const fmt = (n: number) => (format === "percent" ? formatPercent(n) : formatInt(Math.round(n)));
  const shown = reduced ? value : animated;

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
        {/* The animated number is hidden from assistive technology; it reads the final value once. */}
        <b aria-hidden="true" className="text-xl leading-8 font-semibold">
          {fmt(shown)}
        </b>
        <span className="sr-only">{fmt(value)}</span>
        {of && <span className="text-sm text-subtle">{of}</span>}
      </div>
      {trend && <div className="flex items-center gap-1 text-xs text-muted">{trend}</div>}
      {children}
      {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
    </section>
  );
}
