"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Content rises 4px and fades in whenever `transitionKey` changes (pass the route path).
 * No exit animation: the next screen should feel instant, not wait for the last one to leave.
 */
export function PageTransition({
  transitionKey,
  children,
  className,
}: {
  transitionKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      key={transitionKey}
      className={className}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
