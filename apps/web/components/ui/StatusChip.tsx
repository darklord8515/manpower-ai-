"use client";

import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  info: "bg-info-soft text-info-text",
  neutral: "bg-sunken text-muted",
};

type Props = {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  className?: string;
};

/**
 * Status is never shown by colour alone: every chip has an icon and a text label.
 * When the state changes, the old label fades out and the new one fades in, and the tint
 * cross-fades through CSS.
 */
export function StatusChip({ tone, icon: Icon, label, className }: Props) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-5.5 items-center overflow-hidden rounded-control text-xs font-medium whitespace-nowrap transition-colors duration-(--dur-base)",
        TONES[tone],
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={`${tone}:${label}`}
          className="inline-flex items-center gap-1 px-2"
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
