import { RefreshCw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { StatusChip } from "./StatusChip";

type Props = {
  /** Short label for the chip, e.g. "API unreachable". */
  title: string;
  /** What happened and what to do about it. */
  children: ReactNode;
  onRetry?: () => void;
};

/** Every list and panel has an error state: the reason, and a Retry that works. */
export function ErrorState({ title, children, onRetry }: Props) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <StatusChip tone="danger" icon={XCircle} label={title} />
      <p className="text-sm text-muted">{children}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-hover"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
