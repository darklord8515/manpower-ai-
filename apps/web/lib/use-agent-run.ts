"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { AgentRun, AgentRunBody } from "./api-types";

const POLL_MS = 700;
const GIVE_UP_AFTER = 5; // answers in a row that failed

/**
 * Starts one agent run and follows it: asks for its steps every moment until it ends, so a screen
 * can show them as they happen. Starting again forgets the last run. It stops when the screen goes.
 */
export function useAgentRun() {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (body: AgentRunBody) => {
    setStarting(true);
    setError(null);
    setRun(null);
    setRunId(null);
    try {
      setRunId((await api.startAgentRun(body)).id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t start the agent. Try again.");
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const next = await api.agentRun(runId);
        if (stopped) return;
        failures = 0;
        setRun(next);
        if (next.status !== "running") return;
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= GIVE_UP_AFTER) {
          setError("Lost touch with the server. Try again.");
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const ended = run !== null && run.status !== "running";
  const running = error === null && (starting || (runId !== null && !ended));
  return { run, error, running, start };
}
