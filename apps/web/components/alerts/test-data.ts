import type { AlertCounts, AlertDetail, AlertRow, AlertSummary } from "@/lib/api-types";

/** Builders for the alert tests (imported by tests only). */
export const NOW = "2026-11-05T09:00:00+04:00"; // the demo's clock

export const HR = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "noura.demo@constructiq.test",
  full_name: "Noura Demo",
  roles: ["hr_manager"],
  permissions: ["alert:read", "alert:act", "project:read", "project:write"],
  demo_mode: true,
  landing: "hr",
};

export const MD = { ...HR, roles: ["ceo"], permissions: ["alert:read"], landing: "executive" };

export const alertRow = (changes: Partial<AlertRow> = {}): AlertRow => ({
  id: "alert-1",
  type: "document_expiry",
  severity: "critical",
  status: "open",
  title: "Sanjeev Rana: residency visa ends in 7 days (12 Nov 2026)",
  project: "RAK-01",
  raised_at: "2026-11-05T09:00:00+04:00",
  due_at: "2026-11-12T00:00:00+04:00",
  assignee: null,
  assignee_id: null,
  escalation_level: 0,
  escalated_to: null,
  snoozed_until: null,
  resolved_at: null,
  resolution_note: null,
  ...changes,
});

export const alertDetail = (changes: Partial<AlertDetail> = {}): AlertDetail => ({
  ...alertRow(),
  explanation:
    "The residency visa of Sanjeev Rana (EMP-0088) ends in 7 days, on 12 Nov 2026. They are on RAK-01.",
  narrated: false,
  facts: {
    worker: "EMP-0088",
    worker_name: "Sanjeev Rana",
    document_label: "Residency visa",
    expiry: "2026-11-12",
    days_left: 7,
    threshold: 7,
    project: "RAK-01",
  },
  actions: [{ action: "open_worker", label: "Open worker", params: { worker: "EMP-0088" } }],
  can_act: true,
  can_dismiss: true,
  history: [{ at: "2026-11-05T09:00:00+04:00", by: "System", what: "Raised" }],
  ...changes,
});

const counts = (critical = 0, action_needed = 0, info = 0): AlertCounts => ({
  critical,
  action_needed,
  info,
});

export const summary = (changes: Partial<AlertSummary> = {}): AlertSummary => ({
  counts: counts(2, 16, 29),
  needs_attention: 18,
  top: [
    alertRow({ id: "a1", title: "Harish Mondal: residency visa ends in 3 days (8 Nov 2026)" }),
    alertRow({ id: "a2" }),
    alertRow({
      id: "a3",
      severity: "action_needed",
      title: "RAK-07 starts 12 Feb 2027: 1 general labour short",
      type: "upcoming_shortfall",
      project: "RAK-07",
    }),
  ],
  mine: 0,
  last_run: NOW,
  now: NOW,
  can_act: true,
  ...changes,
});
