"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

const STEP_S = 0.025;
const MAX_STAGGERED = 8;

/**
 * Entrance for the first rows of a list: rise 6px and fade, 25ms apart. Only the first 8 rows
 * animate; the rest appear at once so a long list never makes people wait. Spread onto
 * `motion.tr`, `motion.li` or `motion.div`. It runs when the row mounts, so editing a row does
 * not replay it.
 */
export function revealProps(index: number) {
  if (index >= MAX_STAGGERED) return { initial: false as const };
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.18, ease: "easeOut" as const, delay: index * STEP_S },
  };
}

export function Reveal({
  index,
  children,
  className,
}: {
  index: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} {...revealProps(index)}>
      {children}
    </motion.div>
  );
}
