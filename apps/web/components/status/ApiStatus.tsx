"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";

type State =
  | { kind: "loading"; slow: boolean }
  | { kind: "ok"; env: string }
  | { kind: "degraded"; env: string }
  | { kind: "error" };

/** After this long without an answer we tell the user the API may be waking up (free hosting). */
const SLOW_AFTER_MS = 4000;

type HealthBody = { status?: string; db?: string; env?: string };

export function ApiStatus({ baseUrl }: { baseUrl: string }) {
  const [state, setState] = useState<State>({ kind: "loading", slow: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = setTimeout(() => {
      setState((s) => (s.kind === "loading" ? { kind: "loading", slow: true } : s));
    }, SLOW_AFTER_MS);

    fetch(`${baseUrl}/health`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as HealthBody;
        const env = body.env ?? "unknown";
        setState(response.ok && body.db === "ok" ? { kind: "ok", env } : { kind: "degraded", env });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      })
      .finally(() => clearTimeout(slowTimer));

    return () => {
      controller.abort();
      clearTimeout(slowTimer);
    };
  }, [baseUrl, attempt]);

  function retry() {
    setState({ kind: "loading", slow: false });
    setAttempt((n) => n + 1);
  }

  return (
    <section
      aria-labelledby="status-title"
      className="rounded-card border border-border bg-surface"
    >
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <h2 id="status-title" className="text-base font-semibold">
          System status
        </h2>
        <span className="ml-auto rounded-full border border-border px-2 text-xs leading-5 font-medium text-muted">
          Foundation build
        </span>
      </div>

      <div className="border-t border-border px-5 py-4" aria-live="polite">
        {state.kind === "loading" && (
          <>
            <SkeletonLoader label="Checking the API" count={3} />
            {state.slow && (
              <p className="mt-3 text-xs text-subtle">
                Still waiting. On free hosting the API sleeps after 15 minutes and takes about a
                minute to wake.
              </p>
            )}
          </>
        )}

        {(state.kind === "ok" || state.kind === "degraded") && (
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted">API</dt>
            <dd>
              <StatusChip tone="success" icon={CheckCircle2} label="Running" />
            </dd>
            <dt className="text-muted">Database</dt>
            <dd>
              {state.kind === "ok" ? (
                <StatusChip tone="success" icon={CheckCircle2} label="Connected" />
              ) : (
                <StatusChip tone="warning" icon={TriangleAlert} label="Unreachable" />
              )}
            </dd>
            <dt className="text-muted">Environment</dt>
            <dd className="font-mono text-xs">{state.env}</dd>
          </dl>
        )}

        {state.kind === "error" && (
          <ErrorState title="API unreachable" onRetry={retry}>
            The web app couldn&apos;t reach the API at{" "}
            <span className="font-mono text-xs">{baseUrl}</span>. Start it with{" "}
            <span className="font-mono text-xs">make dev</span>, or wait a minute if it is waking up
            on free hosting.
          </ErrorState>
        )}
      </div>
    </section>
  );
}
