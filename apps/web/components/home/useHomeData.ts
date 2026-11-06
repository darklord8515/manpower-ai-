"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ExpiringDocument, Summary } from "@/lib/api-types";

export type HomeData = { summary: Summary; due: ExpiringDocument[] };

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: HomeData };

/** Everything the Home screens need, from the real API, with a way to try again. */
export function useHomeData(includeDocuments: boolean) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.summary(),
      includeDocuments ? Promise.all([api.expiring("expired"), api.expiring("d30")]) : null,
    ])
      .then(([summary, lists]) => {
        if (cancelled) return;
        const due = lists ? [...lists[0].items, ...lists[1].items] : [];
        setState({ status: "ready", data: { summary, due } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [includeDocuments, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
