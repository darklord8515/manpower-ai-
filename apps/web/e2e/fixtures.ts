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
