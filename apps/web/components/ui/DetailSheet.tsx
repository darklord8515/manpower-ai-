"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Small line under the title (code, status chips...). */
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** The content manages its own padding and scrolling (the chat), instead of the sheet's. */
  flush?: boolean;
  /** Extra controls in the header, beside the close button. */
  headerActions?: ReactNode;
};

const SLIDE = { duration: 0.18, ease: "easeOut" } as const;

/**
 * Right-side sheet: detail never takes the user away from the list behind it.
 * Slides in from the right; Esc, the close button and the scrim all close it; focus moves in and
 * returns to whatever opened it; the page behind is inert while it is open (Radix Dialog).
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  meta,
  children,
  footer,
  flush,
  headerActions,
}: Props) {
  // Radix only hands focus back to a Dialog.Trigger. This sheet is opened by any button or row, so
  // remember what had focus when it opened and return there, or keyboard users lose their place.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-70 bg-(--scrim)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SLIDE}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={() => {
                opener.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (opener.current?.isConnected) opener.current.focus();
              }}
            >
              <motion.aside
                className="fixed inset-y-0 right-0 z-80 flex w-[min(480px,100vw)] flex-col border-l border-border bg-surface shadow-(--shadow-pop)"
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 24, opacity: 0 }}
                transition={SLIDE}
              >
                <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="text-md font-semibold">{title}</Dialog.Title>
                    {meta && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {meta}
                      </div>
                    )}
                  </div>
                  {headerActions}
                  <Dialog.Close
                    className="grid size-8 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-fg"
                    aria-label={`Close ${title}`}
                  >
                    <X className="size-4.5" aria-hidden="true" />
                  </Dialog.Close>
                </header>
                {flush ? (
                  <div className="flex min-h-0 flex-1 flex-col">{children}</div>
                ) : (
                  <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">{children}</div>
                )}
                {footer && (
                  <footer className="border-t border-border px-5 py-3 text-xs text-subtle">
                    {footer}
                  </footer>
                )}
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
