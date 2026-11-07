"use client";

import { RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AiAnswerCard } from "@/components/ui/AiAnswerCard";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { LineRow } from "@/lib/api-types";
import { useAgentRun } from "@/lib/use-agent-run";
import { Level, SourceIcon, plural } from "./parts";

type Props = {
  requestNo: string;
  line: LineRow;
  /** People HR chose in the meantime; they are not offered again. */
  alreadyChosen: string[];
  /** The recommendation was applied: reload the request and say what happened. */
  onApplied: (notice: string) => void;
  onClose: () => void;
};

/**
 * "Ask Workforce agent" on a line: the agent's steps appear as it works, then who it recommends
 * and why, and who the rules dropped. Nothing is chosen until HR presses "Use these".
 */
export function AgentPanel({ requestNo, line, alreadyChosen, onApplied, onClose }: Props) {
  const { run, running, error, start } = useAgentRun();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);

  const ask = () => {
    setApplied(null);
    setApplyError(null);
    void start({ kind: "recommend_line", request_no: requestNo, line_id: line.id });
  };
  // One run is started when the panel opens (React runs effects twice in development).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void start({ kind: "recommend_line", request_no: requestNo, line_id: line.id });
  }, [start, requestNo, line.id]);

  const rec = run?.status === "succeeded" ? run.recommendation : null;
  const fresh = (rec?.selections ?? []).filter((s) => !alreadyChosen.includes(s.code));
  const failed = error !== null || run?.status === "failed" || run?.status === "refused";

  async function apply() {
    if (!run || fresh.length === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await api.choosePeople(
        requestNo,
        line.id,
        fresh.map((s) => s.code),
        run.id,
      );
      const refused = result.results.filter((r) => r.outcome === "refused");
      if (refused.length > 0) {
        const first = refused[0];
        setApplyError(
          `${plural(refused.length, "person", "people")} could not be chosen. ${first.name}: ${
            first.violations[0]?.message ?? "the rules say no"
          }`,
        );
      }
      setApplied(result.chosen);
      if (result.chosen > 0) {
        onApplied(
          `${plural(result.chosen, "worker")} chosen from the Workforce agent’s recommendation. Check them, then approve.`,
        );
      }
    } catch (e) {
      setApplyError(e instanceof ApiError ? e.message : "Couldn’t choose them. Try again.");
    } finally {
      setApplying(false);
    }
  }

  const summary = failed
    ? "The agent could not finish."
    : rec === null
      ? undefined
      : applied !== null && applied > 0
        ? `${plural(applied, "worker")} added to the line.`
        : rec.selections.length === 0
          ? "No one is cleared for the open places."
          : `Recommends ${plural(rec.selections.length, "worker")}${
              rec.shortfall > 0
                ? `, ${plural(rec.shortfall, "place")} ${rec.shortfall === 1 ? "stays" : "stay"} open`
                : ""
            }.`;

  return (
    <div className="flex flex-col gap-2" data-agent-panel>
      <AiAnswerCard
        agent="Workforce agent"
        tier={run?.tier ?? "mid"}
        steps={(run?.steps ?? []).map((s) => ({ title: s.title, detail: s.detail }))}
        pending="Working out the next step"
        running={running}
        summary={summary}
        excluded={rec?.rejected.map((d) => ({
          name: d.name,
          code: d.code,
          reason: d.message,
          rule: d.rule,
        }))}
        excludedTitle="Dropped by the rules"
        why={
          failed
            ? (error ?? run?.error ?? undefined)
            : rec
              ? (rec.note ??
                "Every person was checked against the hard rules again. You decide who goes on the line.")
              : undefined
        }
        actions={
          <>
            {rec && applied === null && fresh.length > 0 && (
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={applying}
                onClick={() => void apply()}
              >
                {applying ? "Choosing…" : `Use these ${fresh.length}`}
              </button>
            )}
            {failed && (
              <button type="button" className={BUTTON} onClick={ask}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Try again
              </button>
            )}
            <button type="button" className={BUTTON} onClick={onClose}>
              Close
            </button>
          </>
        }
      >
        {rec && rec.selections.length > 0 && !(applied && applied > 0) && (
          <ul aria-label="Recommended workers" className="m-0 flex list-none flex-col p-0">
            {rec.selections.map((s, i) => (
              <motion.li
                key={s.code}
                className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-border px-4 py-2 text-sm"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut", delay: Math.min(i, 8) * 0.04 }}
              >
                <span className="min-w-0">
                  <span className="font-medium">{s.name}</span>{" "}
                  <span className="font-mono text-xs text-subtle">{s.code}</span>{" "}
                  <span className="text-xs text-muted">
                    <Level level={s.level} />
                  </span>
                </span>
                <SourceIcon source="agent" />
                <span className="col-span-2 text-xs text-muted">
                  {s.reason}
                  {s.reason_by === "rules" && (
                    <span className="text-subtle"> · reason worded by the rules</span>
                  )}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </AiAnswerCard>
      {applyError && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {applyError}
        </p>
      )}
    </div>
  );
}
