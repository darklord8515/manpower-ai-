"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

type Result<T> = { key: string; data?: T; error?: string };

/**
 * Loads something from the API and keeps the previous result on screen while a changed request
 * (a new `key`) loads, so a screen never flashes empty. `retry` asks again. With `enabled` false
 * nothing is requested (a widget that is switched off costs nothing).
 */
export function useLoad<T>(load: () => Promise<T>, key: string, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const full = `${key}#${attempt}`;

  useEffect(() => {
    if (!enabled) return; // nothing is asked for something that is not on screen
    let cancelled = false;
    load()
      .then((data) => !cancelled && setResult({ key: full, data }))
      .catch(
        (error: unknown) =>
          !cancelled &&
          setResult({
            key: full,
            error: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
          }),
      );
    return () => {
      cancelled = true;
    };
    // `full` stands for everything `load` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, enabled]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result?.key === full ? result : null;
  return {
    data: current?.data ?? result?.data ?? null,
    error: current?.error ?? null,
    /** True until the first answer arrives. */
    loading: enabled && result === null,
    /** True while a changed request loads behind the previous answer. */
    refreshing: result !== null && current === null,
    retry,
  };
}
