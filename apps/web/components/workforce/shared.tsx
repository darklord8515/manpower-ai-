"use client";

import {
  CircleCheck,
  ClipboardCheck,
  Clock,
  FileText,
  UserMinus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { ApiError } from "@/lib/api";
import type { WCounts, WPerson } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong. Try again.";

/** The steps a person goes through, in order. */
export const STEPS: { status: string; label: string }[] = [
  { status: "offer_issued", label: "Offer issued" },
  { status: "documents_cleared", label: "Documents cleared" },
  { status: "active", label: "Joined" },
];

const STATUS: Record<string, [string, Tone, LucideIcon]> = {
  offer_issued: ["Offer issued", "info", FileText],
  documents_cleared: ["Documents cleared", "warning", ClipboardCheck],
  active: ["Joined", "success", CircleCheck],
  on_leave: ["On leave", "neutral", Clock],
  suspended: ["Suspended", "neutral", Clock],
  resigned: ["Resigned", "neutral", UserMinus],
  terminated: ["Terminated", "neutral", UserMinus],
  absconded: ["Left without notice", "neutral", UserMinus],
};

export const STATUS_FILTERS: [string, string][] = [
  ["", "Everyone"],
  ["offer_issued", "Offer issued"],
  ["documents_cleared", "Documents cleared"],
  ["active", "Joined"],
  ["resigned", "Resigned"],
];

export function StatusPill({ status }: { status: string }) {
  const [label, tone, icon] = STATUS[status] ?? [status, "neutral", Clock];
  return <StatusChip tone={tone} icon={icon} label={label} />;
}

export const STAGE_TONE: Record<string, Tone> = {
  pre_construction: "info",
  planning: "info",
  active: "success",
  handover: "warning",
  completed: "neutral",
  on_hold: "neutral",
};

/** Joined, on the way and still-to-hire as one bar, against what the project plans. */
export function StackBar({
  counts,
  scale,
}: {
  counts: Pick<WCounts, "planned" | "active" | "pipeline" | "to_hire">;
  scale: number;
}) {
  const pct = (n: number) => `${scale > 0 ? Math.min(100, (n / scale) * 100) : 0}%`;
  return (
    <span
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-(--track)"
      role="img"
      aria-label={`${counts.active} joined, ${counts.pipeline} on the way, ${counts.to_hire} still to hire, of ${counts.planned} planned`}
    >
      <span className="h-full bg-(--chart-strong)" style={{ width: pct(counts.active) }} />
      <span className="h-full bg-(--chart-mid)" style={{ width: pct(counts.pipeline) }} />
      <span className="h-full bg-accent" style={{ width: pct(counts.to_hire) }} />
    </span>
  );
}

export function Legend() {
  return (
    <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {[
        ["bg-(--chart-strong)", "Joined"],
        ["bg-(--chart-mid)", "On the way (offer, documents)"],
        ["bg-accent", "Still to hire"],
      ].map(([color, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", color)} aria-hidden="true" />
          {label}
        </span>
      ))}
    </p>
  );
}

/** A table of people. `showProject` adds the column that says where each person is. */
export function PeopleTable({
  items,
  showProject,
  onOpen,
  caption,
}: {
  items: WPerson[];
  showProject: boolean;
  onOpen: (code: string) => void;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-sunken text-left text-xs text-muted">
            {["Name", "Designation", ...(showProject ? ["Project"] : []), "Status", "Joined"].map(
              (h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.code} className="border-t border-border hover:bg-hover">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onOpen(p.code)}
                  className="text-left font-medium hover:underline"
                >
                  {p.name}
                </button>
                <span className="block font-mono text-xs text-muted">{p.code}</span>
              </td>
              <td className="px-3 py-2">
                {p.designation}
                {p.uae_national && <span className="ml-1.5 text-xs text-muted">UAE national</span>}
                {p.discipline && <span className="block text-xs text-muted">{p.discipline}</span>}
              </td>
              {showProject && (
                <td className="px-3 py-2">
                  {p.project_code ? (
                    <Link href={`/projects/${p.project_code}`} className="hover:underline">
                      {p.project_name}
                    </Link>
                  ) : (
                    <span className="text-muted">Not placed</span>
                  )}
                </td>
              )}
              <td className="px-3 py-2">
                <StatusPill status={p.status} />
              </td>
              <td className="px-3 py-2 tabular-nums">
                {p.joined_on ? formatDate(p.joined_on) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
