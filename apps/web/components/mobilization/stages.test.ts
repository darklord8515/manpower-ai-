import { describe, expect, it } from "vitest";
import type { MobStage, MobilizationRow } from "@/lib/api-types";
import { STAGES, STAGE_TITLE, byStage, summaryLine } from "./stages";

const row = (stage: MobStage, overdue = 0, n = 1): MobilizationRow => ({
  mob_no: `MOB-2026-${String(n).padStart(4, "0")}`,
  stage,
  status: "approved",
  worker_code: "EMP-0501",
  worker_name: "Aamir Siddiqui",
  trade: "Steel fixer",
  project_code: "RAK-03",
  project_name: "Coral Bay",
  report_on: "2026-11-08",
  tasks_done: 0,
  tasks_total: 5,
  overdue,
  arrived_on: null,
});

describe("the pipeline stages", () => {
  it("runs left to right from not started to on site", () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      "pending_checklist",
      "in_progress",
      "ready",
      "on_site",
    ]);
    expect(STAGE_TITLE.ready).toBe("Ready to report");
  });

  it("sorts people into their columns and keeps empty columns", () => {
    const columns = byStage([row("ready", 0, 1), row("in_progress", 0, 2), row("ready", 0, 3)]);
    expect(columns.map((c) => [c.id, c.items.length])).toEqual([
      ["pending_checklist", 0],
      ["in_progress", 1],
      ["ready", 2],
      ["on_site", 0],
    ]);
    expect(columns[0].empty).toMatch(/Nobody/);
  });
});

describe("summaryLine", () => {
  it("counts who is being mobilized, not who has already arrived", () => {
    expect(summaryLine([row("ready"), row("on_site")])).toBe("1 person being mobilized");
  });

  it("says how many have an overdue task", () => {
    expect(
      summaryLine([row("in_progress", 2, 1), row("pending_checklist", 0, 2), row("ready", 1, 3)]),
    ).toBe("3 people being mobilized, 2 with an overdue task");
  });

  it("copes with an empty pipeline", () => {
    expect(summaryLine([])).toBe("0 people being mobilized");
  });
});
