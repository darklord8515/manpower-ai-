import type { MobStage, MobilizationRow } from "@/lib/api-types";

/** The pipeline, left to right. The stage of a card comes from the API (the tasks decide it). */
export const STAGES: { id: MobStage; title: string; hint: string; empty: string }[] = [
  {
    id: "pending_checklist",
    title: "Pending checklist",
    hint: "Approved, no task done yet",
    empty: "Nobody is waiting to start.",
  },
  {
    id: "in_progress",
    title: "In progress",
    hint: "Some tasks done",
    empty: "Nobody is part-way through.",
  },
  {
    id: "ready",
    title: "Ready to report",
    hint: "Every task done, waiting for the day",
    empty: "Nobody is ready yet.",
  },
  {
    id: "on_site",
    title: "On site",
    hint: "Arrived in the last 14 days",
    empty: "Nobody has arrived recently.",
  },
];

export const STAGE_TITLE: Record<MobStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.id, s.title]),
) as Record<MobStage, string>;

export function byStage(items: MobilizationRow[]) {
  return STAGES.map((stage) => ({
    ...stage,
    items: items.filter((i) => i.stage === stage.id),
  }));
}

/** "3 in the pipeline, 2 with an overdue task". */
export function summaryLine(items: MobilizationRow[]): string {
  const inPipeline = items.filter((i) => i.stage !== "on_site").length;
  const overdue = items.filter((i) => i.overdue > 0).length;
  const people = `${inPipeline} ${inPipeline === 1 ? "person" : "people"} being mobilized`;
  return overdue > 0 ? `${people}, ${overdue} with an overdue task` : people;
}
