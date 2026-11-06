"use client";

import { useSyncExternalStore } from "react";
import { periodFor, type DayPeriod } from "./greeting";

const PREVIEW_KEY = "cq.previewPeriod";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Re-check every 30 seconds so the picture and greeting change at 12:00 and 17:00 without a reload.
  const timer = setInterval(onChange, 30_000);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    clearInterval(timer);
    window.removeEventListener("storage", onChange);
  };
}

function current(): DayPeriod {
  try {
    const preview = sessionStorage.getItem(PREVIEW_KEY);
    if (preview === "morning" || preview === "afternoon" || preview === "evening") return preview;
  } catch {
    // Storage blocked: use the real time.
  }
  return periodFor(new Date());
}

/** Presenter tool (demo mode): show a time of day other than the real one for this tab. */
export function setPreviewPeriod(period: DayPeriod | null): void {
  try {
    if (period) sessionStorage.setItem(PREVIEW_KEY, period);
    else sessionStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Storage blocked: the preview simply does not stick.
  }
  listeners.forEach((listener) => listener());
}

export function previewPeriod(): DayPeriod | null {
  try {
    const value = sessionStorage.getItem(PREVIEW_KEY);
    return value === "morning" || value === "afternoon" || value === "evening" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The current part of the day in Dubai. `null` on the server and during hydration, so the page
 * never renders "morning" first and then corrects itself.
 */
export function useDayPeriod(): DayPeriod | null {
  return useSyncExternalStore(subscribe, current, () => null);
}
