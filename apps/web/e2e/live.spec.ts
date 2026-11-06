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
