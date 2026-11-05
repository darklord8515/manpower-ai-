import { cn } from "@/lib/utils";

type Props = {
  /** Announced to assistive technology while loading. */
  label: string;
  variant?: "lines" | "rows" | "tile";
  count?: number;
  className?: string;
};

/**
 * Shimmering placeholder. Each variant matches the layout it replaces so nothing jumps when the
 * data arrives. The shimmer is the only looping animation allowed, and only while loading.
 */
export function SkeletonLoader({ label, variant = "lines", count = 3, className }: Props) {
  const widths = ["w-2/3", "w-1/2", "w-1/3", "w-3/4"];
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn(className)}>
      {variant === "lines" &&
        Array.from({ length: count }, (_, i) => (
          <div key={i} className={cn("skeleton mb-2 h-5 last:mb-0", widths[i % widths.length])} />
        ))}
      {variant === "rows" &&
        Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton mb-2 h-11 w-full last:mb-0" />
        ))}
      {variant === "tile" && (
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="skeleton mb-3 h-4 w-1/2" />
          <div className="skeleton mb-3 h-8 w-1/3" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      )}
    </div>
  );
}
