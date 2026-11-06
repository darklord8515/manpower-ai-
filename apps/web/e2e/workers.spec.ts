import { expect, test, type Page } from "@playwright/test";
import { haveSession, mockApi, mockWorkers } from "./fixtures";

/** The Workers screen with the API mocked. (live.spec.ts runs it against the seeded database.) */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function open(page: Page) {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  await page.goto("/workers");
  await expect(page.getByRole("heading", { level: 1, name: "Workers" })).toBeVisible();
}

const rows = (page: Page) => page.locator("table tbody tr");

test("Workers is in the sidebar and lists the first page with the total", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Workers" }).first().click();
  await expect(page).toHaveURL(/\/workers$/);
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByText("30 people")).toBeVisible();
  await expect(page.getByText("Showing 1–25 of 30")).toBeVisible();
});

test("paging, the status tabs and search narrow the list, and the address bar follows", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole("button", { name: /^Available/ }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page).toHaveURL(/status=available/);
  await expect(page).not.toHaveURL(/page=/); // a new filter starts again from page 1
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search workers").fill("khan");
  await expect(rows(page)).toHaveCount(2);
  await expect(page).toHaveURL(/q=khan/);
  await page.getByLabel("Search workers").fill("zzzz");
  await expect(page.getByText("No one matches")).toBeVisible();
});

test("the profile opens from a row, names the document problem, and Esc closes it", async ({
  page,
}) => {
  await open(page);
  const opener = page.getByRole("table").getByRole("button", { name: /Sanjeev Rana/ });
  await opener.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/before the job on RAK-01 ends/)).toBeVisible();
  await expect(page).toHaveURL(/worker=EMP-0088/);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).not.toHaveURL(/worker=/);
});

test("document numbers stay masked until the eye is pressed", async ({ page }) => {
  await open(page);
  await page
    .getByRole("table")
    .getByRole("button", { name: /Sanjeev Rana/ })
    .click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /^Documents/ }).click();
  await expect(sheet.getByText("•••• 7711")).toBeVisible();
  await expect(sheet.getByText("784-1988-1234567-1")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Show emirates id number" }).click();
  await expect(sheet.getByText("784-1988-1234567-1")).toBeVisible();
  await sheet.getByRole("button", { name: "Hide emirates id number" }).click();
  await expect(sheet.getByText("784-1988-1234567-1")).toHaveCount(0);
});

test("a shared link opens the profile straight away", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  await page.goto("/workers?worker=EMP-0088&status=deployed");
  await expect(page.getByRole("dialog").getByText(/before the job on RAK-01 ends/)).toBeVisible();
});

test("the CSV download points at the API with the current view", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Available/ }).click();
  await expect(page.getByRole("link", { name: /Download CSV/ })).toHaveAttribute(
    "href",
    /\/api\/workers\/export\.csv\?.*status=available/,
  );
});

test("a failed list shows the reason, and Retry loads it", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  let failing = true;
  await page.route(/\/api\/workers\?/, (route) =>
    failing
      ? route.fulfill({ status: 500, json: { detail: "The server had a problem." } })
      : route.fallback(),
  );
  await page.goto("/workers");
  await expect(page.getByText("The server had a problem.")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(rows(page)).toHaveCount(25);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`workers · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("directory and profile", async ({ page }) => {
        await open(page);
        await expect(rows(page)).toHaveCount(25);
        await page.waitForTimeout(500); // let the rows finish fading in
        await noSidewaysScroll(page);
        await page.screenshot({ path: `e2e/screenshots/workers-${viewport.name}-${theme}.png` });
        const opener =
          viewport.width < 640
            ? page.locator("ul button", { hasText: "Sanjeev Rana" })
            : page.getByRole("table").getByRole("button", { name: /Sanjeev Rana/ });
        await opener.click();
        await expect(page.getByRole("dialog").getByText(/before the job/)).toBeVisible();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/worker-profile-${viewport.name}-${theme}.png`,
        });
      });
    });
  }
}
