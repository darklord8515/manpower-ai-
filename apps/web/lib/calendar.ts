import type { CalendarEntry, CalendarKind } from "./api-types";

// What HR types in is neutral and outlined, so it never looks like an alert.
const HR_CHIP = "border border-border-strong bg-hover text-fg";
const HR_DOT = "bg-(--chart-strong)";

/** How each kind of entry looks and is called. Colours are tokens, so light and dark both work. */
export const KIND: Record<CalendarKind, { label: string; chip: string; dot: string }> = {
  leave: { label: "Leave", chip: "bg-warning-soft text-warning-text", dot: "bg-warning" },
  holiday: {
    label: "Public holiday",
    chip: "bg-success-soft text-success-text",
    dot: "bg-success",
  },
  project_start: { label: "Project starts", chip: "bg-info-soft text-info-text", dot: "bg-info" },
  project_end: { label: "Project ends", chip: "bg-info-soft text-info-text", dot: "bg-info" },
  documents: { label: "Documents", chip: "bg-danger-soft text-danger-text", dot: "bg-danger" },
  contract: { label: "Contract ends", chip: "bg-danger-soft text-danger-text", dot: "bg-danger" },
  leaving: { label: "Last day", chip: "bg-danger-soft text-danger-text", dot: "bg-danger" },
  mobilization: { label: "Reports to site", chip: "bg-sunken text-fg", dot: "bg-(--chart-mid)" },
  event: { label: "Event", chip: HR_CHIP, dot: HR_DOT },
  meeting: { label: "Meeting", chip: HR_CHIP, dot: HR_DOT },
  deadline: { label: "Deadline", chip: HR_CHIP, dot: HR_DOT },
};

/** The groups people switch on and off. */
export const GROUPS: { id: string; label: string; kinds: CalendarKind[] }[] = [
  { id: "leave", label: "Leave", kinds: ["leave"] },
  { id: "holiday", label: "Holidays", kinds: ["holiday"] },
  { id: "projects", label: "Projects", kinds: ["project_start", "project_end", "mobilization"] },
  { id: "people", label: "Documents and contracts", kinds: ["documents", "contract", "leaving"] },
  { id: "events", label: "HR events", kinds: ["event", "meeting", "deadline"] },
];

export type Cell = { iso: string; day: number; inMonth: boolean; weekend: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The weeks shown for a month (Monday first), always six rows so the grid does not jump. */
export function gridFor(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - offset + i);
    const weekday = d.getDay();
    return {
      iso: isoOf(d),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      weekend: weekday === 0 || weekday === 6,
    };
  });
}

/** Entries that touch a day (a multi-day entry appears on every day it covers). */
export function onDay(entries: CalendarEntry[], iso: string): CalendarEntry[] {
  return entries.filter((e) => e.starts <= iso && e.ends >= iso);
}

export function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(year, month, 1),
  );
}
