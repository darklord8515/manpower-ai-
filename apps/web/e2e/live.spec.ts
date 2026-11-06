import { expect, test, type Page } from "@playwright/test";

/**
 * The same flows against the REAL API and the seeded database (no mocks).
 * Runs only when you point it at an API:
 *
 *   # terminal 1 (apps/api), from a database that has had `make reset-demo`:
 *   $env:CORS_ORIGINS="http://localhost:3000,http://localhost:3100"; $env:SIMULATED_CLOCK="true"
 *   uv run uvicorn app.main:app --port 8010
 *   # terminal 2 (apps/web):
 *   $env:LIVE_API_URL="http://localhost:8010"; npx playwright test live.spec.ts
 *
 * SIMULATED_CLOCK makes "today" 5 Nov 2026, so the numbers match the prototype exactly.
 */
test.skip(!process.env.LIVE_API_URL, "Set LIVE_API_URL to run the live checks");

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const kpi = (page: Page, label: string) =>
  page.locator(`section[aria-label="${label}"] b[aria-hidden="true"]`).first();

async function signInAs(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("HR Manager sees the real numbers on Home", async ({ page }) => {
  await signInAs(page, /HR Manager/);
  await expect(heading(page)).toContainText("Noura");
  await expect(kpi(page, "Deployed")).toHaveText("112");
  await expect(kpi(page, "Available now")).toHaveText("21");
  await expect(kpi(page, "Mobilizing")).toHaveText("9");
  await expect(kpi(page, "Documents running out")).toHaveText("8");
  await expect(page.getByText("2 already expired")).toBeVisible();
  const due = page.getByRole("table", { name: "Documents to deal with first" });
  await expect(due.getByText("Sanjeev Rana")).toBeVisible();
  await expect(due.getByText("7 d left")).toBeVisible(); // 12 Nov, from the demo date 5 Nov
});

test("the MD/CEO sees the executive Home", async ({ page }) => {
  await signInAs(page, /MD \/ CEO/);
  await expect(heading(page)).toContainText("Layla");
  await expect(kpi(page, "Active projects")).toHaveText("6");
  await expect(kpi(page, "People short")).toHaveText("18");
  await expect(page.getByRole("table", { name: "Projects" }).getByText("RAK-03")).toBeVisible();
});

test("the HR Executive signs in too, and the session survives a reload", async ({ page }) => {
  await signInAs(page, /HR Executive/);
  await expect(heading(page)).toContainText("Priya");
  await page.reload();
  await expect(heading(page)).toContainText("Priya");
  await expect(kpi(page, "Deployed")).toHaveText("112");
});

test("signing out ends the session for real", async ({ page }) => {
  await signInAs(page, /HR Manager/);
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?reason=signed-out/);
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(401);
});

test("a wrong password is refused, and five wrong passwords lock the email", async ({ page }) => {
  await page.goto("/login");
  const email = `nobody-${Date.now()}@constructiq.test`;
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Email or password is not right.")).toBeVisible();
  }
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/Try again in 1[45]:\d\d/)).toBeVisible();
});

test("a signed-out visitor cannot read data, even by asking the API directly", async ({
  request,
}) => {
  for (const path of ["/api/summary", "/api/workers", "/api/documents/expiring", "/api/projects"]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
});

test("a forged session cookie gets the sign-in page, not data", async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "cq_session", value: "forged.value", url: "http://localhost:3100" }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(heading(page)).toHaveText("Sign in");
});

test("a real password works, when DEMO_PASSWORD is provided to the test", async ({ page }) => {
  test.skip(!process.env.DEMO_PASSWORD, "Set DEMO_PASSWORD to run this one");
  await page.goto("/login");
  await page.getByLabel("Email").fill("noura.demo@constructiq.test");
  await page.getByLabel("Password", { exact: true }).fill(process.env.DEMO_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(heading(page)).toContainText("Noura");
});

test("Workers: the real directory, filters, a profile and the eye icon", async ({ page }) => {
  await signInAs(page, /HR Manager/);
  await page.getByRole("link", { name: "Workers" }).first().click();
  await expect(page.getByText("150 people")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Everyone · 150/ })).toBeVisible();
  await page.getByRole("button", { name: /^Available · 21/ }).click();
  await expect(page.getByText("21 people match")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page.getByLabel("Search workers").fill("Sanjeev");
  await page
    .getByRole("table")
    .getByRole("button", { name: /Sanjeev Rana/ })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByText(/Residency visa ends 12 Nov 2026, before the job on RAK-01/),
  ).toBeVisible();
  await sheet.getByRole("button", { name: /^Documents/ }).click();
  await expect(sheet.getByTestId("number-residency_visa")).toHaveText(/^•••• /);
  await sheet.getByRole("button", { name: "Show emirates id number" }).click();
  await expect(sheet.getByTestId("number-residency_visa")).toHaveText(/^784-198\d-\d{7}-\d$/);
});

test("Workers: the HR Executive sees masked numbers and no eye", async ({ page }) => {
  await signInAs(page, /HR Executive/);
  await page.goto("/workers?worker=EMP-0088");
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /^Documents/ }).click();
  await expect(sheet.getByTestId("number-residency_visa")).toHaveText(/^•••• /);
  await expect(sheet.getByRole("button", { name: /Show emirates id number/ })).toHaveCount(0);
});

test("Projects: the real list and the seeded RAK-07 forecast", async ({ page }) => {
  await signInAs(page, /HR Manager/);
  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page.getByText(/^\d+ projects, \d+ in planning$/)).toBeVisible();
  const row = page.locator("table tbody tr").filter({ hasText: "RAK-07" });
  await expect(row.getByText("Planning")).toBeVisible();
  await row.getByRole("link", { name: "Forecast" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Shamal Logistics Hub");
  await expect(
    page.getByText("Covered, but 8 still depend on other projects finishing by 5 Feb 2027."),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Recruit 1: locally by 13 Jan 2027, or overseas by 14 Dec 2026, or wait for 1 who finishes within 14 days of the start\. 1 in visa processing arrives 2 Mar 2027, 18 days after the start\./,
    ),
  ).toBeVisible();
  await page.getByLabel("What if it starts on").fill("2027-03-01");
  await expect(page).toHaveURL(/start=2027-03-01/);
  await expect(page.getByText(/Who could work here from 1 Mar 2027/)).toBeVisible();
});

test("Projects: the MD/CEO cannot add a project, even by asking the API directly", async ({
  page,
}) => {
  await signInAs(page, /MD \/ CEO/);
  await page.goto("/projects");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);
  const refused = await page.request.post("/api/projects", {
    data: {
      name: "Not allowed",
      starts_on: "2027-04-01",
      ends_on: "2027-05-01",
      lines: [{ trade: "mason", headcount: 1 }],
    },
    headers: { Origin: "http://localhost:3100" },
  });
  expect(refused.status()).toBe(403);
});

// Last on purpose: it adds a real project (RAK-08, RAK-09, ... on each run) to the database.
test("Projects: HR adds a project and sees its forecast straight away", async ({ page }) => {
  await signInAs(page, /HR Manager/);
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add project" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Project name").fill("Live Test Tower");
  await sheet.getByLabel("Starts").fill("2027-04-01");
  await sheet.getByLabel("Ends").fill("2028-03-31");
  await sheet.getByLabel("Trade 1", { exact: true }).selectOption("mason");
  await sheet.getByLabel("How many 1").fill("30");
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/RAK-\d+\/forecast/);
  await expect(page.getByText(/RAK-\d+ was added\. Here is who could work on it\./)).toBeVisible();
  const mason = page.getByRole("region", { name: "Mason" });
  await expect(mason.getByText("30", { exact: true }).first()).toBeVisible();
  await expect(mason.getByText(/^Recruit \d+: locally by/)).toBeVisible(); // 30 masons is more than the company has
});
