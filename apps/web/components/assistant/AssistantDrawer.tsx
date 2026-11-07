"use client";

import { Maximize2, SquarePen } from "lucide-react";
import Link from "next/link";
import { DetailSheet } from "@/components/ui/DetailSheet";
import type { useChat } from "@/lib/use-chat";
import { ChatThread } from "./ChatThread";

const HEADER_BUTTON =
  "press grid size-8 shrink-0 place-items-center rounded-control text-muted transition-[transform,background-color,color] duration-120 hover:bg-hover hover:text-fg";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chat: ReturnType<typeof useChat>;
};

/** Virtual HR in a right-side drawer: Cmd+K (Ctrl+K) or the top-bar button, on every screen. */
export function AssistantDrawer({ open, onOpenChange, chat }: Props) {
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Virtual HR"
      flush
      headerActions={
        <>
          {chat.turns.length > 0 && (
            <button
              type="button"
              onClick={chat.reset}
              disabled={chat.busy}
              className={HEADER_BUTTON}
              aria-label="Start a new chat"
              title="New chat"
            >
              <SquarePen className="size-4.5" aria-hidden="true" />
            </button>
          )}
          <Link
            href="/assistant"
            onClick={() => onOpenChange(false)}
            className={HEADER_BUTTON}
            aria-label="Open Virtual HR as a page"
            title="Open as a page"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </Link>
        </>
      }
    >
      <ChatThread chat={chat} onNavigate={() => onOpenChange(false)} autoFocus />
    </DetailSheet>
  );
}
