import { expect, test, type Page } from "@playwright/test";
import { HR_USER, haveSession, mockApi, mockDocuments, mockWorkers } from "./fixtures";

/** The Documents screen with the API mocked. (live.spec.ts runs it against the seeded database.) */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function open(page: Page, path = "/documents", user?: typeof HR_USER, waitForPage = true) {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockWorkers(page);
  const asked = await mockDocuments(page);
  await page.goto(path);
  // An open profile hides the rest of the page from assistive technology, so there is no heading to wait for.
  if (waitForPage)
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
  return asked;
}

const rows = (page: Page) => page.locator("table tbody tr");
const tab = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("Documents is in the sidebar and opens on the next 30 days, with a count on every tab", async ({
  page,
}) => {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  await mockDocuments(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Documents" }).first().click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(rows(page)).toHaveCount(3);
  await expect(tab(page, /^Expired · 2$/)).toBeVisible();
  await expect(tab(page, /^Next 30 days · 3$/)).toBeVisible();
  await expect(tab(page, /^31–60 days · 2$/)).toBeVisible();
  await expect(tab(page, /^61–90 days · 1$/)).toBeVisible();
  await expect(page.getByText("2 expired, 3 running out in 30 days")).toBeVisible();
});

test("a document that ends before the person's job says so, the others do not", async ({
  page,
}) => {
  await open(page);
  const sanjeev = rows(page).filter({ hasText: "Sanjeev Rana" });
  await expect(sanjeev.getByText("31 Aug 2027")).toBeVisible();
  await expect(sanjeev.getByText("ends before the job")).toBeVisible();
  await expect(
    rows(page).filter({ hasText: "Omar Khan" }).getByText("Not on a project"),
  ).toBeVisible();
  await expect(
    rows(page).filter({ hasText: "Omar Khan" }).getByText("ends before the job"),
  ).toHaveCount(0);
});

test("each tab shows its own rows and the address bar follows", async ({ page }) => {
  await open(page);
  await tab(page, /^Expired/).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Farhan Khan");
  await expect(rows(page).first().getByText("Expired 11 d ago")).toBeVisible();
  await expect(page).toHaveURL(/window=expired/);
  await tab(page, /^61–90 days/).click();
  await expect(rows(page)).toHaveCount(1);
  await tab(page, /^Next 30 days/).click();
  await expect(page).not.toHaveURL(/window=/); // the default view needs nothing in the address
});

test("the tab counts follow the filters, so a tab never promises hidden rows", async ({ page }) => {
  await open(page);
  await page.getByLabel("Document", { exact: true }).selectOption("residency_visa");
  await expect(tab(page, /^Expired · 0$/)).toBeVisible();
  await expect(tab(page, /^Next 30 days · 2$/)).toBeVisible();
  await expect(tab(page, /^31–60 days · 1$/)).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await page.getByLabel("Project", { exact: true }).selectOption("RAK-01");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Sanjeev Rana");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(3);
});

test("search waits for a pause, and a search with no result offers a way back", async ({
  page,
}) => {
  const asked = await open(page);
  asked.length = 0;
  await page.getByLabel("Search workers").fill("zzzz");
  await expect(page.getByText("No documents match")).toBeVisible();
  expect(asked.filter((a) => a.includes("q=zzzz"))).toHaveLength(1);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(rows(page)).toHaveCount(3);
});

test("a tab with nothing in it says so in plain words", async ({ page }) => {
  await open(page);
  await page.getByLabel("Document", { exact: true }).selectOption("passport");
  await expect(page.getByText("No documents match")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(rows(page)).toHaveCount(3);
});

test("ticked rows copy their phone numbers", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.getByLabel("Select row EMP-0088:residency_visa").check();
  await page.getByLabel("Select row EMP-0521:medical_fitness").check();
  await page.getByRole("button", { name: "Copy phone numbers" }).click();
  await expect(page.getByText("Copied 2 phone numbers.")).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    "+971 50 088 1000\n+971 50 521 1000",
  );
});

test("the worker's profile opens on its Documents tab, and Esc closes it", async ({ page }) => {
  await open(page);
  const opener = rows(page)
    .filter({ hasText: "Sanjeev Rana" })
    .getByRole("button", { name: /Sanjeev Rana/ });
  await opener.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: /^Documents/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sheet.getByText("•••• 7711")).toBeVisible(); // the number stays masked
  await expect(page).toHaveURL(/worker=EMP-0088/);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test("a shared link opens the same view and the same profile", async ({ page }) => {
  await open(page, "/documents?window=expired&worker=EMP-0088", undefined, false);
  // The profile is open, so the page behind it is hidden from role queries: use a plain selector.
  await expect(page.locator('button[aria-pressed="true"]', { hasText: /^Expired/ })).toHaveCount(1);
  await expect(page.getByRole("dialog").getByRole("button", { name: /^Documents/ })).toBeVisible();
});

test("the download carries the current tab and filters", async ({ page }) => {
  await open(page);
  await tab(page, /^Expired/).click();
  await page.getByLabel("Document", { exact: true }).selectOption("medical_fitness");
  await expect(page.getByRole("link", { name: /Download CSV/ })).toHaveAttribute(
    "href",
    /\/api\/documents\/export\.csv\?.*window=expired.*type=medical_fitness/,
  );
});

test("a failed load shows the reason and Retry works", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  await mockDocuments(page);
  let failing = true;
  await page.route(/\/api\/documents\/expiring/, (r) =>
    failing
      ? r.fulfill({ status: 500, json: { detail: "The server had a problem." } })
      : r.fallback(),
  );
  await page.goto("/documents");
  await expect(page.getByText("The server had a problem.")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(rows(page)).toHaveCount(3);
});

test("people without document access do not see the link", async ({ page }) => {
  const logistics = {
    ...HR_USER,
    permissions: ["employee:read", "project:read"],
    roles: ["logistics_coordinator"],
  };
  await haveSession(page);
  await mockApi(page, { user: logistics });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Documents" }),
  ).toHaveCount(0);
});

test("the Home widget links to the full list", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockWorkers(page);
  await mockDocuments(page);
  await page.goto("/");
  await page.locator('[data-widget="due"]').getByRole("link", { name: "See all" }).click();
  await expect(page).toHaveURL(/\/documents$/);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`documents · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("list and profile", async ({ page }) => {
        await open(page);
        await expect(page.getByText("Sanjeev Rana").locator("visible=true").first()).toBeVisible();
        await page.waitForTimeout(500);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/documents-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
        const opener =
          viewport.width < 640
            ? page.locator("ul button", { hasText: "Sanjeev Rana" })
            : rows(page)
                .filter({ hasText: "Sanjeev Rana" })
                .getByRole("button", { name: /Sanjeev Rana/ });
        await opener.first().click();
        await expect(page.getByRole("dialog").getByText("•••• 7711")).toBeVisible();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/documents-profile-${viewport.name}-${theme}.png`,
        });
      });
    });
  }
}
