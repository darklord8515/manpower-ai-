import { ArrowRight, Lightbulb } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  /** One sentence about what needs attention, written by a Python service (INSIGHT_PYTHON_ONLY). */
  children: ReactNode;
  /** Where to fix it. */
  href?: string;
  linkLabel?: string;
};

/** The single line a role dashboard leads with: "3 projects short of welders by 12 Feb". */
export function InsightLine({ children, href, linkLabel = "Open" }: Props) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface px-4 py-3 text-sm">
      <Lightbulb className="size-4 shrink-0 text-accent-text" aria-hidden="true" />
      <span className="min-w-0 flex-1 basis-60 font-medium">{children}</span>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-sm font-medium text-fg underline-offset-4 hover:underline"
        >
          {linkLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </p>
  );
}
