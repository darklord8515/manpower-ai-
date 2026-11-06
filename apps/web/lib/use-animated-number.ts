"use client";

import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

/** The one animation longer than 200ms: numbers count up so a change is noticed, not missed. */
export const COUNT_DURATION_S = 0.6;

/**
 * Counts from the previous value to `value` (from 0 on first load).
 * With reduced motion the number is simply the value.
 */
export function useAnimatedNumber(value: number): number {
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

  return reduced ? value : animated;
}
