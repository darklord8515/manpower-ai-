"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

export type Tab = { id: string; label: string; count?: number };

type Props = {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  /** Names the group for screen readers, e.g. "When it expires". */
  label: string;
  className?: string;
};

/**
 * Segmented control whose highlight slides to the chosen option (one shared `layoutId`).
 * Plain toggle buttons (`aria-pressed`), so Tab, Enter and Space work with no extra keyboard code.
 */
export function SlidingTabs({ tabs, value, onChange, label, className }: Props) {
  const group = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full overflow-x-auto rounded-control border border-border bg-surface",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative h-7 shrink-0 px-3 text-xs whitespace-nowrap transition-colors",
              active ? "font-medium text-fg" : "text-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${group}-pill`}
                aria-hidden="true"
                className="absolute inset-0 bg-sunken"
                transition={{ type: "spring", stiffness: 520, damping: 42 }}
              />
            )}
            <span className="relative">
              {tab.label}
              {tab.count !== undefined && ` · ${tab.count}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
