"use client";

import { History, MessageSquare, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";
import { BUTTON, SMALL_BUTTON } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useChat } from "@/lib/use-chat";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { ChatThread } from "./ChatThread";

/**
 * Virtual HR as a page: your conversations on the left, the thread on the right. The same thread and
 * answers as the Cmd+K drawer. Conversations are private to you; deleting one removes its messages.
 */
export function AssistantScreen() {
  const chat = useChat();
  const list = useLoad(() => api.conversations(), `${chat.conversationId}:${chat.busy}`);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  async function remove(id: string) {
    setConfirming(null);
    try {
      await api.deleteConversation(id);
      if (chat.conversationId === id) chat.reset();
      list.retry();
      setNotice({ tone: "ok", text: "Conversation deleted." });
    } catch (e) {
      setNotice({
        tone: "error",
        text: e instanceof ApiError ? e.message : "Couldn’t delete that conversation.",
      });
    }
  }

  const history = (
    <nav aria-label="Your conversations" className="flex min-h-0 flex-1 flex-col gap-2">
      {list.loading ? (
        <SkeletonLoader label="Loading your conversations" variant="rows" count={4} />
      ) : list.error ? (
        <ErrorState title="Couldn’t load your conversations" onRetry={list.retry}>
          {list.error}
        </ErrorState>
      ) : list.data && list.data.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No conversations yet" className="px-2 py-6">
          Your questions will be kept here, only for you.
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 overflow-y-auto p-0">
          {list.data?.map((c) => {
            const current = c.id === chat.conversationId;
            return (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={chat.busy}
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    setShowHistory(false);
                    void chat.open(c.id);
                  }}
                  className={cn(
                    "press min-w-0 flex-1 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-hover disabled:opacity-60",
                    current && "bg-hover",
                  )}
                >
                  <span className="block truncate text-sm font-medium">{c.title}</span>
                  <span className="text-xs text-subtle">{formatDate(c.updated_at)}</span>
                </button>
                {confirming === c.id ? (
                  <button
                    type="button"
                    onClick={() => void remove(c.id)}
                    className={cn(SMALL_BUTTON, "border-danger text-danger-text")}
                    autoFocus
                  >
                    Delete?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(c.id)}
                    onBlur={() => setConfirming((v) => (v === c.id ? null : v))}
                    aria-label={`Delete conversation: ${c.title}`}
                    className="press grid size-7 shrink-0 place-items-center rounded-control text-subtle transition-colors hover:bg-hover hover:text-fg"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Virtual HR</h1>
          <p className="text-sm text-muted">
            Ask in plain words. Answers come from HAMRA AI’s own data, as you, and nothing is
            changed from here.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className={cn(BUTTON, "md:hidden")}
          >
            <History className="size-4" aria-hidden="true" />
            History
          </button>
          <button type="button" onClick={chat.reset} disabled={chat.busy} className={BUTTON}>
            <SquarePen className="size-4" aria-hidden="true" />
            New chat
          </button>
        </div>
      </header>

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-control px-3 py-2 text-sm",
            notice.tone === "error"
              ? "bg-danger-soft text-danger-text"
              : "bg-success-soft text-success-text",
          )}
        >
          {notice.text}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <div
          className={cn(
            "flex max-h-72 flex-col rounded-card border border-border bg-surface p-2 md:max-h-[calc(100dvh-13rem)]",
            !showHistory && "hidden md:flex",
          )}
        >
          {history}
        </div>
        <div className="flex h-[calc(100dvh-13rem)] min-h-96 flex-col overflow-hidden rounded-card border border-border bg-surface">
          <ChatThread chat={chat} />
        </div>
      </div>
    </div>
  );
}
