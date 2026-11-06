import type { Page, Route } from "@playwright/test";

/** A signed-in user and a summary shaped like the API's, for tests that do not need a real server. */
export const HR_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "noura.demo@constructiq.test",
  full_name: "Noura Demo",
  roles: ["hr_manager"],
  permissions: ["employee:read", "project:read", "staffing:read"],
  demo_mode: true,
  landing: "hr",
};

export const CEO_USER = {
  ...HR_USER,
  id: "22222222-2222-4222-8222-222222222222",
  email: "layla.demo@constructiq.test",
  full_name: "Layla Demo",
  roles: ["ceo"],
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

/** Pretend to be the API. `user: null` means nobody is signed in. */
export async function mockApi(
  page: Page,
  options: { user?: typeof HR_USER | null; demo?: boolean } = {},
) {
  const user = options.user === undefined ? HR_USER : options.user;
  await page.route("**/api/auth/config", (r) => json(r, { demo_mode: options.demo ?? false }));
  await page.route("**/api/auth/me", (r) =>
    user ? json(r, user) : json(r, { detail: "Sign in to continue" }, 401),
  );
  await page.route("**/api/summary", (r) => json(r, SUMMARY));
  await page.route("**/api/documents/expiring**", (r) => {
    const window = new URL(r.request().url()).searchParams.get("window");
    const counts = SUMMARY.documents;
    json(r, { counts, items: window === "expired" ? [DUE[0]] : window === "d30" ? [DUE[1]] : [] });
  });
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
