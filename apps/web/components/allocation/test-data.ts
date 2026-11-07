import type {
  AgentRecommendation,
  AgentRun,
  AgentSelection,
  ApproveResponse,
  LineRow,
  PickRow,
} from "@/lib/api-types";

/** Builders for the allocation tests (imported by tests only). */
export const pick = (code: string, name: string, changes: Partial<PickRow> = {}): PickRow => ({
  code,
  name,
  level: 3,
  source: "rules",
  reason: "Free now; level 3; documents valid",
  removed_reason: null,
  group: "free",
  from_project: null,
  starts_on: "2026-11-08",
  documents_until: "2027-08-30",
  violations: [],
  ...changes,
});

export const line = (changes: Partial<LineRow> = {}): LineRow => ({
  id: "line-1",
  trade_code: "steel_fixer",
  trade: "Steel fixer",
  headcount: 3,
  min_level: 2,
  filled: 0,
  status: "open",
  decided_by: null,
  decided_at: null,
  decision_reason: null,
  picks: [],
  approved: [],
  ...changes,
});

export const approval = (changes: Partial<ApproveResponse> = {}): ApproveResponse => ({
  preview: true,
  ok: true,
  request_no: "SR-2026-0001",
  trade: "Steel fixer",
  people: [
    {
      code: "EMP-0107",
      name: "Imran Qureshi",
      starts_on: "2026-11-08",
      moving_from: null,
      moving_from_ends: null,
      becomes_mobilizing: true,
      mob_no: null,
      violations: [],
    },
    {
      code: "EMP-0132",
      name: "Anil Thapa",
      starts_on: "2026-11-21",
      moving_from: "RAK-05",
      moving_from_ends: "2026-11-20",
      becomes_mobilizing: false,
      mob_no: null,
      violations: [],
    },
  ],
  assignments: 2,
  mobilizations: 2,
  depend_on_other_jobs: 1,
  filled_after: 2,
  headcount: 3,
  request_status_after: "partially_filled",
  ...changes,
});

export const selection = (
  code: string,
  name: string,
  changes: Partial<AgentSelection> = {},
): AgentSelection => ({
  code,
  name,
  level: 3,
  group: "free",
  reason: "Free now, level 3",
  reason_by: "ai",
  ...changes,
});

export const recommendation = (
  changes: Partial<AgentRecommendation> = {},
): AgentRecommendation => ({
  trade: "Steel fixer",
  open_places: 3,
  shortfall: 1,
  note: null,
  selections: [selection("EMP-0107", "Imran Qureshi"), selection("EMP-0112", "Saleem Akhtar")],
  rejected: [],
  ...changes,
});

/** A finished recommendation run unless told otherwise. */
export const agentRun = (changes: Partial<AgentRun> = {}): AgentRun => ({
  id: "run-1",
  kind: "recommend_line",
  status: "succeeded",
  steps: [
    { title: "Read the request line", detail: "Steel fixer: 3 needed for RAK-03 from 8 Nov 2026" },
    { title: "Searched the people who could be chosen", detail: "5 could be chosen" },
    { title: "Chose 2", detail: "1 place left open" },
  ],
  recommendation: recommendation(),
  answer: null,
  error: null,
  model: "fake-mid",
  tier: "mid",
  started_at: "2026-11-05T05:00:00Z",
  finished_at: "2026-11-05T05:00:04Z",
  ...changes,
});
