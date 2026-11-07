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
const alertRows = (page: Page) => page.locator("li[data-alert]");
const alertBell = (page: Page) => page.getByRole("button", { name: /^Alerts: / });
/** The number on the bell: how many alerts need attention right now. */
const attention = async (page: Page) =>
  Number(/\d+/.exec((await alertBell(page).getAttribute("aria-label")) ?? "")?.[0]);

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

// Read-only, so it runs while the seeded alerts are all still there: later tests raise a recruitment
// request, reserve people and approve a request, and each of those clears an alert by itself.
test("To-do: HR sees the seeded alerts, most urgent first, and Home and the bell count the same ones", async ({
  page,
}) => {
  await signInAs(page, /HR Manager/);
  const center = page.locator('[data-widget="action_center"]');
  await expect(center.getByRole("link", { name: "Critical: 2" })).toBeVisible();
  await expect(center.getByRole("link", { name: "Action needed: 16" })).toBeVisible();
  await expect(center.getByRole("link", { name: "Info: 29" })).toBeVisible();
  await expect(alertBell(page)).toHaveAttribute("aria-label", "Alerts: 18 need attention");

  await page.getByRole("link", { name: "To-do" }).first().click();
  await expect(page.getByText("18 need attention, 29 for information")).toBeVisible();
  await expect(page.getByText(/Detectors last ran at 09:00 on 5 Nov 2026\./)).toBeVisible();
  await expect(alertRows(page)).toHaveCount(47);
  await expect(alertRows(page).nth(0)).toContainText(
    "Harish Mondal: residency visa ends in 3 days",
  );
  await expect(alertRows(page).nth(1)).toContainText("Sanjeev Rana: residency visa ends in 7 days");

  // Each of the detectors with a seeded case shows up, worded by Python from the real numbers.
  const search = page.getByLabel("Search alerts");
  await search.fill("SR-2026-0001");
  await expect(alertRows(page)).toHaveCount(1);
  await expect(alertRows(page).first()).toContainText("has waited 41 hours for approval");
  await search.fill("RAK-07");
  await expect(alertRows(page).first()).toContainText("1 general labour short");
  await search.fill("");
  await page.getByLabel("Filter by type").selectOption("midday_ban_conflict");
  await expect(alertRows(page)).toHaveCount(1);
  await expect(alertRows(page).first()).toContainText("(provisional)");
  await page.getByLabel("Filter by type").selectOption("mobilization_stuck");
  await expect(alertRows(page)).toHaveCount(7);

  // An alert opens with the facts behind it and the screen where the cause is fixed.
  await alertRows(page).filter({ hasText: "MOB-2026-0107" }).getByRole("button").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("table", { name: "Facts behind this alert" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open mobilization" })).toHaveAttribute(
    "href",
    "/mobilization?mob=MOB-2026-0107",
  );
  await sheet.getByRole("link", { name: "Open mobilization" }).click();
  await expect(page).toHaveURL(/\/mobilization\?mob=MOB-2026-0107/);
  await expect(page.getByRole("dialog").getByText("MOB-2026-0107").first()).toBeVisible();
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

test("Recruitment: the seeded pipeline and who is leaving with nobody to replace them", async ({
  page,
}) => {
  await signInAs(page, /HR Manager/);
  await page.getByRole("link", { name: "Recruitment" }).first().click();
  await expect(page.getByText("4 people on the way in 3 requests")).toBeVisible();
  const row = (no: string) => page.locator("table tbody tr").filter({ hasText: no });
  await expect(row("RR-2026-0001").getByText("Visa processing")).toBeVisible();
  await expect(row("RR-2026-0001").getByText("late", { exact: true })).toBeVisible();
  await expect(row("RR-2026-0003").getByText("Replaces Suresh Nair")).toBeVisible();
  await expect(page.getByText("Contract ends 15 Mar 2027")).toBeVisible();
  await expect(page.getByText(/Leaving on 31 Jan 2027/)).toHaveCount(0); // already being replaced
});

test("Recruitment: the HR Executive can read it but cannot press anything", async ({ page }) => {
  await signInAs(page, /HR Executive/);
  await page.goto("/recruitment");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move RR/ })).toHaveCount(0);
  const refused = await page.request.post("/api/recruitment-requests", {
    data: {
      trade: "mason",
      headcount: 1,
      needed_by: "2027-01-13",
      reason: "Not allowed to raise this",
    },
    headers: { Origin: "http://localhost:3100" },
  });
  expect(refused.status()).toBe(403);
});

test("Documents: the real windows match the dashboard, and the job each one hurts is named", async ({
  page,
}) => {
  await signInAs(page, /HR Manager/);
  await page.getByRole("link", { name: "Documents" }).first().click();
  await expect(page.getByRole("button", { name: /^Expired · 2$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next 30 days · 8$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^31–60 days · 11$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^61–90 days · 17$/ })).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(8);
  const sanjeev = page.locator("table tbody tr").filter({ hasText: "Sanjeev Rana" });
  await expect(sanjeev.getByText("31 Aug 2027")).toBeVisible();
  await expect(sanjeev.getByText("ends before the job")).toBeVisible();
  // The tabs follow the type filter.
  await page.getByLabel("Document", { exact: true }).selectOption("medical_fitness");
  await expect(page.getByRole("button", { name: /^Next 30 days · \d+$/ })).not.toHaveText(/· 8$/);
  // The profile opens on Documents with the number masked.
  await page.getByLabel("Document", { exact: true }).selectOption("");
  await sanjeev.getByRole("button", { name: /Sanjeev Rana/ }).click();
  await expect(page.getByRole("dialog").getByTestId("number-residency_visa")).toHaveText(/^•••• /);
});
// These two change the database (a request, a set of reservations). Run `make reset-demo` afterwards.
test("Recruitment: HR raises a request from the forecast and moves it along", async ({ page }) => {
  await signInAs(page, /HR Manager/);
  await page.goto("/projects/RAK-07/forecast");
  const labour = page.getByRole("region", { name: "General labour" });
  await labour.getByRole("button", { name: "Raise recruitment request" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Reason").fill("One more labourer for the logistics hub");
  await sheet.getByRole("button", { name: "Raise request" }).click();
  await expect(labour.getByText(/RR-2026-\d+ was raised for 1 general labour\./)).toBeVisible();

  await page.goto("/recruitment");
  const mine = page.locator("table tbody tr").filter({ hasText: "One more" });
  await expect(page.locator("table tbody tr")).toHaveCount(4);
  await page
    .locator("table tbody tr")
    .last()
    .getByRole("button", { name: /^Move RR/ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText(/1 person moved to under recruitment/)).toBeVisible();
  expect(await mine.count()).toBeLessThanOrEqual(1);
});

test("Reserve: HR holds the masons for RAK-07, and the forecast moves them to Already assigned", async ({
  page,
}) => {
  await signInAs(page, /HR Manager/);
  await page.goto("/projects/RAK-07/forecast");
  const mason = page.getByRole("region", { name: "Mason" });
  await mason.getByRole("button", { name: "Reserve people" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/You will reserve 10 people\./)).toBeVisible();
  await sheet.getByRole("button", { name: "Reserve 10" }).click();
  await expect(sheet.getByText("10 of 10 reserved.")).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await mason.getByRole("button", { name: "Show people" }).click();
  await expect(mason.getByRole("heading", { name: "Reserved (10)" })).toBeVisible();
  await expect(mason.getByText(/after leaving RAK-05/).first()).toBeVisible();
  await mason
    .getByRole("button", { name: /^Release / })
    .first()
    .click();
  await expect(mason.getByRole("heading", { name: "Reserved (9)" })).toBeVisible();
});

test("Transfer: moving the end of RAK-05 past the handover raises a critical alert, and moving it back clears it", async ({
  page,
}) => {
  // Relies on the masons the test above leaves reserved for RAK-07: they come from RAK-05.
  await signInAs(page, /HR Manager/);
  await page.goto("/projects");
  const changeEnd = async (ends: string) => {
    await page.getByRole("button", { name: "Change dates of RAK-05" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Ends").fill(ends);
    await sheet.getByRole("button", { name: "Save dates" }).click();
  };
  const risk = alertRows(page).filter({ hasText: "Transfer from RAK-05 to RAK-07 is at risk" });

  await changeEnd("2027-03-01");
  await expect(page.getByText(/RAK-05 now runs from .* to 1 Mar 2027\./)).toBeVisible();
  await expect.poll(() => attention(page)).toBeGreaterThan(0);
  await page.goto("/todo");
  await expect(risk).toHaveCount(1);
  await expect(risk).toContainText("Critical");
  await risk.getByRole("button").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/must finish by .* to start on 12 Feb 2027/)).toBeVisible();
  await expect(sheet.getByText(/Release the reservation, or change the dates\./)).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open forecast" })).toHaveAttribute(
    "href",
    "/projects/RAK-07/forecast",
  );
  await page.keyboard.press("Escape");

  // Put the date back: the cause is gone, so the alert clears itself.
  await page.goto("/projects");
  await changeEnd("2026-12-15");
  await expect(page.getByText(/RAK-05 now runs from .* to 15 Dec 2026\./)).toBeVisible();
  await page.goto("/todo");
  await expect(alertRows(page).first()).toBeVisible();
  await expect(risk).toHaveCount(0);
  await page.getByRole("button", { name: "Cleared" }).click();
  await expect(risk).toHaveCount(1);
});

test("Home: the real widgets show real numbers, and a person's layout is saved for them only", async ({
  page,
  browser,
}) => {
  await signInAs(page, /HR Manager/);
  const widget = (id: string) => page.locator(`[data-widget="${id}"]`);
  await expect(widget("leaving").getByText("Nabin Magar")).toBeVisible();
  await expect(widget("leaving").getByText("Contract 15 Mar 2027")).toBeVisible();
  await expect(widget("pipeline").getByText("3 arrive late")).toBeVisible(); // 1 labourer + 2 masons
  await expect(widget("by_trade").getByRole("img", { name: /Steel fixer 37/ })).toBeVisible();
  await expect(widget("unavailable").getByText("8 on leave or medical")).toBeVisible();

  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Hide Where everyone is" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Your layout was saved.")).toBeVisible();
  await page.reload();
  await expect(widget("expiry")).toBeVisible();
  await expect(widget("workforce")).toHaveCount(0); // still hidden after a reload

  // Another person on another browser is not affected.
  const other = await browser.newPage();
  await other.goto("/login");
  await other.getByRole("button", { name: /HR Executive/ }).click();
  await expect(other.locator('[data-widget="workforce"]')).toBeVisible();
  await other.close();

  // Put it back, so the demo is as we found it.
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Your layout was saved.")).toBeVisible();
  await page.reload();
  await expect(widget("workforce")).toBeVisible();
});

test("Allocation: the HR Executive cannot approve and the MD/CEO cannot choose people, even by asking the API directly", async ({
  page,
}) => {
  const origin = { Origin: "http://localhost:3100" };
  await signInAs(page, /HR Executive/);
  const detail = await (await page.request.get("/api/requests/SR-2026-0001")).json();
  const line = detail.lines[0].id as string;
  const approve = await page.request.post(`/api/requests/SR-2026-0001/lines/${line}/approve`, {
    data: { preview: true, employee_codes: null },
    headers: origin,
  });
  expect(approve.status()).toBe(403);

  await page.context().clearCookies();
  await signInAs(page, /MD \/ CEO/);
  await page.goto("/requests");
  await expect(page.locator("button[data-request]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New request" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Candidate pool" })).toHaveCount(0);
  const suggest = await page.request.post(`/api/requests/SR-2026-0001/lines/${line}/suggest`, {
    headers: origin,
  });
  expect(suggest.status()).toBe(403);
});

test("Workforce agent: with no model set up the button says so, and the API refuses a run", async ({
  page,
}) => {
  const origin = { Origin: "http://localhost:3100" };
  await signInAs(page, /HR Executive/);
  expect(await (await page.request.get("/api/ai/status")).json()).toEqual({
    light: false,
    mid: false,
  });
  await page.goto("/requests?request=SR-2026-0001");
  const steel = page.getByRole("region", { name: "Steel fixer line" });
  await expect(steel.getByRole("button", { name: "Ask Workforce agent" })).toBeDisabled();
  await expect(steel.getByText("The AI model is not set up on this server.")).toBeVisible();

  const detail = await (await page.request.get("/api/requests/SR-2026-0001")).json();
  const run = { kind: "recommend_line", request_no: "SR-2026-0001", line_id: detail.lines[0].id };
  const refused = await page.request.post("/api/agent/runs", { data: run, headers: origin });
  expect(refused.status()).toBe(503);
  expect(await refused.text()).toContain("not set up");

  await page.goto("/projects/RAK-07/forecast");
  await expect(page.getByRole("button", { name: "Explain" })).toBeDisabled();

  await page.context().clearCookies();
  await signInAs(page, /MD \/ CEO/);
  const noAccess = await page.request.post("/api/agent/runs", { data: run, headers: origin });
  expect(noAccess.status()).toBe(403); // may read requests, cannot choose people
});

const pipelineCard = (page: Page, no: string) => page.locator(`button[data-mob="${no}"]`);
const stageColumn = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("Mobilization: the seeded pipeline sits in its stages, and a profile shows the same progress", async ({
  page,
}) => {
  await signInAs(page, /HR Manager/);
  await page.getByRole("link", { name: "Mobilization" }).first().click();
  await expect(page.getByText("9 people being mobilized, 2 with an overdue task")).toBeVisible();
  await expect(stageColumn(page, "Pending checklist").locator("button[data-mob]")).toHaveCount(1);
  await expect(stageColumn(page, "In progress").locator("button[data-mob]")).toHaveCount(6);
  await expect(stageColumn(page, "Ready to report").locator("button[data-mob]")).toHaveCount(2);
  await expect(stageColumn(page, "On site").locator("button[data-mob]")).toHaveCount(0);

  const stuck = pipelineCard(page, "MOB-2026-0107");
  await expect(stuck).toContainText("1 overdue");
  await expect(stuck).toContainText("3 of 5 tasks done");
  const code = /EMP-\d{4}/.exec(await stuck.innerText())?.[0] ?? "";
  await stuck.click();
  const sheet = page.getByRole("dialog");
  const docs = sheet.locator('li[data-task="Verify residency visa and medical fitness"]');
  await expect(docs).toContainText("Overdue");
  await expect(docs).toContainText("Due 1 Nov 2026");
  await expect(sheet.locator('li[data-task="Assign a camp bed"]')).toContainText(
    "Done by Noura Demo",
  );
  await expect(sheet.getByRole("button", { name: "Confirm arrival" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.goto(`/workers?worker=${code}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Projects/ })
    .click();
  await expect(page.getByRole("link", { name: "MOB-2026-0107" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("3 of 5 tasks done")).toBeVisible();
});

test("Mobilization: the MD/CEO reads every checklist but cannot change one, even by asking the API", async ({
  page,
}) => {
  const origin = { Origin: "http://localhost:3100" };
  await signInAs(page, /MD \/ CEO/);
  await page.goto("/mobilization");
  await expect(pipelineCard(page, "MOB-2026-0107")).toBeVisible();
  await pipelineCard(page, "MOB-2026-0107").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Only HR ticks tasks off.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Mark done|Reopen|Confirm arrival/ })).toHaveCount(
    0,
  );
  const detail = await (await page.request.get("/api/mobilizations/MOB-2026-0107")).json();
  const task = detail.tasks[0].id as string;
  const tick = await page.request.post(`/api/mobilizations/MOB-2026-0107/tasks/${task}/done`, {
    headers: origin,
  });
  expect(tick.status()).toBe(403);
  const arrival = await page.request.post("/api/mobilizations/MOB-2026-0101/arrival", {
    headers: origin,
  });
  expect(arrival.status()).toBe(403);
});

test("Mobilization: HR ticks a task and the card moves, while arrival waits for the report day", async ({
  page,
}) => {
  const origin = { Origin: "http://localhost:3100" };
  await signInAs(page, /HR Manager/);
  await page.goto("/mobilization");
  const docs = "Verify residency visa and medical fitness";
  await expect(
    stageColumn(page, "Pending checklist").locator('button[data-mob="MOB-2026-0109"]'),
  ).toBeVisible();
  await pipelineCard(page, "MOB-2026-0109").click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: `Mark done: ${docs}` }).click();
  await expect(sheet.getByText(`${docs} is done.`)).toBeVisible();
  await expect(sheet.locator(`li[data-task="${docs}"]`)).toContainText("Done by Noura Demo");
  await page.keyboard.press("Escape");
  await expect(
    stageColumn(page, "In progress").locator('button[data-mob="MOB-2026-0109"]'),
  ).toBeVisible();

  // The report day is 8 Nov and today (simulated) is 5 Nov: arrival is refused, in the screen and by the API.
  await pipelineCard(page, "MOB-2026-0101").click();
  await expect(
    sheet.getByText("Reports on 8 Nov 2026. Arrival can be confirmed from that day."),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Confirm arrival" })).toBeDisabled();
  const refused = await page.request.post("/api/mobilizations/MOB-2026-0101/arrival", {
    headers: origin,
  });
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain("Arrival can be confirmed from that day");
  await page.keyboard.press("Escape");

  // Put the task back, so the demo is as we found it.
  await pipelineCard(page, "MOB-2026-0109").click();
  await sheet.getByRole("button", { name: `Reopen ${docs}` }).click();
  await expect(sheet.getByText(`${docs} is open again.`)).toBeVisible();
});

test("To-do: the MD/CEO sees every alert but cannot change one, even by asking the API", async ({
  page,
}) => {
  const origin = { Origin: "http://localhost:3100" };
  await signInAs(page, /MD \/ CEO/);
  const tile = page.locator('[data-widget="alert_counts"]');
  await expect(tile.getByRole("link", { name: "Critical: 2" })).toBeVisible();
  await tile.getByRole("link", { name: "Critical: 2" }).click();
  await expect(page).toHaveURL(/\/todo\?severity=critical/);
  await expect(alertRows(page)).toHaveCount(2);
  await expect(page.getByLabel("Select every alert in the list")).toHaveCount(0);
  await alertRows(page).first().getByRole("button").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Only HR works on alerts.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Take it|Assign|Snooze|Dismiss/ })).toHaveCount(0);

  const { items } = await (await page.request.get("/api/alerts")).json();
  const id = items[0].id as string;
  const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
  for (const [path, data] of [
    [`/api/alerts/${id}/take`, undefined],
    [`/api/alerts/${id}/snooze`, { until: inAnHour }],
    [`/api/alerts/${id}/dismiss`, { reason: "It is not for the MD to decide" }],
    ["/api/alerts/bulk", { ids: [id], action: "snooze", until: inAnHour }],
    ["/api/alerts/run", undefined],
  ] as const) {
    const refused = await page.request.post(path, { data, headers: origin });
    expect(refused.status(), path).toBe(403);
  }
});

// Last on purpose: approving starts real mobilizations. Run `make reset-demo` afterwards.
test("Allocation: the Executive prepares SR-2026-0001, the Manager approves it, and Mobilizing moves", async ({
  page,
}) => {
  await signInAs(page, /HR Executive/);
  await page.getByRole("link", { name: "Allocation" }).first().click();
  const steel = page.getByRole("region", { name: "Steel fixer line" });
  await expect(page.getByRole("heading", { name: /SR-2026-0001/ })).toBeVisible();
  await expect(steel).toContainText("0 of 7 selected");
  await expect(steel.getByText(/Left out by the rules/)).toBeVisible();
  await expect(steel.getByText("DOC_VALID_THROUGH").first()).toBeVisible();
  await expect(steel.getByText("ASSIGN_STATUS").first()).toBeVisible();
  await steel.getByRole("button", { name: "Suggest people" }).click();
  await expect(steel.locator("li[data-worker]")).toHaveCount(7);
  await expect(steel.getByText("Approving needs the HR Manager.")).toBeVisible();
  await expect(steel.getByRole("button", { name: /Approve|Reject/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await signInAs(page, /HR Manager/);
  await expect(kpi(page, "Mobilizing")).toHaveText("9");
  await page.goto("/requests?request=SR-2026-0001");
  await expect(steel.locator("li[data-worker]")).toHaveCount(7);
  await steel.getByRole("button", { name: "Approve 7 workers" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("7 assignments planned, 7 mobilizations started.")).toBeVisible();
  await dialog.getByRole("button", { name: "Approve 7 workers" }).click();
  await expect(
    page.getByText(
      /Approved 7 workers as steel fixer\. 7 mobilizations started \(MOB-2026-\d{4} to MOB-2026-\d{4}\)\./,
    ),
  ).toBeVisible();
  await expect(steel).toContainText("Approved by Noura Demo");
  await expect(steel.getByRole("list", { name: "Approved workers" }).locator("li")).toHaveCount(7);

  // The seven new mobilizations are waiting in the pipeline, next to the one that was already there.
  await page.getByRole("link", { name: "Open the pipeline" }).click();
  await expect(page).toHaveURL(/\/mobilization/);
  const pending = page.getByRole("region", { name: "Pending checklist", exact: true });
  await expect(pending.locator("button[data-mob]")).toHaveCount(8);
  await expect(pending.locator('button[data-mob="MOB-2026-0110"]')).toBeVisible();

  await page.goto("/");
  await expect(kpi(page, "Mobilizing")).not.toHaveText("9"); // the free people are now mobilizing

  // The approval alert was waiting on this very request: it cleared itself, nobody pressed anything.
  await page.goto("/todo");
  await page.getByLabel("Search alerts").fill("SR-2026-0001");
  await expect(page.getByText("No alerts match these filters")).toBeVisible();
});

// After the approval, and also changes data for good (snoozed and dismissed alerts stay that way
// until `make reset-demo`), so it compares counts before and after rather than fixed numbers.
test("To-do: HR takes an alert, snoozes it, dismisses another with a reason, and the counters follow", async ({
  page,
}) => {
  const origin = { Origin: "http://localhost:3100" };
  await signInAs(page, /HR Manager/);
  await page.goto("/todo");
  await expect(alertRows(page).first()).toBeVisible();
  const before = await attention(page);

  // Take, then snooze: it leaves the open list, the bell drops by one, the Snoozed tab has it.
  const tariq = alertRows(page).filter({ hasText: "Tariq Zaman: residency visa" });
  await tariq.getByRole("button").first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Take it" }).click();
  await expect(sheet.getByText("You took this alert.")).toBeVisible();
  await sheet.getByRole("button", { name: "Snooze", exact: true }).click();
  await sheet
    .getByRole("group", { name: "Snooze until" })
    .getByRole("button", { name: "4 hours" })
    .click();
  await expect(sheet.getByText(/Snoozed until 5 Nov 2026\./)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tariq).toHaveCount(0);
  await expect.poll(() => attention(page)).toBe(before - 1);
  await page.getByRole("button", { name: /^Snoozed/ }).click();
  await expect(tariq).toHaveCount(1);
  await page.getByRole("button", { name: /^Open/ }).click();

  // Dismiss needs a reason; the alert moves to Cleared with the reason in its history.
  const yasir = alertRows(page).filter({ hasText: "Yasir Mondal: labour card" });
  await yasir.getByRole("button").first().click();
  await sheet.getByRole("button", { name: "Dismiss", exact: true }).click();
  const form = sheet.getByRole("form", { name: "Dismiss this alert" });
  await form.getByLabel("Why is this being dismissed?").fill("too short");
  await expect(form.getByRole("button", { name: "Dismiss alert" })).toBeDisabled();
  await form
    .getByLabel("Why is this being dismissed?")
    .fill("Renewal already started with the worker");
  await form.getByRole("button", { name: "Dismiss alert" }).click();
  await expect(sheet.getByText("Dismissed.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(yasir).toHaveCount(0);
  await page.getByRole("button", { name: "Cleared" }).click();
  await expect(yasir).toHaveCount(1);
  await page.getByRole("button", { name: /^Open/ }).click();

  // An alert that clears itself can only be snoozed, in the screen and by the API.
  const mobilization = alertRows(page).filter({ hasText: "MOB-2026-0107" });
  await mobilization.getByRole("button").first().click();
  await expect(sheet.getByRole("button", { name: "Snooze", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
  const { items } = await (await page.request.get("/api/alerts?type=mobilization_stuck")).json();
  const refused = await page.request.post(`/api/alerts/${items[0].id}/dismiss`, {
    data: { reason: "I would rather not see this one" },
    headers: origin,
  });
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain("can only be snoozed");
});
