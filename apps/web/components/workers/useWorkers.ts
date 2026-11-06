"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { WorkerDetail, WorkerFacets, WorkerList } from "@/lib/api-types";
import { toApiParams, type WorkersQuery } from "@/lib/workers-query";

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Try again.";

type ListResult = { key: string; list?: WorkerList; error?: string };

/**
 * The directory page for this view. While a new view loads, the previous rows stay on screen
 * (dimmed), so changing a filter never flashes an empty table.
 */
export function useWorkerList(query: WorkersQuery) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ListResult | null>(null);
  const key = `${toApiParams(query)}#${attempt}`;

  useEffect(() => {
    let cancelled = false;
    api
      .workers(query)
      .then((list) => !cancelled && setResult({ key, list }))
      .catch((error: unknown) => !cancelled && setResult({ key, error: messageOf(error) }));
    return () => {
      cancelled = true;
    };
    // `key` already contains everything in `query` that the request uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);

  return {
    list: result?.list ?? null,
    error: result?.error ?? null,
    /** True before the first page arrives. */
    loading: result === null,
    /** True while a changed view is loading behind the rows that are showing. */
    refreshing: result !== null && result.key !== key,
    retry,
  };
}

/** The numbers on the filter chips. If they fail the filters still work; only the counts go. */
export function useWorkerFacets() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ facets?: WorkerFacets; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .workerFacets()
      .then((facets) => !cancelled && setState({ facets }))
      .catch((error: unknown) => !cancelled && setState({ error: messageOf(error) }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState(null);
    setAttempt((n) => n + 1);
  }, []);

  return { facets: state?.facets ?? null, error: state?.error ?? null, retry };
}

type DetailResult = {
  code: string;
  worker?: WorkerDetail;
  error?: { status: number; message: string };
};

/** One worker's profile, loaded when the sheet opens. */
export function useWorkerDetail(code: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<(DetailResult & { attempt: number }) | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    api
      .worker(code)
      .then((worker) => !cancelled && setResult({ code, attempt, worker }))
      .catch(
        (error: unknown) =>
          !cancelled &&
          setResult({
            code,
            attempt,
            error: {
              status: error instanceof ApiError ? error.status : 0,
              message: messageOf(error),
            },
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result && result.code === code && result.attempt === attempt ? result : null;
  return {
    worker: current?.worker ?? null,
    error: current?.error ?? null,
    loading: code !== null && current === null,
    retry,
  };
}
