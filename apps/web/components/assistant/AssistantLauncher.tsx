"use client";

import { Bot } from "lucide-react";

/**
 * Whether the floating "ask Virtual HR" button shows: only for people who may use the assistant,
 * never on the Virtual HR page itself (it is already there), and not while the drawer is open.
 */
export function showLauncher({
  canAsk,
  pathname,
  open,
}: {
  canAsk: boolean;
  pathname: string;
  open: boolean;
}): boolean {
  const onAssistantPage = pathname === "/assistant" || pathname.startsWith("/assistant/");
  return canAsk && !onAssistantPage && !open;
}

/** A round chat button, bottom right, that opens Virtual HR in its drawer from any page. */
export function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Chat with Virtual HR"
      aria-keyshortcuts="Control+K Meta+K"
      title="Chat with Virtual HR (Ctrl K)"
      className="press fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 grid size-12 place-items-center rounded-full bg-accent text-accent-on shadow-(--shadow-pop) transition-[transform,background-color] duration-120 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 md:right-6 md:bottom-6"
    >
      <Bot className="size-5.5" aria-hidden="true" />
    </button>
  );
}
