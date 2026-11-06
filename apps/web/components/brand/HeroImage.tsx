"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { DayPeriod } from "@/lib/greeting";

type Props = {
  /** `null` until the browser knows the time (server render and hydration): shows the dark fallback. */
  period: DayPeriod | null;
  className?: string;
  /** Load this picture early: use on the one hero that is visible when the page opens. */
  priority?: boolean;
  /** Where the dark overlay sits so text stays readable and the scene stays vivid. */
  overlay?: "left" | "full" | "both";
  /** CSS `sizes` for the responsive image, e.g. "(min-width: 1024px) 60vw, 100vw". */
  sizes: string;
  children?: React.ReactNode;
};

const OVERLAY = {
  // Only the text side is darkened; the palms, water and sky stay vivid.
  left: "bg-[linear-gradient(90deg,rgb(12_10_9/72%)_0%,rgb(12_10_9/45%)_38%,rgb(12_10_9/0%)_72%)]",
  full: "bg-(--photo-overlay)",
  // Dark at the top (logo) and the bottom (caption), clear in the middle: the sign-in picture.
  both: "bg-[linear-gradient(180deg,rgb(12_10_9/58%)_0%,rgb(12_10_9/6%)_42%,rgb(12_10_9/10%)_62%,rgb(12_10_9/72%)_100%)]",
} as const;

/**
 * The time-of-day picture (morning, afternoon, evening). One picture is loaded at a time and it
 * cross-fades when the period changes. The picture is decorative, so it has no alt text; the
 * greeting beside it says the same thing in words.
 */
export function HeroImage({
  period,
  className,
  priority,
  overlay = "left",
  sizes,
  children,
}: Props) {
  return (
    <div className={cn("relative isolate overflow-hidden bg-(--photo-fallback)", className)}>
      <AnimatePresence initial={false}>
        {period && (
          <motion.div
            key={period}
            className="absolute inset-0 -z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <Image
              src={`/hero/${period}.webp`}
              alt=""
              fill
              sizes={sizes}
              priority={priority}
              className="object-cover"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className={cn("absolute inset-0 -z-10", OVERLAY[overlay])} aria-hidden="true" />
      {children}
    </div>
  );
}
