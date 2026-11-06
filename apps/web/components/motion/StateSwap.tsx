"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Cross-fades between states (loading, data, empty, error) so a screen never jumps.
 * `stateKey` must change when the state changes. The first render does not animate.
 */
export function StateSwap({
  stateKey,
  children,
  className,
}: {
  stateKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={stateKey}
        className={className}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
