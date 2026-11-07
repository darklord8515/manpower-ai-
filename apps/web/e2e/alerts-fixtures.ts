import type { Page, Route } from "@playwright/test";

/**
 * A stateful pretend API for the Action Center: taking, assigning, snoozing and dismissing change
 * what the next request returns, with the same rules and messages as the real one. The detectors
 * themselves are tested in the API; here we test what the screens do with the answers.
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body, headers: {} });

export const NOW = "2026-11-05T09:00:00+04:00";
const ago = (hours: number) => new Date(new Date(NOW).getTime() - hours * 3_600_000).toISOString();

type Severity = "critical" | "action_needed" | "info";
type Status = "open" | "in_progress" | "snoozed" | "resolved" | "dismissed";

type Fake = {
  id: string;
  type: string;
  severity: Severity;
  status: Status;
  title: string;
  project: string | null;
  raised_at: string;
  due_at: string | null;
  assignee: string | null;
  assignee_id: string | null;
  escalation_level: number;
  snoozed_until: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  explanation: string;
  facts: Record<string, unknown>;
  actions: { action: string; label: string; params: Record<string, string> }[];
  history: { at: string; by: string; what: string }[];
};

const HR_ID = "11111111-1111-4111-8111-111111111111";
const EXEC_ID = "33333333-3333-4333-8333-333333333333";
const PEOPLE = [
  { id: HR_ID, name: "Noura Demo", role: "HR Manager" },
  { id: EXEC_ID, name: "Priya Demo", role: "HR Executive" },
];

const raised = [{ at: NOW, by: "System", what: "Raised" }];

function doc(
  n: number,
  severity: Severity,
  name: string,
  code: string,
  label: string,
  days: number,
  threshold: number,
  project: string | null,
  hours = 0,
): Fake {
  const date = new Date(Date.UTC(2026, 10, 5 + days)).toISOString().slice(0, 10);
  const when = days < 0 ? `expired ${-days} days ago` : `ends in ${days} days`;
  const [y, m, d] = date.split("-").map(Number);
  const pretty = `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
  return {
    id: `alert-doc-${n}`,
    type: "document_expiry",
    severity,
    status: "open",
    title: `${name}: ${label.toLowerCase()} ${when} (${pretty})`,
    project,
    raised_at: ago(hours),
    due_at: `${date}T00:00:00+04:00`,
    assignee: null,
    assignee_id: null,
    escalation_level: 0,
    snoozed_until: null,
    resolved_at: null,
    resolution_note: null,
    explanation: `The ${label.toLowerCase()} of ${name} (${code}) ${when}, on ${pretty}. ${
      project ? `They are on ${project}.` : "They have no current assignment."
    } Renewal has to be started with the worker.`,
    facts: {
      worker: code,
      worker_name: name,
      document_label: label,
      expiry: date,
      days_left: days,
      threshold,
      project,
    },
    actions: [{ action: "open_worker", label: "Open worker", params: { worker: code } }],
    history: raised,
  };
}

function stuck(n: number, who: string, code: string, open: number, overdue: number): Fake {
  const mob = `MOB-2026-010${n}`;
  return {
    id: `alert-mob-${n}`,
    type: "mobilization_stuck",
    severity: "action_needed",
    status: "open",
    title: `${mob}: ${who} reports 8 Nov 2026 with ${open} ${open === 1 ? "task" : "tasks"} still open${
      overdue ? `, ${overdue} overdue` : ""
    }`,
    project: "RAK-03",
    raised_at: ago(0),
    due_at: "2026-11-08T00:00:00+04:00",
    assignee: null,
    assignee_id: null,
    escalation_level: 0,
    snoozed_until: null,
    resolved_at: null,
    resolution_note: null,
    explanation: `${who} (${code}) reports to RAK-03 on 8 Nov 2026, in 3 days. Still open: Site induction.`,
    facts: {
      mob_no: mob,
      worker: code,
      worker_name: who,
      project: "RAK-03",
      report_on: "2026-11-08",
      days_to_report: 3,
      open_tasks: open,
      overdue,
      open_titles: ["Issue PPE", "Site induction"],
    },
    actions: [{ action: "open_mobilization", label: "Open mobilization", params: { mob_no: mob } }],
    history: raised,
  };
}

function fresh(): Fake[] {
  return [
    doc(1, "critical", "Harish Mondal", "EMP-0201", "Residency visa", 3, 7, "RAK-02"),
    doc(2, "critical", "Sanjeev Rana", "EMP-0088", "Residency visa", 7, 7, "RAK-01"),
    {
      id: "alert-short",
      type: "upcoming_shortfall",
      severity: "action_needed",
      status: "open",
      title: "RAK-07 starts 12 Feb 2027: 1 general labour short",
      project: "RAK-07",
      raised_at: ago(0),
      due_at: "2027-02-12T00:00:00+04:00",
      assignee: null,
      assignee_id: null,
      escalation_level: 0,
      snoozed_until: null,
      resolved_at: null,
      resolution_note: null,
      explanation:
        "Shamal Logistics Hub needs 12 general labour from 12 Feb 2027. 8 are already assigned and 3 more can be deployed. That leaves 1 uncovered, 99 days before the start.",
      facts: {
        project: "RAK-07",
        trade: "General labour",
        start: "2027-02-12",
        days_to_start: 99,
        needed: 12,
        already_assigned: 8,
        deployable: 3,
        recruitment_pending: 0,
        gap: 1,
      },
      actions: [
        {
          action: "open_forecast",
          label: "Open forecast",
          params: { project: "RAK-07", trade: "general_labour" },
        },
      ],
      history: raised,
    },
    {
      id: "alert-approval",
      type: "approval_waiting",
      severity: "action_needed",
      status: "open",
      title: "SR-2026-0001 has waited 41 hours for approval",
      project: "RAK-03",
      raised_at: ago(0),
      due_at: null,
      assignee: null,
      assignee_id: null,
      escalation_level: 1,
      snoozed_until: null,
      resolved_at: null,
      resolution_note: null,
      explanation:
        "SR-2026-0001: 7 people for RAK-03 from 08 Nov 2026. It was sent for approval on 3 Nov 2026 and nobody has answered yet, so the workers cannot start.",
      facts: {
        request: "SR-2026-0001",
        project: "RAK-03",
        waited_hours: 41,
        since: "2026-11-03T16:00:00+04:00",
      },
      actions: [
        {
          action: "open_allocation",
          label: "Open Allocation",
          params: { request: "SR-2026-0001" },
        },
      ],
      history: [
        { at: ago(0), by: "System", what: "Escalated to HR Manager" },
        { at: ago(0), by: "System", what: "Raised" },
      ],
    },
    stuck(7, "Girish Nair", "EMP-0507", 2, 1),
    stuck(8, "Hassan Javed", "EMP-0508", 4, 0),
    stuck(9, "Ismail Qadir", "EMP-0509", 5, 1),
    doc(3, "action_needed", "Tariq Zaman", "EMP-0211", "Residency visa", 19, 30, "RAK-04"),
    doc(4, "action_needed", "Farhan Ali", "EMP-0212", "Labour card", 15, 30, null),
    doc(5, "info", "Aamir Lama", "EMP-0213", "Medical fitness", 45, 60, "RAK-05"),
    {
      id: "alert-ban",
      type: "midday_ban_conflict",
      severity: "info",
      status: "open",
      title:
        "RAK-01 Site 2: the 06:00 to 15:30 shift runs into the midday ban in 2027 (provisional)",
      project: "RAK-01",
      raised_at: ago(0),
      due_at: "2027-06-15T00:00:00+04:00",
      assignee: null,
      assignee_id: null,
      escalation_level: 0,
      snoozed_until: null,
      resolved_at: null,
      resolution_note: null,
      explanation:
        "From 15 Jun 2027 to 15 Sep 2027 outdoor work is not allowed between 12:30 to 15:00. The 06:00 to 15:30 shift on RAK-01 Site 2 runs into the midday ban. Up to 27 people on RAK-01 work this shift. These dates are HR's planning assumption until MoHRE announces them.",
      facts: {
        project: "RAK-01",
        site: "Site 2",
        year: 2027,
        provisional: true,
        ban_starts: "2027-06-15",
        ban_ends: "2027-09-15",
        ban_window: "12:30 to 15:00",
        shift: "06:00 to 15:30",
        problem: "overlaps",
        people_up_to: 27,
      },
      actions: [],
      history: raised,
    },
    {
      id: "alert-ending",
      type: "ending_without_next",
      severity: "info",
      status: "open",
      title: "2 people finish on RAK-02 on 25 Nov 2026 with no next assignment",
      project: "RAK-02",
      raised_at: ago(0),
      due_at: "2026-11-25T00:00:00+04:00",
      assignee: null,
      assignee_id: null,
      escalation_level: 0,
      snoozed_until: null,
      resolved_at: null,
      resolution_note: null,
      explanation:
        "2 people on Saqr Business Park reach their last day on 25 Nov 2026, in 20 days, and nothing is planned for them afterwards.",
      facts: {
        project: "RAK-02",
        end_date: "2026-11-25",
        days_left: 20,
        count: 2,
        more: 0,
        workers: [
          { code: "EMP-0301", name: "Rahim Uddin" },
          { code: "EMP-0302", name: "Suresh Pillai" },
        ],
      },
      actions: [
        { action: "open_allocation", label: "Open Allocation", params: {} },
        { action: "open_forecast", label: "Open forecast", params: { project: "RAK-02" } },
      ],
      history: raised,
    },
  ];
}

const DISMISSIBLE = [
  "upcoming_shortfall",
  "ending_without_next",
  "document_expiry",
  "midday_ban_conflict",
];
const RANK: Record<Severity, number> = { critical: 0, action_needed: 1, info: 2 };
const ESCALATED = ["", "HR Manager", "Operations Manager"];

export type AlertsOptions = {
  /** The signed-in person may take, assign, snooze and dismiss (false for the MD/CEO). */
  canAct?: boolean;
  empty?: boolean;
  failList?: boolean;
  failSummary?: boolean;
  failDetail?: boolean;
};

export async function mockAlerts(page: Page, options: AlertsOptions = {}) {
  const canAct = options.canAct ?? true;
  // Each alert gets its own history: the templates share one array, and taking an alert in one
  // test must not show up as history on every other alert in the next.
  const alerts = options.empty ? [] : fresh().map((a) => ({ ...a, history: [...a.history] }));
  const seen = { actions: [] as { id: string; action: string; body: unknown }[], summaryReads: 0 };

  const row = (a: Fake) => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    status: a.status,
    title: a.title,
    project: a.project,
    raised_at: a.raised_at,
    due_at: a.due_at,
    assignee: a.assignee,
    assignee_id: a.assignee_id,
    escalation_level: a.escalation_level,
    escalated_to: ESCALATED[a.escalation_level] || null,
    snoozed_until: a.snoozed_until,
    resolved_at: a.resolved_at,
    resolution_note: a.resolution_note,
  }); // fmt: skip

  const live = (a: Fake) => a.status === "open" || a.status === "in_progress";
  const order = (x: Fake, y: Fake) =>
    RANK[x.severity] - RANK[y.severity] || (x.due_at ?? "9").localeCompare(y.due_at ?? "9");
  const counts = (list: Fake[]) => ({
    critical: list.filter((a) => a.severity === "critical").length,
    action_needed: list.filter((a) => a.severity === "action_needed").length,
    info: list.filter((a) => a.severity === "info").length,
  });

  const detail = (a: Fake) => ({
    ...row(a),
    explanation: a.explanation,
    narrated: false,
    facts: a.facts,
    actions: a.status === "resolved" || a.status === "dismissed" ? [] : a.actions,
    can_act: canAct && !["resolved", "dismissed"].includes(a.status),
    can_dismiss:
      canAct && DISMISSIBLE.includes(a.type) && !["resolved", "dismissed"].includes(a.status),
    history: a.history,
  });

  const summary = () => {
    const open = alerts.filter(live);
    const top = open
      .filter((a) => a.severity !== "info")
      .sort(order)
      .slice(0, 5);
    const c = counts(open);
    return {
      counts: c,
      needs_attention: c.critical + c.action_needed,
      top: top.map(row),
      mine: open.filter((a) => a.assignee_id === HR_ID).length,
      last_run: NOW,
      now: NOW,
      can_act: canAct,
    };
  };

  await page.route("**/api/alerts/summary", (route) => {
    seen.summaryReads += 1;
    if (options.failSummary) return json(route, { detail: "The alerts are unavailable." }, 500);
    return json(route, summary());
  });
  await page.route("**/api/alerts/assignees", (route) => json(route, PEOPLE));

  await page.route(/\/api\/alerts(\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const parts = url.pathname
      .replace(/^\/api\/alerts\/?/, "")
      .split("/")
      .filter(Boolean);
    if (parts[0] === "summary" || parts[0] === "assignees") return route.fallback();

    if (parts.length === 0) {
      if (options.failList) return json(route, { detail: "The alert list is unavailable." }, 500);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const view = url.searchParams.get("view") ?? "open";
      const severity = url.searchParams.get("severity");
      const type = url.searchParams.get("type");
      const project = url.searchParams.get("project");
      const mine = url.searchParams.get("mine") === "true";
      const shared = alerts.filter(
        (a) =>
          (!q ||
            a.title.toLowerCase().includes(q) ||
            (a.project ?? "").toLowerCase().includes(q)) &&
          (!type || a.type === type) &&
          (!project || a.project === project) &&
          (!mine || a.assignee_id === HR_ID),
      );
      let items: Fake[];
      if (view === "snoozed") items = shared.filter((a) => a.status === "snoozed");
      else if (view === "cleared")
        items = shared.filter((a) => a.status === "resolved" || a.status === "dismissed");
      else items = shared.filter(live);
      if (severity) items = items.filter((a) => a.severity === severity);
      return json(route, {
        items: items.sort(order).map(row),
        counts: counts(shared.filter(live)),
        snoozed: shared.filter((a) => a.status === "snoozed").length,
        last_run: NOW,
        now: NOW,
        can_act: canAct,
      });
    }

    if (parts[0] === "bulk" && method === "POST") {
      const body = route.request().postDataJSON() as {
        ids: string[];
        action: "snooze" | "assign";
        until?: string;
        user_id?: string;
      }; // fmt: skip
      const chosen = alerts.filter((a) => body.ids.includes(a.id));
      if (body.action === "snooze") {
        const hours = (new Date(body.until ?? 0).getTime() - new Date(NOW).getTime()) / 3_600_000;
        if (chosen.some((a) => a.severity === "critical" && hours > 24))
          return json(
            route,
            { detail: "A critical alert can be snoozed for 24 hours at most." },
            422,
          );
        for (const a of chosen) {
          a.status = "snoozed";
          a.snoozed_until = body.until ?? null;
        }
      } else {
        const who = PEOPLE.find((p) => p.id === body.user_id);
        for (const a of chosen) {
          a.status = "in_progress";
          a.assignee = who?.name ?? null;
          a.assignee_id = who?.id ?? null;
        }
      }
      seen.actions.push({ id: body.ids.join(","), action: `bulk-${body.action}`, body });
      return json(route, { changed: chosen.length });
    }

    const alert = alerts.find((a) => a.id === parts[0]);
    if (!alert) return json(route, { detail: "Alert not found" }, 404);
    if (parts.length === 1) {
      if (options.failDetail) return json(route, { detail: "The alert could not be opened." }, 500);
      return json(route, detail(alert));
    }
    if (method !== "POST" || !canAct) return json(route, { detail: "Not allowed" }, 403);
    const action = parts[1];
    const body = (route.request().postDataJSON() ?? {}) as Record<string, string>;
    seen.actions.push({ id: alert.id, action, body });
    if (alert.status === "resolved" || alert.status === "dismissed")
      return json(route, { detail: `This alert is already ${alert.status}.` }, 409);

    if (action === "take") {
      if (alert.status === "in_progress" && alert.assignee_id && alert.assignee_id !== HR_ID)
        return json(route, { detail: `${alert.assignee} is already working on this.` }, 409);
      alert.status = "in_progress";
      alert.assignee = "Noura Demo";
      alert.assignee_id = HR_ID;
      alert.history.unshift({ at: NOW, by: "Noura Demo", what: "Taken" });
    } else if (action === "assign") {
      const who = PEOPLE.find((p) => p.id === body.user_id);
      if (!who) return json(route, { detail: "That person cannot work on alerts." }, 422);
      alert.status = "in_progress";
      alert.assignee = who.name;
      alert.assignee_id = who.id;
      alert.history.unshift({ at: NOW, by: "Noura Demo", what: `Assigned to ${who.name}` });
    } else if (action === "snooze") {
      const hours = (new Date(body.until).getTime() - new Date(NOW).getTime()) / 3_600_000;
      if (!(hours > 0)) return json(route, { detail: "Choose a time in the future." }, 422);
      if (alert.severity === "critical" && hours > 24)
        return json(
          route,
          { detail: "A critical alert can be snoozed for 24 hours at most." },
          422,
        );
      if (hours > 24 * 7)
        return json(route, { detail: "An alert can be snoozed for 7 days at most." }, 422);
      alert.status = "snoozed";
      alert.snoozed_until = body.until;
      alert.history.unshift({
        at: NOW,
        by: "Noura Demo",
        what: `Snoozed until ${body.until.slice(0, 10)}`,
      });
    } else if (action === "dismiss") {
      if (!DISMISSIBLE.includes(alert.type))
        return json(
          route,
          {
            detail: "This alert can only be snoozed. It clears by itself when the cause is fixed.",
          },
          409,
        );
      if ((body.reason ?? "").trim().length < 10)
        return json(route, { detail: "Give a reason of at least 10 characters." }, 422);
      alert.status = "dismissed";
      alert.resolved_at = NOW;
      alert.resolution_note = body.reason.trim();
      alert.history.unshift({
        at: NOW,
        by: "Noura Demo",
        what: `Dismissed: ${body.reason.trim()}`,
      });
    } else return json(route, { detail: "Not found" }, 404);
    return json(route, detail(alert));
  });

  return { seen, alerts };
}
