import { TriangleAlert } from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import type { MobilizationRow } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  row: MobilizationRow;
  selected: boolean;
  onOpen: () => void;
};

/** One person in the pipeline. A button: Enter opens their checklist. */
export function MobilizationCard({ row, selected, onOpen }: Props) {
  const total = row.tasks_total;
  return (
    <button
      type="button"
      data-mob={row.mob_no}
      aria-pressed={selected}
      onClick={onOpen}
      className={cn(
        "press flex w-full flex-col gap-1.5 rounded-card border bg-surface p-3 text-left transition-colors hover:bg-hover",
        selected ? "border-accent ring-1 ring-accent" : "border-border",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium whitespace-nowrap">{row.mob_no}</span>
        {row.overdue > 0 && (
          <StatusChip tone="warning" icon={TriangleAlert} label={`${row.overdue} overdue`} />
        )}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">
        {row.worker_name}{" "}
        <span className="font-mono text-xs font-normal text-subtle">{row.worker_code}</span>
      </span>
      <span className="min-w-0 truncate text-xs text-muted">
        {row.trade ? `${row.trade} · ` : ""}
        <span className="font-mono">{row.project_code}</span>
      </span>
      <span className="text-xs text-muted">
        {row.arrived_on
          ? `Arrived ${formatDate(row.arrived_on)}`
          : `Reports ${formatDate(row.report_on)}`}
      </span>
      <span className="flex flex-col gap-1">
        <span
          role="progressbar"
          aria-label={`${row.mob_no} tasks done`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={row.tasks_done}
          className="block h-1.5 overflow-hidden rounded-full bg-sunken"
        >
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-(--dur-base)"
            style={{ width: `${total ? Math.round((row.tasks_done / total) * 100) : 0}%` }}
          />
        </span>
        <span className="text-xs text-muted">
          {row.tasks_done} of {total} tasks done
        </span>
      </span>
    </button>
  );
}
