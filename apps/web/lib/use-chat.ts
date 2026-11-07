"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { AgentStep, ChatAnswer, ChatMessage, ChatRun } from "./api-types";

const POLL_MS = 600;
const GIVE_UP_AFTER = 5; // polls in a row that failed

export type ChatTurn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      /** working: steps are arriving. done: an answer (even a refusal). error: nothing came back. */
      state: "working" | "done" | "error";
      steps: AgentStep[];
      answer: ChatAnswer | null;
      error: string | null;
      /** The question this answers, so "Try again" can ask it again. */
      ask: string;
    };

function fromMessages(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let ask = "";
  for (const m of messages) {
    if (m.role === "user") {
      ask = m.content;
      turns.push({ id: m.id, role: "user", text: m.content });
    } else {
      turns.push({
        id: m.id,
        role: "assistant",
        state: m.answer ? "done" : "error",
        steps: [],
        answer: m.answer,
        error: m.answer ? null : "This answer was not saved.",
        ask,
      });
    }
  }
  return turns;
}

function finished(run: ChatRun, ask: string, id: string): ChatTurn {
  const answer = run.answer;
  return {
    id,
    role: "assistant",
    state: answer ? "done" : "error",
    steps: run.steps,
    answer,
    error: answer ? null : (run.error ?? "The assistant could not answer. Try again."),
    ask,
  };
}

/**
 * One chat thread: sends a question, follows its run (steps appear as the server does the work) and
 * keeps the thread. A question is shown at once; the answer arrives when the server has it.
 */
export function useChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [active, setActive] = useState<{ runId: string; ask: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const { runId, ask } = active;

    const poll = async () => {
      try {
        const run = await api.chatAnswer(runId);
        if (stopped) return;
        failures = 0;
        if (run.status === "running") {
          setTurns((all) =>
            all.map((t) =>
              t.id === runId && t.role === "assistant" ? { ...t, steps: run.steps } : t,
            ),
          );
        } else {
          setTurns((all) => all.map((t) => (t.id === runId ? finished(run, ask, runId) : t)));
          setActive(null);
          return;
        }
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= GIVE_UP_AFTER) {
          setTurns((all) =>
            all.map((t) =>
              t.id === runId && t.role === "assistant"
                ? { ...t, state: "error", error: "Lost touch with the server. Try again." }
                : t,
            ),
          );
          setActive(null);
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
  }, [active]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || active) return;
      idRef.current += 1;
      const localId = `local-${idRef.current}`;
      setTurns((all) => [...all, { id: localId, role: "user", text }]);
      try {
        const started = await api.sendChat(text, conversationId);
        setConversationId(started.conversation_id);
        setTurns((all) => [
          ...all,
          {
            id: started.run_id,
            role: "assistant",
            state: "working",
            steps: [],
            answer: null,
            error: null,
            ask: text,
          },
        ]);
        setActive({ runId: started.run_id, ask: text });
      } catch (e) {
        const message =
          e instanceof ApiError ? e.message : "Couldn’t send your question. Try again.";
        idRef.current += 1;
        setTurns((all) => [
          ...all,
          {
            id: `local-${idRef.current}`,
            role: "assistant",
            state: "error",
            steps: [],
            answer: null,
            error: message,
            ask: text,
          },
        ]);
      }
    },
    [active, conversationId],
  );

  const open = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    setActive(null);
    try {
      const view = await api.conversation(id);
      setConversationId(view.id);
      setTurns(fromMessages(view.messages));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn’t open that conversation.");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setActive(null);
    setTurns([]);
    setConversationId(null);
    setLoadError(null);
  }, []);

  /** Drops an error turn so the same question can be asked again. */
  const retry = useCallback(
    (turnId: string) => {
      const at = turns.findIndex((t) => t.id === turnId);
      const failed = turns[at];
      if (!failed || failed.role !== "assistant") return;
      // Both the failed answer and the question it belonged to go; asking again puts the question back.
      const questionAt = at > 0 && turns[at - 1].role === "user" ? at - 1 : -1;
      setTurns((all) => all.filter((_, i) => i !== at && i !== questionAt));
      void send(failed.ask);
    },
    [turns, send],
  );

  return {
    turns,
    conversationId,
    busy: active !== null,
    loading,
    loadError,
    send,
    open,
    reset,
    retry,
  };
}
