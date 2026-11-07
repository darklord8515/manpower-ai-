"use client";

import { Bot, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api } from "@/lib/api";
import type { ChatSuggestions } from "@/lib/api-types";
import type { useChat } from "@/lib/use-chat";
import { ChatAnswerCard } from "./ChatAnswerCard";

const MAX = 1000;

type Props = {
  chat: ReturnType<typeof useChat>;
  /** Called when an answer's link is followed (the drawer closes). */
  onNavigate?: () => void;
  autoFocus?: boolean;
};

function Welcome({ chat }: { chat: ReturnType<typeof useChat> }) {
  const [suggestions, setSuggestions] = useState<ChatSuggestions | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    api
      .chatSuggestions()
      .then((s) => !stopped && setSuggestions(s))
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
    };
  }, []);

  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-4 px-2 py-6 text-center">
      <div className="grid size-11 place-items-center rounded-card border border-border text-subtle">
        <Bot className="size-5.5" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-md font-semibold">Ask Virtual HR</h3>
        <p className="mt-1 text-sm text-muted">
          Ask about workers, documents, alerts, projects, forecasts and staffing requests. I answer
          from ConstructIQ’s own data, as you, and I never change anything.
        </p>
      </div>
      {suggestions && !suggestions.ai_enabled && (
        <p role="note" className="rounded-control bg-info-soft px-3 py-2 text-xs text-info-text">
          No AI model is set up on this server, so I answer plain questions with Python only.
        </p>
      )}
      {failed && <p className="text-xs text-subtle">Suggestions are not available right now.</p>}
      {suggestions && (
        <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
          {suggestions.items.map((text) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => void chat.send(text)}
                className="press rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-hover"
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The thread and its composer, shared by the Cmd+K drawer and the Ask HR page. */
export function ChatThread({ chat, onNavigate, autoFocus }: Props) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { turns, busy, loading, loadError } = chat;
  const lastSteps = turns.at(-1)?.role === "assistant" ? turns.at(-1) : undefined;
  const stepCount = lastSteps && lastSteps.role === "assistant" ? lastSteps.steps.length : 0;

  // Keep the newest answer in view as it grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, stepCount, lastSteps?.id]);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  function grow() {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    requestAnimationFrame(grow);
    void chat.send(text);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label="Conversation with Virtual HR"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 [&>*]:shrink-0"
      >
        {loading ? (
          <SkeletonLoader label="Opening the conversation" variant="rows" count={3} />
        ) : loadError ? (
          <ErrorState title="Couldn’t open this conversation">{loadError}</ErrorState>
        ) : turns.length === 0 ? (
          <Welcome chat={chat} />
        ) : (
          turns.map((turn) =>
            turn.role === "user" ? (
              <div key={turn.id} className="flex justify-end">
                <p className="m-0 max-w-[85%] rounded-card bg-sunken px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap">
                  {turn.text}
                </p>
              </div>
            ) : turn.state === "error" ? (
              <div key={turn.id} className="rounded-card border border-border bg-surface px-4 py-3">
                <ErrorState
                  title="No answer"
                  onRetry={
                    turn.error?.includes("Wait for the answer")
                      ? undefined
                      : () => chat.retry(turn.id)
                  }
                >
                  {turn.error}
                </ErrorState>
              </div>
            ) : (
              <ChatAnswerCard
                key={turn.id}
                answer={turn.answer}
                steps={turn.steps}
                running={turn.state === "working"}
                onNavigate={onNavigate}
              />
            ),
          )
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border bg-surface p-3">
        <label htmlFor="chat-question" className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="chat-question"
            ref={box}
            value={draft}
            rows={1}
            maxLength={MAX}
            onChange={(e) => {
              setDraft(e.target.value);
              grow();
            }}
            onKeyDown={onKey}
            placeholder="Ask about workers, documents, alerts…"
            className="max-h-35 min-h-9 w-full min-w-0 resize-none rounded-control border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-subtle"
          />
          <button
            type="submit"
            disabled={busy || draft.trim() === ""}
            aria-busy={busy}
            className={PRIMARY_BUTTON}
          >
            <SendHorizontal className="size-4" aria-hidden="true" />
            Send
          </button>
        </div>
        <p className="mt-1.5 flex justify-between text-xs text-subtle">
          <span>Enter to send · Shift+Enter for a new line</span>
          {draft.length > 800 && (
            <span aria-live="polite">
              {draft.length}/{MAX}
            </span>
          )}
        </p>
      </form>
    </div>
  );
}
