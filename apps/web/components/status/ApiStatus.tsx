"use client";

import { CheckCircle2, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type State =
  | { kind: "loading"; slow: boolean }
  | { kind: "ok"; env: string }
  | { kind: "degraded"; env: string }
  | { kind: "error" };

/** After this long without an answer we tell the user the API may be waking up (free hosting). */
const SLOW_AFTER_MS = 4000;

type HealthBody = { status?: string; db?: string; env?: string };

function Chip({
  tone,
  icon,
  label,
}: {
  tone: "success" | "warning" | "danger";
  icon: React.ReactNode;
  label: string;
}) {
  const tones = {
    success: "bg-success-soft text-success-text",
    warning: "bg-warning-soft text-warning-text",
    danger: "bg-danger-soft text-danger-text",
  } as const;
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors duration-[var(--dur-base)] ${tones[tone]}`}
    >
      {icon}
      {label}
    </span>
  );
}

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
      <div className="flex items-center gap-3 px-5 pb-3 pt-4">
        <h2 id="status-title" className="text-base font-semibold">
          System status
        </h2>
        <span className="ml-auto rounded-full border border-border px-2 text-xs font-medium leading-5 text-muted">
          Foundation build
        </span>
      </div>

      <div className="border-t border-border px-5 py-4" aria-live="polite">
        {state.kind === "loading" && (
          <div aria-busy="true" aria-label="Checking the API">
            <div className="skeleton mb-2 h-5 w-2/3" />
            <div className="skeleton mb-2 h-5 w-1/2" />
            <div className="skeleton h-5 w-1/3" />
            {state.slow && (
              <p className="mt-3 text-xs text-subtle">
                Still waiting. On free hosting the API sleeps after 15 minutes and takes about a
                minute to wake.
              </p>
            )}
          </div>
        )}

        {(state.kind === "ok" || state.kind === "degraded") && (
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted">API</dt>
            <dd>
              <Chip
                tone="success"
                icon={<CheckCircle2 className="size-3.5" aria-hidden="true" />}
                label="Running"
              />
            </dd>
            <dt className="text-muted">Database</dt>
            <dd>
              {state.kind === "ok" ? (
                <Chip
                  tone="success"
                  icon={<CheckCircle2 className="size-3.5" aria-hidden="true" />}
                  label="Connected"
                />
              ) : (
                <Chip
                  tone="warning"
                  icon={<TriangleAlert className="size-3.5" aria-hidden="true" />}
                  label="Unreachable"
                />
              )}
            </dd>
            <dt className="text-muted">Environment</dt>
            <dd className="font-mono text-xs">{state.env}</dd>
          </dl>
        )}

        {state.kind === "error" && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <Chip
              tone="danger"
              icon={<XCircle className="size-3.5" aria-hidden="true" />}
              label="API unreachable"
            />
            <p className="text-sm text-muted">
              The web app couldn&apos;t reach the API at{" "}
              <span className="font-mono text-xs">{baseUrl}</span>. Start it with{" "}
              <span className="font-mono text-xs">make dev</span>, or wait a minute if it is waking
              up on free hosting.
            </p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex h-8 items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-hover"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
