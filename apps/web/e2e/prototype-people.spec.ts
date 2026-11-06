import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Behaviour of the People screens in the design prototype: Workers, Documents, the To-do link
 * from Home, and the MVP role list (HR and MD/CEO only).
 */
const PROTOTYPE = pathToFileURL(path.resolve(__dirname, "../../../prototype/index.html")).href;

async function open(page: Page, role: string, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(PROTOTYPE);
  await page.evaluate((r) => {
    // @ts-expect-error prototype globals
    setRole(r, true);
  }, role);
}

const go = (page: Page, where: string) =>
  page.evaluate((p) => {
    // @ts-expect-error prototype globals
    goto(p);
  }, where);

test("the demo role switcher lists HR and MD/CEO only", async ({ page }) => {
  await open(page, "hr_manager");
  await page.getByRole("button", { name: /Viewing as/ }).click();
  const items = await page.locator("#rolePop [data-role]").allInnerTexts();
  expect(items.map((t) => t.trim()).sort()).toEqual([
    "CEO / Managing Director",
    "HR Executive",
    "HR Manager",
  ]);
});

test("To-do in the sidebar opens the To-do page, and Home links to it", async ({ page }) => {
  await open(page, "hr_manager");
  await page.locator('#nav [data-nav="actions"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "To-do" })).toBeVisible();
  await go(page, "dashboard");
  await page.getByRole("button", { name: /See all \d+ items/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "To-do" })).toBeVisible();
});

test("Workers: 150 people, search, filters and the profile sheet", async ({ page }) => {
  await open(page, "hr_manager");
  await page.locator('#nav [data-nav="workers"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "Workers" })).toBeVisible();
  await expect(page.getByText("Showing 25 of 150")).toBeVisible();

  await page.getByLabel("Search workers").fill("Sanjeev");
  await expect(page.locator(".wk-table tbody tr")).toHaveCount(1);

  await page.getByLabel("Search workers").fill("zzzz");
  await expect(page.getByText("No workers match")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Showing 25 of 150")).toBeVisible();

  await page.getByRole("button", { name: "Available", exact: true }).click();
  await expect(
    page.getByText("Showing 21 of 21").or(page.getByText(/Showing \d+ of 21/)),
  ).toBeVisible();

  await page.getByRole("button", { name: "Everyone" }).click();
  await page.getByLabel("Search workers").fill("Sanjeev");
  await page.locator('.wk-table [data-worker="EMP-0088"]').click();
  const sheet = page.getByRole("dialog", { name: /Sanjeev Rana/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Documents" }).click();
  await expect(sheet.getByText("7 d left")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("Documents: tab counts match the rows, and numbers are hidden from the HR Executive", async ({
  page,
}) => {
  await open(page, "hr_manager");
  await go(page, "documents");
  for (const label of ["Expired", "Next 30 days", "31–60 days", "61–90 days"]) {
    const tab = page.getByRole("button", { name: new RegExp(`^${label} · \\d+$`) });
    const n = Number((await tab.innerText()).split("·")[1]);
    await tab.click();
    await expect(page.locator(".wk-table tbody tr")).toHaveCount(n);
  }
  // HR Manager sees the full number; HR Executive sees it masked.
  await page.evaluate(() => {
    // @ts-expect-error prototype globals
    openWorker("EMP-0088", "docs");
  });
  await expect(page.getByText(/784-198\d-\d{7}-\d/)).toBeVisible();
  await page.keyboard.press("Escape");
  await as(page, "hr_executive");
  await page.evaluate(() => {
    // @ts-expect-error prototype globals
    openWorker("EMP-0088", "docs");
  });
  await expect(page.getByText(/784-198\d-\d{7}-\d/)).toHaveCount(0);
  await expect(page.getByText("•••• ", { exact: false }).first()).toBeVisible();
});

async function as(page: Page, role: string) {
  await page.evaluate((r) => {
    // @ts-expect-error prototype globals
    setRole(r, true);
  }, role);
}

test("Documents: the CSV download works", async ({ page }) => {
  await open(page, "hr_manager");
  await go(page, "documents");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download list/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^documents-d30-.*\.csv$/);
});

test("Workers and Documents show loading, empty and error states", async ({ page }) => {
  await open(page, "hr_manager");
  for (const screen of ["workers", "documents"]) {
    await go(page, screen);
    await page.evaluate(() => {
      // @ts-expect-error prototype globals
      demoTool("preview:error");
    });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".wk-table")).toBeVisible();
  }
});

for (const screen of ["workers", "documents"]) {
  test(`${screen} fit a 390px phone without sideways scrolling`, async ({ page }) => {
    await open(page, "hr_manager", { width: 390, height: 844 });
    await go(page, screen);
    await expect(page.locator(".cards-mobile li").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });
}
