"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { AiAnswerCard } from "@/components/ui/AiAnswerCard";
import { BUTTON } from "@/components/ui/button-styles";
import { useAgentRun } from "@/lib/use-agent-run";

type Props = {
  project: string;
  /** The what-if start date the forecast on screen was worked out for, if one was chosen. */
  start: string;
  onClose: () => void;
};

/** "Explain" on a forecast: the Workforce agent puts the numbers on screen into plain words. */
export function ExplainPanel({ project, start, onClose }: Props) {
  const { run, running, error, start: ask } = useAgentRun();
  const body = () => ({ kind: "explain_forecast" as const, project, start: start || null });
  // One run is started when the panel opens (React runs effects twice in development).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask({ kind: "explain_forecast", project, start: start || null });
  }, [ask, project, start]);

  const failed = error !== null || run?.status === "failed" || run?.status === "refused";
  const answer = run?.status === "succeeded" ? run.answer : null;

  return (
    <AiAnswerCard
      agent="Workforce agent"
      tier={run?.tier ?? "mid"}
      steps={(run?.steps ?? []).map((s) => ({ title: s.title, detail: s.detail }))}
      pending="Reading the forecast"
      running={running}
      summary={failed ? "The agent could not explain this forecast." : (answer ?? undefined)}
      why={
        failed
          ? (error ?? run?.error ?? undefined)
          : answer
            ? "Written by AI from the numbers below. The numbers themselves come from the forecast service."
            : undefined
      }
      actions={
        <>
          {failed && (
            <button type="button" className={BUTTON} onClick={() => void ask(body())}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Try again
            </button>
          )}
          <button type="button" className={BUTTON} onClick={onClose}>
            Close
          </button>
        </>
      }
    />
  );
}
