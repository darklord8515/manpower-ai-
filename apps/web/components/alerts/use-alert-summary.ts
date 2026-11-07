"use client";

import { useEffect, useState } from "react";
import { ALERTS_CHANGED } from "@/lib/alert-events";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

const POLL_MS = 30_000;

/**
 * The numbers behind the bell. It looks again every 30 seconds while the tab is visible, and
 * straight after any change HR saves anywhere in the app (the API client announces those), so the
 * count is never one action behind. With `enabled` false nothing is requested.
 */
export function useAlertSummary(enabled: boolean) {
  const [tick, setTick] = useState(0);
  const load = useLoad(() => api.alertSummary(), `alert-summary#${tick}`, enabled);
  useEffect(() => {
    if (!enabled) return;
    const again = () => setTick((n) => n + 1);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") again();
    }, POLL_MS);
    window.addEventListener(ALERTS_CHANGED, again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(ALERTS_CHANGED, again);
    };
  }, [enabled]);
  return load;
}
