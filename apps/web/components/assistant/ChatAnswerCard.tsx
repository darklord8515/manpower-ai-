"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AiAnswerCard } from "@/components/ui/AiAnswerCard";
import { BUTTON } from "@/components/ui/button-styles";
import type { AgentStep, ChatAnswer } from "@/lib/api-types";
import { AnswerBlocks } from "./AnswerBlocks";

const AGENT_NAME: Record<string, string> = { workforce: "Workforce agent" };

type Props = {
  answer: ChatAnswer | null;
  steps: AgentStep[];
  running: boolean;
  /** Closes the drawer when an action link is followed. */
  onNavigate?: () => void;
};

/**
 * One answer in the thread. While the Supervisor works its real steps appear one by one; then the
 * summary, the data, how the question was understood, where the numbers were read, and links to the
 * screens that hold the full list. The chat itself never changes data.
 */
export function ChatAnswerCard({ answer, steps, running, onNavigate }: Props) {
  const agent = answer?.agent ? (AGENT_NAME[answer.agent] ?? answer.agent) : "Virtual HR";
  const bad = answer && (answer.kind === "refusal" || answer.kind === "unavailable");
  const badge = !answer
    ? "light"
    : answer.python_only
      ? "Python only"
      : answer.ai_worded
        ? "AI-worded · checked"
        : "Python wording";

  const sources = answer?.sources ?? [];
  const why =
    answer && (answer.why || sources.length > 0) ? (
      <>
        {answer.why}
        {sources.length > 0 && (
          <span className="mt-1 block text-subtle">
            Read {sources.map((s) => `${s.tool.replaceAll("_", " ")} on ${s.as_of}`).join(", ")}.
          </span>
        )}
      </>
    ) : undefined;

  return (
    <AiAnswerCard
      agent={agent}
      tier="light"
      badge={badge}
      steps={steps}
      pending={running && steps.length === 0 ? "Understanding your question" : undefined}
      running={running}
      summary={bad ? undefined : answer?.summary}
      why={why}
      actions={
        answer && answer.actions.length > 0
          ? answer.actions.map((a) => (
              <Link key={a.href} href={a.href} onClick={onNavigate} className={BUTTON}>
                {a.label}
              </Link>
            ))
          : undefined
      }
    >
      {answer && bad && (
        <p
          role="note"
          className="mx-4 mb-3 flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {answer.summary}
        </p>
      )}
      {answer && answer.blocks.length > 0 && <AnswerBlocks blocks={answer.blocks} />}
    </AiAnswerCard>
  );
}
