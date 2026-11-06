"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

/** How long a number stays on screen after the eye is pressed. */
export const REVEAL_SECONDS = 30;

type Props = {
  workerCode: string;
  documentType: string;
  /** What the number is called, e.g. "Emirates ID number". Used for the button's name. */
  label: string;
  /** The masked form from the profile, e.g. "•••• 4821". */
  masked: string;
  /** Without employee:read_sensitive the number stays masked and there is no eye. */
  canReveal: boolean;
};

/**
 * A number hidden behind an eye. Showing it asks the API, which records who looked; it hides again
 * on its own after 30 seconds, and as soon as the eye is pressed a second time.
 */
export function RevealNumber({ workerCode, documentType, label, masked, canReveal }: Props) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shown === null) return;
    const timer = window.setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [shown]);

  async function toggle() {
    if (shown !== null) {
      setShown(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { number } = await api.revealNumber(workerCode, documentType);
      setShown(number);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t show the number. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm" data-testid={`number-${documentType}`}>
        {shown ?? masked}
      </span>
      {canReveal && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={shown !== null}
          aria-label={`${shown !== null ? "Hide" : "Show"} ${label.toLowerCase()}`}
          title={shown !== null ? "Hide" : "Show (this is recorded)"}
          className="press grid size-7 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60"
        >
          {shown !== null ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      )}
      <span role="status" className="text-xs text-danger-text">
        {error}
      </span>
    </span>
  );
}
