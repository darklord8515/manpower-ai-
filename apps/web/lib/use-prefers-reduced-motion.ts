import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when the user asked the OS for less motion.
 *
 * Built on useSyncExternalStore so the server render and the first client render agree (both
 * `false`), and React then updates to the real value without a hydration mismatch. Components
 * that show different text for reduced motion would otherwise fail to hydrate.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
