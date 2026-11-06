import type { Page, Route } from "@playwright/test";

/** A signed-in user and a summary shaped like the API's, for tests that do not need a real server. */
export const HR_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "noura.demo@constructiq.test",
  full_name: "Noura Demo",
  roles: ["hr_manager"],
  permissions: [
    "employee:read",
    "project:read",
    "project:write",
    "staffing:read",
    "forecast:read",
    "assignment:approve",
    "staffing:create",
    "staffing:approve",
    "recruitment:read",
    "recruitment:create",
  ],
  demo_mode: true,
  landing: "hr",
};

/** The HR Executive can read the forecast and recruitment but not approve or raise anything. */
export const EXEC_USER = {
  ...HR_USER,
  id: "33333333-3333-4333-8333-333333333333",
  email: "priya.demo@constructiq.test",
  full_name: "Priya Demo",
  roles: ["hr_executive"],
  permissions: [
    "employee:read",
    "project:read",
    "project:write",
    "staffing:read",
    "forecast:read",
    "staffing:create",
    "recruitment:read",
  ],
};

export const CEO_USER = {
  ...HR_USER,
  id: "22222222-2222-4222-8222-222222222222",
  email: "layla.demo@constructiq.test",
  full_name: "Layla Demo",
  roles: ["ceo"],
  permissions: [
    "employee:read",
    "project:read",
    "staffing:read",
    "forecast:read",
    "staffing:approve",
    "assignment:approve",
    "recruitment:read",
  ],
  landing: "executive",
};

const weeks = Array.from({ length: 13 }, (_, i) => ({
  week_start: new Date(Date.UTC(2026, 10, 5 + i * 7)).toISOString().slice(0, 10),
  count: [2, 1, 2, 2, 3, 2, 3, 3, 3, 4, 4, 4, 3][i],
}));

export const SUMMARY = {
  today: "2026-11-05",
  workforce: { total: 150, deployed: 112, mobilizing: 9, available: 21, unavailable: 8 },
  documents: { expired: 2, d30: 8, d60: 11, d90: 17 },
  expiry_by_week: weeks,
  short_total: 18,
  projects: [
    ["RAK-01", "Jebel Approach Road, Package 2", 30, 27],
    ["RAK-02", "Saqr Business Park", 24, 24],
    ["RAK-03", "Coral Bay Residences, Block B", 26, 18],
    ["RAK-04", "Khatt Clinic Fit-out", 12, 12],
    ["RAK-05", "Ghalilah School Extension", 16, 15],
    ["RAK-06", "Dhayah Warehouse Units", 22, 16],
  ].map(([code, name, planned, deployed]) => ({
    code,
    name,
    status: "active",
    starts: "2026-03-01",
    ends: "2027-08-31",
    planned,
    deployed,
  })),
};

const DUE = [
  ["EMP-0595", "Farhan Khan", "medical_fitness", "2026-10-25", -11],
  ["EMP-0088", "Sanjeev Rana", "residency_visa", "2026-11-12", 7],
].map(([code, name, type, expiry, days]) => ({
  worker_code: code,
  worker_name: name,
  trade: "Mason",
  project: null,
  phone: "+971 50 000 0000",
  type,
  expiry,
  days_left: days,
}));

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, json: body, headers });

/** A saved Home layout, as the API stores it. */
export type SavedLayout = { order: string[]; hidden: string[] };

const TRADE_STRENGTH = [
  {
    trade: "Steel fixer",
    group: "Structure",
    deployed: 25,
    mobilizing: 2,
    available: 10,
    unavailable: 0,
    total: 37,
  },
  {
    trade: "Mason",
    group: "Finishes",
    deployed: 27,
    mobilizing: 2,
    available: 2,
    unavailable: 2,
    total: 33,
  },
  {
    trade: "General labour",
    group: "General",
    deployed: 25,
    mobilizing: 2,
    available: 3,
    unavailable: 2,
    total: 32,
  },
  {
    trade: "Carpenter",
    group: "Structure",
    deployed: 20,
    mobilizing: 2,
    available: 2,
    unavailable: 2,
    total: 26,
  },
];

const UNAVAILABLE = ["Kiran Jha", "Rohit Verma", "Omar Ali"].map((name, i) => ({
  code: `EMP-060${i}`,
  name,
  trade: "Mason",
  level: 3,
  status: "unavailable",
  project: null,
  phone: "+971 50 000 0000",
  next_document: null,
}));

/**
 * Pretend to be the API. `user: null` means nobody is signed in. Returns what the page saved, so a
 * test can check it: `saved` holds every layout the page sent, `reads` counts requests per widget feed.
 */
export async function mockApi(
  page: Page,
  options: {
    user?: typeof HR_USER | null;
    demo?: boolean;
    /** The layout this person has saved before (null = never changed it). */
    layout?: SavedLayout | null;
    /** Make saving a layout fail. */
    failSave?: boolean;
  } = {},
) {
  const user = options.user === undefined ? HR_USER : options.user;
  const seen = { saved: [] as (SavedLayout | null)[], recruitment: 0, trades: 0, unavailable: 0 };
  let layout = options.layout ?? null;
  await page.route("**/api/auth/config", (r) => json(r, { demo_mode: options.demo ?? false }));
  await page.route("**/api/auth/me", (r) =>
    user ? json(r, user) : json(r, { detail: "Sign in to continue" }, 401),
  );
  await page.route("**/api/auth/me/preferences", (r) => {
    if (r.request().method() === "PUT") {
      if (options.failSave) return json(r, { detail: "Couldn’t save right now." }, 500);
      const body = r.request().postDataJSON() as { home: SavedLayout | null };
      layout = body.home;
      seen.saved.push(body.home);
      return json(r, body);
    }
    return json(r, { home: layout });
  });
  await page.route("**/api/summary", (r) => json(r, SUMMARY));
  await page.route("**/api/summary/trades", (r) => {
    seen.trades += 1;
    return json(r, TRADE_STRENGTH);
  });
  await page.route("**/api/recruitment-requests", (r) => {
    seen.recruitment += 1;
    return json(r, RECRUITMENT);
  });
  await page.route(/\/api\/workers\?.*status=unavailable/, (r) => {
    seen.unavailable += 1;
    return json(r, { total: UNAVAILABLE.length, items: UNAVAILABLE });
  });
  await page.route("**/api/documents/expiring**", (r) => {
    const window = new URL(r.request().url()).searchParams.get("window");
    const counts = SUMMARY.documents;
    json(r, { counts, items: window === "expired" ? [DUE[0]] : window === "d30" ? [DUE[1]] : [] });
  });
  return seen;
}
/** The cookie the sign-in sets. The web app's proxy only checks that it exists. */
export async function haveSession(page: Page) {
  await page
    .context()
    .addCookies([{ name: "cq_session", value: "test", url: "http://localhost:3100" }]);
}

// --------------------------------------------------------------------------- workers

const NAMES = [
  "Sanjeev Rana",
  "Omar Khan",
  "Farhan Khan",
  "Ali Ahmed",
  "Dinesh Pandey",
  "Irfan Sheikh",
];
const STATUSES = ["deployed", "deployed", "available", "mobilizing", "deployed", "unavailable"];

/** 30 people: enough for a second page (25 per page). EMP-0088 is Sanjeev Rana, visa ending in 7 days. */
export const WORKER_ROWS = Array.from({ length: 30 }, (_, i) => {
  const code = i === 0 ? "EMP-0088" : `EMP-${String(500 + i).padStart(4, "0")}`;
  const days = i === 0 ? 7 : 120 + i * 9;
  return {
    code,
    name: i < NAMES.length ? NAMES[i] : `Worker Number ${i}`,
    trade: ["Mason", "Carpenter", "Painter"][i % 3],
    level: (i % 5) + 1,
    status: STATUSES[i % STATUSES.length],
    project: STATUSES[i % STATUSES.length] === "deployed" ? `RAK-0${(i % 6) + 1}` : null,
    phone: `+971 50 ${100 + i} ${1000 + i}`,
    next_document: {
      type: i % 2 ? "medical_fitness" : "residency_visa",
      expiry: "2026-11-12",
      days_left: days,
    },
  };
});

const WORKER_DETAIL = {
  ...WORKER_ROWS[0],
  documents: [
    {
      type: "residency_visa",
      number: "•••• 7711",
      can_reveal: true,
      expiry: "2026-11-12",
      days_left: 7,
      status: "verified",
    },
    {
      type: "medical_fitness",
      number: "•••• 4410",
      can_reveal: true,
      expiry: "2027-06-01",
      days_left: 208,
      status: "verified",
    },
  ],
  assignments: [
    {
      project_code: "RAK-01",
      project_name: "Jebel Approach Road, Package 2",
      starts: "2026-03-01",
      ends: "2027-01-31",
      status: "active",
    },
  ],
  risks: [
    {
      kind: "ends_before_assignment",
      severity: "warning",
      document_type: "residency_visa",
      expiry: "2026-11-12",
      project_code: "RAK-01",
      days_short: 80,
      message: "Residency visa ends 12 Nov 2026, before the job on RAK-01 ends (31 Jan 2027).",
    },
  ],
};

const FACETS = {
  trades: [
    { value: "Carpenter", count: 10 },
    { value: "Mason", count: 10 },
    { value: "Painter", count: 10 },
  ],
  statuses: [
    { value: "deployed", count: 15 },
    { value: "available", count: 5 },
    { value: "mobilizing", count: 5 },
    { value: "unavailable", count: 5 },
  ],
  projects: [
    { value: "RAK-01", count: 3 },
    { value: "RAK-02", count: 3 },
  ],
  documents: { expired: 2, expiring_30: 4 },
};

/** The Workers endpoints, with search, status filter and paging done the way the API does them. */
export async function mockWorkers(page: Page) {
  await page.route("**/api/workers/facets", (r) => json(r, FACETS));
  await page.route("**/api/workers/export.csv**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/csv",
      body: "Code,Name\r\nEMP-0088,Sanjeev Rana\r\n",
    }),
  );
  await page.route(/\/api\/workers\/EMP-[0-9]+\/documents\/[a-z_]+\/reveal$/, (r) =>
    json(r, { number: "784-1988-1234567-1" }),
  );
  await page.route(/\/api\/workers\/EMP-0088$/, (r) => json(r, WORKER_DETAIL));
  await page.route(/\/api\/workers\?/, (r) => {
    const params = new URL(r.request().url()).searchParams;
    const q = (params.get("q") ?? "").toLowerCase();
    const status = params.get("status");
    const rows = WORKER_ROWS.filter(
      (w) =>
        (!q || w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q)) &&
        (!status || w.status === status),
    );
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? 25);
    json(r, { total: rows.length, items: rows.slice(offset, offset + limit) });
  });
}

// --------------------------------------------------------------------------- projects and the forecast

const PROJECT_LIST = [
  ...SUMMARY.projects,
  {
    code: "RAK-07",
    name: "Shamal Logistics Hub",
    status: "planning",
    starts: "2027-02-12",
    ends: "2027-12-31",
    planned: 24,
    deployed: 0,
  },
];

const worker = (code: string, name: string, level = 3) => ({
  code,
  name,
  level,
  documents_valid: true,
});

/** The shape of GET /projects/{code}/forecast, with the numbers the seed gives RAK-07. */
export function forecastFor(code: string, start = "2027-02-12") {
  return {
    project: {
      code,
      name: code === "RAK-07" ? "Shamal Logistics Hub" : "Al Hamra Marina Towers",
      status: "planning",
      starts_on: "2027-02-12",
      ends_on: "2027-12-31",
    },
    today: "2026-11-05",
    start,
    window_end: "2027-05-13",
    buffer_days: 7,
    late_window_days: 21,
    trades: [
      {
        trade_code: "general_labour",
        trade: "General labour",
        needed: 6,
        already_assigned: 0,
        deployable: 5,
        recruitment_pending: 0,
        gap: 1,
        uncovered_gap: 1,
        sources: [
          {
            kind: "available_now",
            project_code: null,
            ends_on: null,
            must_finish_by: null,
            workers: [worker("EMP-0170", "Ram Bahadur", 2), worker("EMP-0171", "Abdul Karim", 1)],
          },
          {
            kind: "ending_before_start",
            project_code: "RAK-05",
            ends_on: "2026-12-15",
            must_finish_by: "2027-02-05",
            workers: [worker("EMP-0540", "Naresh Das"), worker("EMP-0541", "Omar Ali")],
          },
        ],
        late_candidates: [
          {
            ...worker("EMP-0584", "Tariq Mondal"),
            project_code: "RAK-06",
            ends_on: "2027-02-26",
            days_after_start: 14,
          },
        ],
        reserved: [
          {
            code: "EMP-0180",
            name: "Sunil Perera",
            starts_on: "2027-02-12",
            moving_from: "RAK-05",
            moving_from_ends: "2026-12-15",
          },
        ],
        arriving: [
          {
            stage: "visa_processing",
            stage_label: "Visa processing",
            stage_phrase: "in visa processing",
            headcount: 1,
            source: "overseas",
            expected_arrival: "2027-03-02",
            days_after_start: 18,
            late: true,
          },
        ],
        excluded: [
          {
            code: "EMP-0172",
            name: "Gopal Das",
            reason: "documents",
            detail: "Residency visa ends 9 Mar 2027",
          },
          {
            code: "EMP-0152",
            name: "Nabin Magar",
            reason: "leaving",
            detail: "Contract ends 15 Mar 2027",
          },
        ],
        advice: {
          verdict: "recruit",
          headline:
            "Recruit 1: locally by 13 Jan 2027, or overseas by 14 Dec 2026, or wait for 1 who finishes within 14 days of the start. 1 in visa processing arrives 2 Mar 2027, 18 days after the start.",
          recruit_count: 1,
          recruit_by: "2027-01-13",
          recruit_by_passed: false,
          recruit_by_overseas: "2026-12-14",
          recruit_by_overseas_passed: false,
          could_start_late: 1,
          max_delay_days: 14,
          recruit_instead: 0,
        },
      },
      {
        trade_code: "mason",
        trade: "Mason",
        needed: 10,
        already_assigned: 0,
        deployable: 10,
        recruitment_pending: 0,
        gap: 0,
        uncovered_gap: 0,
        sources: [],
        late_candidates: [],
        arriving: [],
        reserved: [],
        excluded: [],
        advice: {
          verdict: "covered_with_dependencies",
          headline: "Covered, but 8 still depend on other projects finishing by 5 Feb 2027.",
          recruit_count: 0,
          recruit_by: null,
          recruit_by_passed: false,
          recruit_by_overseas: null,
          recruit_by_overseas_passed: false,
          could_start_late: 0,
          max_delay_days: null,
          recruit_instead: 0,
        },
      },
      {
        trade_code: "steel_fixer",
        trade: "Steel fixer",
        needed: 8,
        already_assigned: 0,
        deployable: 21,
        recruitment_pending: 0,
        gap: 0,
        uncovered_gap: 0,
        sources: [],
        late_candidates: [],
        arriving: [],
        reserved: [],
        excluded: [],
        advice: {
          verdict: "covered",
          headline: "Covered by people who are free now.",
          recruit_count: 0,
          recruit_by: null,
          recruit_by_passed: false,
          recruit_by_overseas: null,
          recruit_by_overseas_passed: false,
          could_start_late: 0,
          max_delay_days: null,
          recruit_instead: 0,
        },
      },
    ],
  };
}

export const TRADES = [
  { code: "carpenter", name: "Carpenter" },
  { code: "general_labour", name: "General labour" },
  { code: "mason", name: "Mason" },
  { code: "steel_fixer", name: "Steel fixer" },
];

/** Projects, trades, adding a project (as RAK-08) and the forecast. */
export async function mockProjects(page: Page) {
  await page.route(/\/api\/projects$/, (r) => {
    if (r.request().method() === "POST") {
      const sent = r.request().postDataJSON() as {
        name: string;
        starts_on: string;
        ends_on: string;
      };
      return json(
        r,
        {
          code: "RAK-08",
          name: sent.name,
          status: "planning",
          starts: sent.starts_on,
          ends: sent.ends_on,
          planned: 18,
          deployed: 0,
        },
        201,
      );
    }
    return json(r, PROJECT_LIST);
  });
  await page.route("**/api/trades", (r) => json(r, TRADES));
  await page.route(/\/api\/projects\/[A-Z0-9-]+\/forecast/, (r) => {
    const url = new URL(r.request().url());
    const code = url.pathname.split("/")[3];
    return json(r, forecastFor(code, url.searchParams.get("start") ?? "2027-02-12"));
  });
}

// --------------------------------------------------------------------------- recruitment, reserve, release

const request = (n: number, changes: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  request_no: `RR-2026-000${n}`,
  project_code: "RAK-07",
  project_name: "Shamal Logistics Hub",
  project_starts_on: "2027-02-12",
  trade_code: "general_labour",
  trade: "General labour",
  headcount: 3,
  needed_by: "2027-01-13",
  stage: "open",
  stage_label: "Future requirement",
  source: "overseas",
  expected_arrival: null,
  arrives_late: false,
  reason: "Planned hiring for the new logistics hub",
  replaces_code: null,
  replaces_name: null,
  created_at: "2026-11-05T08:00:00Z",
  ...changes,
});

export const RECRUITMENT = {
  today: "2026-11-05",
  requests: [
    request(1, {
      stage: "visa_processing",
      stage_label: "Visa processing",
      expected_arrival: "2027-03-02",
      arrives_late: true,
      headcount: 1,
    }),
    request(2, {
      trade_code: "mason",
      trade: "Mason",
      stage: "offer_issued",
      stage_label: "Offer issued",
      headcount: 2,
      expected_arrival: "2027-02-01",
    }),
    request(3, {
      project_code: "RAK-01",
      project_name: "Jebel Approach Road",
      project_starts_on: "2026-03-01",
      trade_code: "steel_fixer",
      trade: "Steel fixer",
      stage: "sourcing",
      stage_label: "Under recruitment",
      source: "local",
      headcount: 1,
      replaces_code: "EMP-0125",
      replaces_name: "Suresh Nair",
    }),
    request(4, { stage: "filled", stage_label: "Active", headcount: 2, trade: "Painter" }),
  ],
  leaving: [
    {
      code: "EMP-0152",
      name: "Nabin Magar",
      trade_code: "steel_fixer",
      trade: "Steel fixer",
      project_code: null,
      kind: "contract_end",
      on: "2027-03-15",
      detail: "Contract ends 15 Mar 2027",
    },
    {
      code: "EMP-0595",
      name: "Farhan Khan",
      trade_code: "general_labour",
      trade: "General labour",
      project_code: "RAK-01",
      kind: "exit",
      on: "2026-12-15",
      detail: "Leaving on 15 Dec 2026 (terminated)",
    },
  ],
};

/** What the API would answer to reserve, release and the recruitment requests. */
export async function mockRecruitment(page: Page, data: typeof RECRUITMENT = RECRUITMENT) {
  const sent: { reserve: unknown[]; release: unknown[]; raise: unknown[]; advance: unknown[] } = {
    reserve: [],
    release: [],
    raise: [],
    advance: [],
  };
  await page.route(/\/api\/projects\/[A-Z0-9-]+\/reserve$/, (r) => {
    const body = r.request().postDataJSON() as { employee_codes: string[] };
    sent.reserve.push(body);
    const results = body.employee_codes.map((code) =>
      code === "EMP-0172"
        ? {
            code,
            name: "Gopal Das",
            outcome: "refused",
            reason: "Residency visa ends 9 Mar 2027",
          }
        : {
            code,
            name: code === "EMP-0170" ? "Ram Bahadur" : "Someone",
            outcome: "reserved",
            reason: null,
            starts_on: "2027-02-12",
            moving_from: code === "EMP-0540" ? "RAK-05" : null,
            moving_from_ends: code === "EMP-0540" ? "2026-12-15" : null,
          },
    );
    return json(r, {
      results,
      reserved: results.filter((x) => x.outcome === "reserved").length,
    });
  });
  await page.route(/\/api\/projects\/[A-Z0-9-]+\/release$/, (r) => {
    const body = r.request().postDataJSON() as { employee_codes: string[] };
    sent.release.push(body);
    return json(r, { released: body.employee_codes, not_found: [] });
  });
  await page.route(/\/api\/recruitment-requests$/, (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      sent.raise.push(body);
      return json(
        r,
        request(5, {
          headcount: body.headcount,
          trade: "General labour",
          source: body.source,
          needed_by: body.needed_by,
          reason: body.reason,
        }),
        201,
      );
    }
    return json(r, data);
  });
  await page.route(/\/api\/recruitment-requests\/[0-9a-f-]+\/advance$/, (r) => {
    const body = r.request().postDataJSON() as { to: string; count?: number };
    sent.advance.push(body);
    const id = r.request().url().split("/").slice(-2)[0];
    const original = data.requests.find((x) => x.id === id) ?? data.requests[0];
    const count = body.count ?? original.headcount;
    const advanced = { ...original, stage: body.to, headcount: count };
    return json(r, {
      advanced,
      remaining:
        count < original.headcount ? { ...original, headcount: original.headcount - count } : null,
    });
  });
  return sent;
}

// --------------------------------------------------------------------------- the Documents screen

type DocRow = {
  worker_code: string;
  worker_name: string;
  trade: string;
  project: string | null;
  phone: string | null;
  type: string;
  expiry: string;
  days_left: number;
  job_ends: string | null;
  ends_before_job: boolean;
};

const doc = (
  worker_code: string,
  worker_name: string,
  type: string,
  days_left: number,
  project: string | null,
  job_ends: string | null,
  ends_before_job: boolean,
): DocRow => ({
  worker_code,
  worker_name,
  trade: "Mason",
  project,
  phone: `+971 50 ${worker_code.slice(-3)} 1000`,
  type,
  expiry: new Date(Date.UTC(2026, 10, 5 + days_left)).toISOString().slice(0, 10),
  days_left,
  job_ends,
  ends_before_job,
});

export const DOC_ROWS: DocRow[] = [
  doc("EMP-0595", "Farhan Khan", "medical_fitness", -11, null, null, false),
  doc("EMP-0561", "Imran Ali", "labour_card", -4, "RAK-02", "2027-01-31", true),
  doc("EMP-0088", "Sanjeev Rana", "residency_visa", 7, "RAK-01", "2027-08-31", true),
  doc("EMP-0521", "Dev Raj", "medical_fitness", 12, "RAK-06", "2027-05-31", true),
  doc("EMP-0501", "Omar Khan", "residency_visa", 25, null, null, false),
  doc("EMP-0503", "Ali Ahmed", "labour_card", 45, "RAK-03", "2027-09-30", true),
  doc("EMP-0170", "Ram Bahadur", "residency_visa", 58, null, null, false),
  doc("EMP-0142", "Anil Kumar", "residency_visa", 80, "RAK-02", "2026-12-10", false),
];

const inWindow = (d: DocRow, window: string) =>
  window === "expired"
    ? d.days_left < 0
    : window === "d30"
      ? d.days_left >= 0 && d.days_left <= 30
      : window === "d60"
        ? d.days_left > 30 && d.days_left <= 60
        : d.days_left > 60 && d.days_left <= 90;

/** GET /documents/expiring and the CSV, filtered the way the API filters. Returns what was asked for. */
export async function mockDocuments(page: Page) {
  const asked: string[] = [];
  const matching = (params: URLSearchParams) => {
    const q = (params.get("q") ?? "").toLowerCase();
    return DOC_ROWS.filter(
      (d) =>
        (!q ||
          d.worker_name.toLowerCase().includes(q) ||
          d.worker_code.toLowerCase().includes(q)) &&
        (!params.get("type") || d.type === params.get("type")) &&
        (!params.get("project") || d.project === params.get("project")),
    );
  };
  await page.route(/\/api\/documents\/export\.csv/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/csv",
      body: "Code,Name\r\nEMP-0088,Sanjeev Rana\r\n",
    }),
  );
  await page.route(/\/api\/documents\/expiring/, (r) => {
    const params = new URL(r.request().url()).searchParams;
    asked.push(params.toString());
    const base = matching(params);
    const counts = {
      expired: base.filter((d) => inWindow(d, "expired")).length,
      d30: base.filter((d) => inWindow(d, "d30")).length,
      d60: base.filter((d) => inWindow(d, "d60")).length,
      d90: base.filter((d) => inWindow(d, "d90")).length,
    };
    return json(r, {
      counts,
      items: base.filter((d) => inWindow(d, params.get("window") ?? "d30")),
    });
  });
  return asked;
}
