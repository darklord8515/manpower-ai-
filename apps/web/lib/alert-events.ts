/**
 * "Something changed that can change an alert." The API client announces it after any successful
 * write, so the bell and the Action Center refresh right away instead of waiting for their next poll.
 * (The server runs the detectors after the same writes, see docs/rules.md ALERT_RUN.)
 */
export const ALERTS_CHANGED = "alerts:changed";

export function announceAlertsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ALERTS_CHANGED));
}
