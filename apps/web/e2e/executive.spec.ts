import { expect, test, type Page } from "@playwright/test";
import { BRIEF, CEO_USER, HR_USER, haveSession, mockApi } from "./fixtures";

/** The MD's Home (projects, HR department, briefing) and HR's briefing, with the API mocked. */

async function open(
  page: Page,
  options: { user?: typeof HR_USER; failBrief?: boolean; slowBrief?: boolean } = {},
) {
  await haveSession(page);
  await mockApi(page, { user: options.user ?? CEO_USER });
  if (options.failBrief || options.slowBrief)
    await page.route("**/api/executive/brief", async (route) => {
      if (options.slowBrief) await new Promise((r) => setTimeout(r, 700));
      if (options.failBrief)
        return route.fulfill({ status: 500, json: { detail: "The server had a problem." } });
      return route.fulfill({ json: { ...BRIEF, ai_worded: true } });
    });
  await page.goto("/");
}

test("the MD sees each project with its health, and the HR department at a glance", async ({
  page,
}) => {
  await open(page);
  const projects = page.getByRole("region", { name: "Projects overview" });
  await expect(projects).toContainText("1 at risk · 1 need people"); // as in the mock
  await expect(projects.getByRole("link", { name: /Marina Waterfront/ })).toContainText("At risk");
  await expect(projects.getByRole("link", { name: /Aila Homes/ })).toContainText("On track");
  await expect(projects.getByRole("link", { name: /Greens/ })).toContainText("Needs people");
  await expect(projects.getByRole("link", { name: /Falcon Villas/ })).toContainText("Planning");
  await expect(projects.getByRole("img", { name: "RAK-03: 18 of 26 people" })).toBeVisible();
  const hr = page.getByRole("region", { name: "HR department overview" });
  await expect(hr).toContainText("18"); // critical + action needed
  await expect(hr).toContainText("Oldest waiting 4 days");
  await expect(hr).toContainText("7 people across 4 requests");
  await expect(
    hr.getByRole("img", { name: "Arrived, pending deployment: 3 people" }),
  ).toBeVisible();
  await projects.getByRole("link", { name: /Greens/ }).click();
  await expect(page).toHaveURL(/\/projects\/RAK-03$/);
});

test("Brief me writes the briefing, says who wrote it, and can write it again", async ({
  page,
}) => {
  await open(page, { slowBrief: true });
  const card = page.getByRole("region", { name: "Briefing" });
  await card.getByRole("button", { name: "Brief me" }).click();
  await expect(card.getByRole("status", { name: "Writing the briefing" })).toBeVisible();
  await expect(card.getByText("112 of 150 people are deployed")).toBeVisible();
  await expect(card).toContainText("Worded by AI and checked against the numbers · 5 Nov 2026");
  await expect(card.getByRole("button", { name: "Write it again" })).toBeVisible();
});

test("a failed briefing shows why and can be tried again", async ({ page }) => {
  await open(page, { failBrief: true });
  const card = page.getByRole("region", { name: "Briefing" });
  await card.getByRole("button", { name: "Brief me" }).click();
  await expect(card.getByRole("alert")).toContainText("The server had a problem.");
  await expect(card.getByRole("button", { name: "Brief me" })).toBeEnabled();
});

test("HR gets the briefing on their Home too, without the MD's sections", async ({ page }) => {
  await open(page, { user: HR_USER });
  await expect(page.getByRole("region", { name: "Briefing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HR department" })).toHaveCount(0);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`MD home · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      test("the page", async ({ page }) => {
        await open(page);
        await page.getByRole("button", { name: "Brief me" }).click();
        await expect(page.getByText("112 of 150 people are deployed")).toBeVisible();
        await page.waitForTimeout(700);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `e2e/screenshots/md-home-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });
    });
  }
}
