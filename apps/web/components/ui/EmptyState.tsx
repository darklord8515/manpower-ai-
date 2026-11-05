import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  title: string;
  /** Say why it is empty and what to do next. */
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, children, action, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <div className="grid size-10 place-items-center rounded-card border border-border text-subtle">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h3 className="text-md font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted">{children}</p>
      {action}
    </div>
  );
}
