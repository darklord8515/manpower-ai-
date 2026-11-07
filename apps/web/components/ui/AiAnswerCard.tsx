"use client";

import { Bot, Check, ChevronRight, Clock, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TraceStep = { title: string; detail?: string };
export type Exclusion = { name: string; code: string; reason: string; rule: string };

type Props = {
  /** "Workforce Agent". */
  agent: string;
  /** Model tier shown in the trace ("mid"). */
  tier: string;
  /** Replaces the "tier …" pill, e.g. "Python only" when no model answered. */
  badge?: string;
  /** Steps reported so far. They come from the agent's real tool calls, one per completed step. */
  steps: TraceStep[];
  /** The step in progress, if any, shown with a clock until it completes. */
  pending?: string;
  running: boolean;
  /** One-line answer, shown once the run is done. */
  summary?: string;
  /** Workers or items the rules excluded, with the reason. Shown as an amber callout. */
  excluded?: Exclusion[];
  /** The callout's heading (the count is added). */
  excludedTitle?: string;
  /** The data (rows, list, table). Appears after the run, animated by the caller. */
  children?: ReactNode;
  /** The "Why" line. */
  why?: ReactNode;
  actions?: ReactNode;
};

const ENTER = { duration: 0.18, ease: "easeOut" } as const;

/**
 * An agent answer: while it works its steps appear one by one; when done, a summary, the data, the
 * reasons and the actions. The steps then collapse into a "Trace" the reader can reopen.
 * Never a wall of chat text.
 */
export function AiAnswerCard({
  agent,
  tier,
  badge,
  steps,
  pending,
  running,
  summary,
  excluded,
  excludedTitle = "Excluded by the agent",
  children,
  why,
  actions,
}: Props) {
  const [userOpen, setUserOpen] = useState(false);
  const traceOpen = running || userOpen;

  return (
    <article
      aria-label={`Answer from the ${agent}`}
      className="overflow-hidden rounded-card border border-border bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-muted">
        <Bot className="size-4" aria-hidden="true" />
        <span>{running ? `${agent} is working…` : agent}</span>
        <span className="ml-auto rounded-full border border-border px-2 leading-5">
          {badge ?? `tier ${tier}`}
        </span>
      </header>

      <div className={cn("border-b border-border", !running && steps.length === 0 && "hidden")}>
        <button
          type="button"
          onClick={() => setUserOpen((v) => !v)}
          disabled={running}
          aria-expanded={traceOpen}
          className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted enabled:hover:bg-hover"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-(--dur-fast)",
              traceOpen && "rotate-90",
            )}
            aria-hidden="true"
          />
          Trace · {steps.length} step{steps.length === 1 ? "" : "s"}
        </button>
        <AnimatePresence initial={false}>
          {traceOpen && (
            <motion.ol
              aria-live="polite"
              className="m-0 flex list-none flex-col gap-2 overflow-hidden px-4 pb-3"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={ENTER}
            >
              {steps.map((step) => (
                <motion.li
                  key={step.title}
                  className="grid grid-cols-[20px_1fr] gap-2 text-xs text-muted"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={ENTER}
                >
                  <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success-text">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                  <span>
                    <b className="block font-medium text-fg">{step.title}</b>
                    {step.detail}
                  </span>
                </motion.li>
              ))}
              {running && pending && (
                <li className="grid grid-cols-[20px_1fr] gap-2 text-xs text-muted">
                  <span className="grid size-5 place-items-center rounded-full bg-sunken text-subtle">
                    <Clock className="size-3" aria-hidden="true" />
                  </span>
                  <b className="font-medium text-fg">{pending}…</b>
                </li>
              )}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>

      {!running && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={ENTER}>
          {summary && <p className="px-4 py-3 text-sm font-medium">{summary}</p>}
          {excluded && excluded.length > 0 && (
            <div
              role="note"
              className="mx-4 mb-3 rounded-control bg-warning-soft px-3 py-2 text-xs text-warning-text"
            >
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                {excludedTitle} ({excluded.length})
              </p>
              <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 pl-[22px]">
                {excluded.map((x) => (
                  <li key={x.code}>
                    <b>{x.name}</b> <span className="font-mono">{x.code}</span>: {x.reason}{" "}
                    <span className="font-mono opacity-85">{x.rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {children}
          {why && <p className="border-t border-border px-4 py-3 text-xs text-muted">{why}</p>}
          {actions && (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">{actions}</div>
          )}
        </motion.div>
      )}
    </article>
  );
}
