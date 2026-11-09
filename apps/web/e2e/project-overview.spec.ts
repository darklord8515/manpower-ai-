import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, haveSession, mockApi, mockProjects } from "./fixtures";

/** The project overview and the "who can move here" view, with the API mocked. */

const OVERVIEW = {
  code: "RAK-07",
  name: "Falcon Villas",
  status: "planning",
  description: "Three warehouse units and a yard at Shamal.",
  client: "Shamal Holdings",
  starts: "2027-02-12",
  ends: "2027-11-30",
  progress: 0,
  days_left: null,
  planned: 24,
  deployed: 0,
  mobilizing: 2,
  gap: 24,
  sites: [
    {
      name: "Shamal Yard",
      emirate: "Ras Al Khaimah",
      latitude: 25.7,
      longitude: 55.9,
      outdoor: true,
    },
  ],
  trades: [
    { trade: "Mason", planned: 10, deployed: 0, mobilizing: 1, gap: 10 },
    { trade: "Steel fixer", planned: 8, deployed: 0, mobilizing: 1, gap: 8 },
    { trade: "General labour", planned: 6, deployed: 0, mobilizing: 0, gap: 6 },
  ],
  staff: [
    {
      code: "EMP-0142",
      name: "Anil Kumar",
      trade: "Steel fixer",
      level: 4,
      status: "mobilizing",
      starts: "2027-02-12",
      ends: null,
      site: "Shamal Yard",
    },
    {
      code: "EMP-0107",
      name: "Bikash Rai",
      trade: "Mason",
      level: 3,
      status: "mobilizing",
      starts: "2027-02-12",
      ends: "2027-11-30",
      site: null,
    },
  ],
  staff_total: 2,
};

async function open(
  page: Page,
  options: { user?: typeof CEO_USER; missing?: boolean; fail?: boolean } = {},
) {
  await haveSession(page);
  await mockApi(page, options.user ? { user: options.user } : {});
  await mockProjects(page);
  await page.route(/\/api\/projects\/RAK-07\/overview$/, (route) => {
    if (options.fail)
      return route.fulfill({ status: 500, json: { detail: "The server had a problem." } });
    return route.fulfill({ json: OVERVIEW });
  });
  await page.route(/\/api\/projects\/NOPE-1\/overview$/, (route) =>
    route.fulfill({ status: 404, json: { detail: "Project not found" } }),
  );
  await page.goto(options.missing ? "/projects/NOPE-1" : "/projects/RAK-07");
}

test("the overview shows where, when, how staffed and who is on it", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Falcon Villas");
  await expect(page.getByText("Shamal Holdings")).toBeVisible();
  await expect(page.getByText("Shamal Yard")).toBeVisible();
  await expect(page.getByText("outdoor, midday ban applies")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Maps" })).toHaveAttribute(
    "href",
    /google\.com\/maps/,
  );
  const trades = page.getByRole("heading", { name: "Trades" }).locator("xpath=ancestor::section");
  await expect(trades).toContainText("Mason");
  const staff = page.getByRole("table", { name: "Staff on Falcon Villas" });
  await expect(staff.getByRole("row")).toHaveCount(3);
  await expect(staff.getByRole("link", { name: "Anil Kumar" })).toHaveAttribute(
    "href",
    "/workers?worker=EMP-0142",
  );
  await page.getByLabel("Search staff").fill("bikash");
  await expect(staff.getByRole("row")).toHaveCount(2);
  await page.getByLabel("Search staff").fill("zzz");
  await expect(page.getByText("No one matches")).toBeVisible();
});

test("older projects flow into this project's needs, with a summary table", async ({ page }) => {
  await open(page);
  const card = page
    .getByRole("heading", { name: "Who can move here" })
    .locator("xpath=ancestor::section");
  await expect(card.getByText("Older projects and the bench")).toBeVisible();
  await expect(card.getByText(/RAK-07 needs, from/)).toBeVisible();
  await expect(card.getByRole("table", { name: "Staffing summary by trade" })).toBeVisible();
  await expect(card.getByRole("link", { name: /Open the full forecast/ })).toHaveAttribute(
    "href",
    "/projects/RAK-07/forecast",
  );
});

test("projects in the list open their overview", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockProjects(page);
  await page.route(/\/api\/projects\/[A-Z0-9-]+\/overview$/, (route) =>
    route.fulfill({ json: OVERVIEW }),
  );
  await page.goto("/projects");
  await page
    .getByRole("link", { name: /overview$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/[A-Z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Falcon Villas");
});

test("an unknown project and a server error each say so", async ({ page }) => {
  await open(page, { missing: true });
  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("a failed load shows the reason and a Retry", async ({ page }) => {
  await open(page, { fail: true });
  await expect(page.getByText("The server had a problem.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("the MD sees it all and no deploy button", async ({ page }) => {
  await open(page, { user: CEO_USER });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Falcon Villas");
  await expect(page.getByRole("link", { name: "Deploy people" })).toHaveCount(0);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`project overview · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      test("the page", async ({ page }) => {
        await open(page);
        await expect(page.getByRole("table", { name: "Staffing summary by trade" })).toBeVisible();
        await page.waitForTimeout(600);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `e2e/screenshots/project-overview-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });
    });
  }
}
