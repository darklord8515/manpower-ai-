"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

type Result<T> = { key: string; data?: T; error?: string };

/**
 * Loads something from the API and keeps the previous result on screen while a changed request
 * (a new `key`) loads, so a screen never flashes empty. `retry` asks again.
 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const full = `${key}#${attempt}`;

  useEffect(() => {
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
  }, [full]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result?.key === full ? result : null;
  return {
    data: current?.data ?? result?.data ?? null,
    error: current?.error ?? null,
    /** True until the first answer arrives. */
    loading: result === null,
    /** True while a changed request loads behind the previous answer. */
    refreshing: result !== null && current === null,
    retry,
  };
}
