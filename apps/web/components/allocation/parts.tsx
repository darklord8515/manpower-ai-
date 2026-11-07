"use client";

import {
  Bot,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Link2,
  ListChecks,
  User,
} from "lucide-react";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import type { BoardCandidate, PickRow, RequestStatus, Violation } from "@/lib/api-types";
import { formatDate } from "@/lib/format";

const STATUS: Record<RequestStatus, { tone: Tone; icon: typeof Clock; label: string }> = {
  draft: { tone: "neutral", icon: Clock, label: "Draft" },
  submitted: { tone: "info", icon: Clock, label: "Waiting for approval" },
  in_review: { tone: "info", icon: Clock, label: "In review" },
  approved: { tone: "success", icon: CircleCheck, label: "Approved" },
  partially_filled: { tone: "warning", icon: CircleAlert, label: "Partly filled" },
  filled: { tone: "success", icon: CircleCheck, label: "Filled" },
  rejected: { tone: "danger", icon: CircleX, label: "Rejected" },
  cancelled: { tone: "neutral", icon: CircleX, label: "Cancelled" },
};

export function RequestStatusChip({ status }: { status: RequestStatus }) {
  const { tone, icon, label } = STATUS[status];
  return <StatusChip tone={tone} icon={icon} label={label} />;
}

type Group = BoardCandidate["group"];

const GROUP_LOOK = {
  free: { icon: CircleCheck, colour: "text-success-text" },
  reserved: { icon: Link2, colour: "text-info-text" },
  finishing: { icon: Link2, colour: "text-info-text" },
  late: { icon: CalendarClock, colour: "text-warning-text" },
} as const;

/** Where a person comes from, in a few words (the full sentence is the tooltip). */
export function GroupLabel({
  group,
  fromProject,
  endsOn,
  startsOn,
}: {
  group: Group;
  fromProject: string | null;
  endsOn?: string | null;
  startsOn: string | null;
}) {
  const other = fromProject ?? "another job";
  const when = startsOn ? formatDate(startsOn) : "later";
  const { text, title } = {
    free: { text: "Free now", title: "Free now: not on any job in this window" },
    reserved: { text: "Reserved here", title: "Already reserved for this project" },
    finishing: {
      text: endsOn ? `Finishes ${formatDate(endsOn)}` : `After ${other}`,
      title: `Finishes on ${other}${endsOn ? ` (${formatDate(endsOn)})` : ""}, then starts here ${when}`,
    },
    late: {
      text: `Starts ${when}`,
      title: `Can join late: starts ${when}, after finishing on ${other}`,
    },
  }[group];
  const { icon: Icon, colour } = GROUP_LOOK[group];
  return (
    <span title={title} className={`inline-flex min-w-0 items-center gap-1 text-xs ${colour}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span aria-hidden="true" className="truncate">
        {text}
      </span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** Who chose this person: a person, the rules-based suggestion, or (later) the Workforce agent. */
export function SourceIcon({ source }: { source: PickRow["source"] }) {
  const info = {
    hr: { icon: User, label: "Chosen by HR" },
    rules: { icon: ListChecks, label: "Suggested by the rules" },
    agent: { icon: Bot, label: "Suggested by the Workforce agent" },
  }[source];
  const Icon = info.icon;
  return (
    <span title={info.label} className="inline-flex text-muted">
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{info.label}</span>
    </span>
  );
}

/** Plain words first, the rule code beside it in mono (docs/design-direction.md, HR screens). */
export function Violations({ items }: { items: Violation[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-xs text-danger-text">
      {items.map((v) => (
        <li key={v.rule + v.message}>
          {v.message} <span className="font-mono text-subtle">{v.rule}</span>
        </li>
      ))}
    </ul>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export { SMALL_BUTTON } from "@/components/ui/button-styles";

/** "L3" on screen, "Level 3" to a screen reader. */
export function Level({ level }: { level: number | null }) {
  return level ? (
    <>
      <span aria-hidden="true">L{level}</span>
      <span className="sr-only">Level {level}</span>
    </>
  ) : (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">No level</span>
    </>
  );
}
