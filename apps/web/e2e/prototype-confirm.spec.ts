import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Every risky action in the prototype first says what happens, who is told and whether it can be undone. */
const PROTOTYPE = pathToFileURL(path.resolve(__dirname, "../../../prototype/index.html")).href;

async function open(page: Page, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(PROTOTYPE);
  await page.evaluate(() => {
    // @ts-expect-error prototype globals
    setRole("hr_manager", true);
  });
}
const go = (page: Page, where: string, req?: string) =>
  page.evaluate(
    ([p, r]) => {
      // @ts-expect-error prototype globals
      goto(p, r);
    },
    [where, req ?? null] as const,
  );

const dialog = (page: Page) => page.getByRole("alertdialog");

async function expectConsequences(page: Page) {
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByText("What happens")).toBeVisible();
  await expect(d.getByText("Who is told")).toBeVisible();
  await expect(d.getByText("Can it be undone?")).toBeVisible();
}

test("Approve asks first, Cancel has focus, Esc cancels, and confirming approves", async ({
  page,
}) => {
  await open(page);
  await go(page, "allocation", "SR-2026-0042");
  const approve = page.getByRole("button", { name: /^Approve 8 workers$/ });
  await approve.click();
  await expectConsequences(page);
  await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(approve).toBeVisible(); // nothing was approved
  await expect(approve).toBeFocused(); // focus returns to the button

  await approve.click();
  await dialog(page).getByRole("button", { name: "Approve 8 people" }).click();
  await expect(page.getByText(/Approved by .* on /)).toBeVisible();
});

test("Hold people asks first and only acts after confirming", async ({ page }) => {
  await open(page);
  await go(page, "forecast");
  await page.locator('[data-fc-reserve="Steel fixer"]').click();
  await page.locator('[data-fc-reserve-confirm="Steel fixer"]').click();
  await expectConsequences(page);
  await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".src b", { hasText: /^Held ·/ })).toHaveCount(0);

  await page.locator('[data-fc-reserve-confirm="Steel fixer"]').click();
  await dialog(page)
    .getByRole("button", { name: /^Hold \d+ people$/ })
    .click();
  await expect(page.locator(".src b", { hasText: /^Held ·/ })).toHaveCount(1);
});

test("Ask recruitment asks first; the confirm button has focus because it can be repeated safely", async ({
  page,
}) => {
  await open(page);
  await go(page, "forecast");
  await page.locator('[data-fc-recruit="Mason"]').click();
  await page.locator('[data-fc-recruit-confirm="Mason"]').click();
  await expectConsequences(page);
  await expect(dialog(page).getByRole("button", { name: "Send to recruitment" })).toBeFocused();
  await dialog(page).getByRole("button", { name: "Send to recruitment" }).click();
  await expect(page.locator(".src b", { hasText: /^Hiring ·/ })).toHaveCount(1);
});

test("Not a problem: the dialog sits above the open to-do and Esc closes only the dialog", async ({
  page,
}) => {
  await open(page);
  const id = await page.evaluate(() => {
    // @ts-expect-error prototype globals
    return state.alerts.find((a) => a.type === "upcoming_shortfall").id as string;
  });
  await page.evaluate((a) => {
    // @ts-expect-error prototype globals
    openAlert(a);
  }, id);
  const sheet = page.getByRole("dialog", { name: "To-do item" });
  await sheet.getByRole("button", { name: "Not a problem" }).click();
  await sheet
    .getByLabel(/Why is this not a problem/)
    .fill("Recruitment is already hiring for these.");
  await sheet.getByRole("button", { name: "Mark as not a problem" }).click();
  await expectConsequences(page);
  await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(sheet).toBeVisible(); // the to-do is still open underneath

  await sheet.getByRole("button", { name: "Mark as not a problem" }).click();
  await dialog(page).getByRole("button", { name: "Mark as not a problem" }).click();
  await expect(sheet.getByText("Marked as not a problem").first()).toBeVisible();
});

test("the dialog fits a 390px phone", async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  await go(page, "allocation", "SR-2026-0042");
  await page.getByRole("button", { name: /^Approve 8 workers$/ }).click();
  const box = await dialog(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});
