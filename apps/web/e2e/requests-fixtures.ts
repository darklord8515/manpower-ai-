import type { Page, Route } from "@playwright/test";

/**
 * A stateful pretend API for the Allocation board: choosing, removing, swapping, suggesting,
 * approving and rejecting change what the next request returns, as the real one does. The rules
 * themselves are tested in the API; here we test what the screen does with the answers.
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body, headers: {} });

type Violation = { rule: string; message: string };
type Group = "free" | "finishing" | "late" | "reserved";

type Candidate = {
  code: string;
  name: string;
  level: number;
  group: Group;
  from_project: string | null;
  ends_on: string | null;
  starts_on: string;
  documents_valid: boolean;
  documents_until: string;
};

type FakePick = {
  code: string;
  source: "hr" | "rules" | "agent";
  reason: string | null;
  removed_reason: string | null;
};

type FakeLine = {
  id: string;
  trade_code: string;
  trade: string;
  headcount: number;
  min_level: number | null;
  status: "open" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  picks: FakePick[];
  approved: {
    code: string;
    name: string;
    starts_on: string;
    moving_from: string | null;
    mob_no: string;
  }[];
};

type FakeRequest = {
  request_no: string;
  project_code: string;
  project_name: string;
  needed_from: string;
  needed_until: string | null;
  priority: number;
  cancelled: boolean;
  requested_by: string;
  requested_by_id: string;
  source_text: string | null;
  lines: FakeLine[];
};

const NAMES = [
  "Imran Qureshi",
  "Saleem Akhtar",
  "Rafiq Hussain",
  "Naveed Iqbal",
  "Tariq Mehmood",
  "Anil Thapa",
  "Kamal Hossain",
  "Zubair Ali",
  "Ravi Shankar",
  "Mahesh Patel",
];

/** Ten steel fixers who pass the rules for 8 Nov 2026 to 3 Feb 2027, in the order the rules rank them. */
export const POOL: Candidate[] = NAMES.map((name, i) => ({
  code: `EMP-${String(107 + i * 5).padStart(4, "0")}`,
  name,
  level: i < 3 ? 4 : i < 8 ? 3 : 2,
  group: (i < 5 ? "free" : i < 9 ? "finishing" : "late") as Group,
  from_project: i < 5 ? null : "RAK-05",
  ends_on: i >= 5 && i < 9 ? "2026-11-20" : null,
  starts_on: i < 5 ? "2026-11-08" : i < 9 ? "2026-11-21" : "2026-12-01",
  documents_valid: i !== 7,
  documents_until: i === 7 ? "2027-01-20" : "2027-08-30",
}));

export const EXCLUDED = [
  {
    code: "EMP-0111",
    name: "Bilal Ahmed",
    rule: "DOC_VALID_THROUGH",
    message: "Residency visa ends 12 Jan 2027, before 3 Feb 2027",
  },
  {
    code: "EMP-0120",
    name: "Dilip Kumar",
    rule: "DOC_VALID_THROUGH",
    message: "Residency visa ends 28 Jan 2027, before 3 Feb 2027",
  },
  {
    code: "EMP-0125",
    name: "Hamid Raza",
    rule: "ASSIGN_STATUS",
    message: "Leaving the company on 20 Dec 2026",
  },
];

const CARPENTERS: Candidate[] = ["Yusuf Ansari", "Faisal Mirza"].map((name, i) => ({
  code: `EMP-018${i}`,
  name,
  level: 3,
  group: "free" as Group,
  from_project: null,
  ends_on: null,
  starts_on: "2026-11-16",
  documents_valid: true,
  documents_until: "2027-09-01",
}));

const priorityOf = (n: number) => n;

function fresh(): FakeRequest[] {
  return [
    {
      request_no: "SR-2026-0001",
      project_code: "RAK-03",
      project_name: "Al Marjan Residences",
      needed_from: "2026-11-08",
      needed_until: "2027-02-03",
      priority: priorityOf(2),
      cancelled: false,
      requested_by: "Priya Demo",
      requested_by_id: "33333333-3333-4333-8333-333333333333",
      source_text: "Second tower, levels 4 to 9",
      lines: [
        {
          id: "line-steel",
          trade_code: "steel_fixer",
          trade: "Steel fixer",
          headcount: 7,
          min_level: 2,
          status: "open",
          decided_by: null,
          decided_at: null,
          decision_reason: null,
          picks: [],
          approved: [],
        },
      ],
    },
    {
      request_no: "SR-2026-0002",
      project_code: "RAK-06",
      project_name: "Khuzam Mall Extension",
      needed_from: "2026-11-16",
      needed_until: "2027-03-31",
      priority: priorityOf(3),
      cancelled: false,
      requested_by: "Priya Demo",
      requested_by_id: "33333333-3333-4333-8333-333333333333",
      source_text: null,
      lines: [
        {
          id: "line-carp",
          trade_code: "carpenter",
          trade: "Carpenter",
          headcount: 3,
          min_level: 3,
          status: "open",
          decided_by: null,
          decided_at: null,
          decision_reason: null,
          picks: [],
          approved: [],
        },
      ],
    },
  ];
}

export type RequestsOptions = {
  /** People the rules refuse when they are added, with why. */
  refuse?: Record<string, Violation[]>;
  /** Make the approval fail the rules for the first chosen person. */
  blockApprove?: Violation[];
  canApprove?: boolean;
  approveNote?: string | null;
  /** The list has no requests. */
  empty?: boolean;
  failList?: boolean;
  failDetail?: boolean;
  /** Pool answers take this long, to show the loading state. */
  poolDelayMs?: number;
};

const poolFor = (line: FakeLine) => (line.trade_code === "carpenter" ? CARPENTERS : POOL);
const lookup = (line: FakeLine, code: string) => poolFor(line).find((c) => c.code === code);
const active = (line: FakeLine) => line.picks.filter((p) => p.removed_reason === null);

function statusOf(r: FakeRequest) {
  if (r.cancelled) return "cancelled";
  const filled = r.lines.reduce((n, l) => n + l.approved.length, 0);
  const total = r.lines.reduce((n, l) => n + l.headcount, 0);
  if (r.lines.every((l) => l.status === "rejected")) return "rejected";
  if (filled === 0) return "submitted";
  return filled >= total ? "filled" : "partially_filled";
}

export async function mockRequests(page: Page, options: RequestsOptions = {}) {
  const requests = options.empty ? [] : fresh();
  const seen = {
    approvals: [] as { request: string; line: string; preview: boolean }[],
    removed: [] as { code: string; reason: string }[],
    rejected: [] as string[],
    raised: [] as unknown[],
    cancelled: [] as string[],
    suggested: 0,
    detailReads: 0,
    agentPicks: [] as { codes: string[]; run: string }[],
  };
  let nextRequest = 3;
  let nextMob = 1;

  const lineOf = (no: string, id: string) =>
    requests.find((r) => r.request_no === no)?.lines.find((l) => l.id === id);

  const pickRow = (line: FakeLine, p: FakePick) => {
    const c = lookup(line, p.code);
    return {
      code: p.code,
      name: c?.name ?? p.code,
      level: c?.level ?? null,
      source: p.source,
      reason: p.reason,
      removed_reason: p.removed_reason,
      group: c?.group ?? null,
      from_project: c?.from_project ?? null,
      starts_on: c?.starts_on ?? null,
      documents_until: c?.documents_until ?? null,
      violations: [] as Violation[],
    };
  };

  const lineRow = (line: FakeLine) => ({
    id: line.id,
    trade_code: line.trade_code,
    trade: line.trade,
    headcount: line.headcount,
    min_level: line.min_level,
    filled: line.approved.length,
    status: line.status,
    decided_by: line.decided_by,
    decided_at: line.decided_at,
    decision_reason: line.decision_reason,
    picks: line.picks.map((p) => pickRow(line, p)),
    approved: line.approved,
  });

  const summary = (r: FakeRequest) => ({
    request_no: r.request_no,
    project_code: r.project_code,
    project_name: r.project_name,
    needed_from: r.needed_from,
    needed_until: r.needed_until,
    priority: r.priority,
    status: statusOf(r),
    requested_by: r.requested_by,
    created_at: "2026-11-05T08:00:00Z",
    waiting_days: 1,
    lines: r.lines.map((l) => ({
      trade: l.trade,
      headcount: l.headcount,
      filled: l.approved.length,
      chosen: l.status === "open" ? active(l).length : 0,
      status: l.status,
    })),
  });

  const detail = (r: FakeRequest) => {
    const status = statusOf(r);
    const closed = ["filled", "rejected", "cancelled"].includes(status);
    const canApprove = (options.canApprove ?? true) && !closed;
    return {
      ...summary(r),
      lines: r.lines.map(lineRow),
      project_status: "planning",
      source_text: r.source_text,
      requested_by_id: r.requested_by_id,
      can_approve: canApprove,
      approve_note: canApprove
        ? null
        : closed
          ? `${r.request_no} is ${status.replace("_", " ")}.`
          : (options.approveNote ?? "Approving needs the HR Manager."),
    };
  };

  const approvePeople = (line: FakeLine, preview: boolean) =>
    active(line).map((p, i) => {
      const c = lookup(line, p.code) as Candidate;
      const blocked = options.blockApprove && i === 0;
      return {
        code: c.code,
        name: c.name,
        starts_on: c.starts_on,
        moving_from: c.from_project,
        moving_from_ends: c.ends_on,
        becomes_mobilizing: c.group === "free",
        mob_no: preview ? null : `MOB-2026-${String(nextMob++).padStart(4, "0")}`,
        violations: blocked ? (options.blockApprove ?? []) : [],
      };
    });

  await page.route(/\/api\/requests(\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const parts = url.pathname
      .replace(/^\/api\/requests\/?/, "")
      .split("/")
      .filter(Boolean);
    const body =
      method === "POST" ? (route.request().postDataJSON() as Record<string, unknown>) : {};

    // /api/requests
    if (parts.length === 0) {
      if (method === "POST") {
        seen.raised.push(body);
        const sent = body as {
          project: string;
          needed_from: string;
          needed_until: string | null;
          priority: number;
          source_text: string | null;
          lines: { trade: string; headcount: number; min_level: number | null }[];
        };
        const created: FakeRequest = {
          request_no: `SR-2026-${String(nextRequest++).padStart(4, "0")}`,
          project_code: sent.project,
          project_name: "Shamal Logistics Hub",
          needed_from: sent.needed_from,
          needed_until: sent.needed_until,
          priority: sent.priority,
          cancelled: false,
          requested_by: "Priya Demo",
          requested_by_id: "33333333-3333-4333-8333-333333333333",
          source_text: sent.source_text,
          lines: sent.lines.map((l, i) => ({
            id: `line-new-${i}`,
            trade_code: l.trade,
            trade: l.trade === "carpenter" ? "Carpenter" : "Steel fixer",
            headcount: l.headcount,
            min_level: l.min_level,
            status: "open",
            decided_by: null,
            decided_at: null,
            decision_reason: null,
            picks: [],
            approved: [],
          })),
        };
        requests.unshift(created);
        return json(route, detail(created), 201);
      }
      if (options.failList) return json(route, { detail: "The request list is unavailable." }, 500);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const status = url.searchParams.get("status");
      const project = url.searchParams.get("project");
      const rows = requests
        .map(summary)
        .filter(
          (r) =>
            (!status || r.status === status) &&
            (!project || r.project_code === project) &&
            (!q ||
              `${r.request_no} ${r.project_name} ${r.project_code} ${r.lines.map((l) => l.trade).join(" ")}`
                .toLowerCase()
                .includes(q)),
        );
      return json(route, rows);
    }

    const request = requests.find((r) => r.request_no === parts[0]);
    if (!request) return json(route, { detail: "Request not found" }, 404);

    if (parts.length === 1) {
      seen.detailReads += 1;
      if (options.failDetail)
        return json(route, { detail: "The request could not be opened." }, 500);
      return json(route, detail(request));
    }

    if (parts[1] === "cancel") {
      seen.cancelled.push(parts[0]);
      request.cancelled = true;
      return json(route, detail(request));
    }

    const line = request.lines.find((l) => l.id === parts[2]);
    if (!line) return json(route, { detail: "Line not found" }, 404);
    const action = parts.slice(3).join("/");

    if (action === "candidates") {
      if (options.poolDelayMs) await new Promise((r) => setTimeout(r, options.poolDelayMs));
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const minLevel = Number(url.searchParams.get("min_level") ?? 0);
      const documentsOnly = url.searchParams.get("documents_valid") === "true";
      const picked = new Set(active(line).map((p) => p.code));
      const candidates = poolFor(line)
        .filter(
          (c) =>
            (!q || `${c.name} ${c.code}`.toLowerCase().includes(q)) &&
            c.level >= minLevel &&
            (!documentsOnly || c.documents_valid),
        )
        .map((c) => ({ ...c, picked: picked.has(c.code) }));
      return json(route, {
        candidates,
        excluded: line.trade_code === "steel_fixer" ? EXCLUDED : [],
        open_slots: Math.max(line.headcount - picked.size, 0),
        window_end: request.needed_until,
      });
    }

    if (action === "picks") {
      const { employee_codes, agent_run } = body as {
        employee_codes: string[];
        agent_run?: string;
      };
      if (agent_run) seen.agentPicks.push({ codes: employee_codes, run: agent_run });
      const results = employee_codes.map((code) => {
        const c = lookup(line, code) as Candidate;
        const why = options.refuse?.[code];
        if (why) return { code, name: c.name, outcome: "refused" as const, violations: why };
        const existing = line.picks.find((p) => p.code === code);
        if (existing) {
          existing.removed_reason = null;
        } else {
          line.picks.push(
            agent_run
              ? { code, source: "agent", reason: "Free now, level 4", removed_reason: null }
              : { code, source: "hr", reason: "Chosen by HR", removed_reason: null },
          );
        }
        return { code, name: c.name, outcome: "chosen" as const, violations: [] as Violation[] };
      });
      return json(route, { results, chosen: results.filter((r) => r.outcome === "chosen").length });
    }

    if (action === "picks/remove") {
      const { employee_code, reason } = body as { employee_code: string; reason: string };
      seen.removed.push({ code: employee_code, reason });
      const pick = line.picks.find((p) => p.code === employee_code);
      if (pick) pick.removed_reason = reason;
      return route.fulfill({ status: 204 });
    }

    if (action === "picks/restore") {
      const { employee_code } = body as { employee_code: string };
      const c = lookup(line, employee_code) as Candidate;
      const why = options.refuse?.[employee_code];
      if (why)
        return json(route, {
          results: [{ code: employee_code, name: c.name, outcome: "refused", violations: why }],
          chosen: 0,
        });
      const pick = line.picks.find((p) => p.code === employee_code);
      if (pick) pick.removed_reason = null;
      return json(route, {
        results: [{ code: employee_code, name: c.name, outcome: "chosen", violations: [] }],
        chosen: 1,
      });
    }

    if (action === "suggest") {
      seen.suggested += 1;
      const have = new Set(line.picks.map((p) => p.code));
      const room = line.headcount - active(line).length;
      const chosen = poolFor(line)
        .filter((c) => !have.has(c.code) && c.documents_valid)
        .slice(0, room);
      for (const c of chosen) {
        line.picks.push({
          code: c.code,
          source: "rules",
          reason: `${c.group === "free" ? "Free now" : "Finishes on RAK-05"}; level ${c.level}; documents valid`,
          removed_reason: null,
        });
      }
      return json(route, {
        results: chosen.map((c) => ({
          code: c.code,
          name: c.name,
          outcome: "chosen",
          violations: [],
        })),
        chosen: chosen.length,
      });
    }

    if (action === "approve") {
      const { preview } = body as { preview: boolean };
      seen.approvals.push({ request: parts[0], line: parts[2], preview });
      const people = approvePeople(line, preview);
      const blocked = people.some((p) => p.violations.length > 0);
      const filledAfter = line.approved.length + people.length;
      if (!preview && !blocked) {
        line.status = "approved";
        line.decided_by = "Noura Demo";
        line.decided_at = "2026-11-06T09:00:00Z";
        line.approved = people.map((p) => ({
          code: p.code,
          name: p.name,
          starts_on: p.starts_on,
          moving_from: p.moving_from,
          mob_no: p.mob_no as string,
        }));
      }
      return json(route, {
        preview,
        ok: !blocked,
        request_no: parts[0],
        trade: line.trade,
        people,
        assignments: blocked ? 0 : people.length,
        mobilizations: blocked ? 0 : people.length,
        depend_on_other_jobs: people.filter((p) => p.moving_from).length,
        filled_after: filledAfter,
        headcount: line.headcount,
        request_status_after: filledAfter >= line.headcount ? "filled" : "partially_filled",
      });
    }

    if (action === "reject") {
      const { reason } = body as { reason: string };
      seen.rejected.push(reason);
      line.status = "rejected";
      line.decided_by = "Noura Demo";
      line.decided_at = "2026-11-06T09:00:00Z";
      line.decision_reason = reason;
      return json(route, detail(request));
    }

    return json(route, { detail: "Not found" }, 404);
  });

  return { seen, requests, lineOf };
}
