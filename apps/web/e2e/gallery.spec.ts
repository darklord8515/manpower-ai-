import { expect, test, type Page } from "@playwright/test";

/**
 * Definition of done for the shared components: every state at 1440 and 390, light and dark, and
 * the behaviour the design rules require (Esc closes the sheet and returns focus, resolving an
 * alert updates every counter, the agent's steps arrive one by one, reduced motion is honoured).
 */
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const THEMES = ["light", "dark"] as const;

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

const kpi = (page: Page, label: string) => page.locator(`section[aria-label="${label}"] b`);

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`gallery · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("every component renders without overflow", async ({ page }) => {
        await page.goto("/gallery");
        await expect(kpi(page, "Deployed")).toHaveText("112"); // count-up finished
        await expect(page.getByRole("list", { name: "Open alerts" })).toBeVisible();
        await noHorizontalOverflow(page);
        await page.screenshot({
          path: `e2e/screenshots/gallery-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });
    });
  }
}

test.describe("behaviour", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("KPI numbers count to new values when the data changes", async ({ page }) => {
    await page.goto("/gallery");
    await expect(kpi(page, "Deployed")).toHaveText("112");
    await page.getByRole("button", { name: "Simulate approval" }).click();
    await expect(kpi(page, "Deployed")).toHaveText("120");
    await expect(kpi(page, "Pending approvals")).toHaveText("2");
    await expect(kpi(page, "Available")).toHaveText("13");
  });

  test("the sheet closes on Esc and focus returns to the alert that opened it", async ({
    page,
  }) => {
    await page.goto("/gallery");
    const opener = page.getByRole("button", { name: /Visa expires in 7 days/ });
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: /Visa expires in 7 days/ });
    await expect(sheet).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/gallery-sheet-1440.png" });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("resolving an alert collapses it and updates the counters", async ({ page }) => {
    await page.goto("/gallery");
    const critical = page.getByTestId("count-critical");
    await expect(critical).toHaveText(/Critical\s*1/);
    await page.getByRole("button", { name: "Mark resolved" }).first().click();
    await expect(page.getByRole("button", { name: /Visa expires in 7 days/ })).toHaveCount(0);
    await expect(critical).toHaveText(/Critical\s*0/);
    await expect(page.getByTestId("count-action")).toHaveText(/Action needed\s*1/);
  });

  test("resolving every alert shows the empty state, and Reset brings them back", async ({
    page,
  }) => {
    await page.goto("/gallery");
    const resolve = page.getByRole("button", { name: "Mark resolved" });
    for (let remaining = 3; remaining > 0; remaining--) {
      // Wait for each card to finish collapsing so a click never lands on one that is leaving.
      await expect(resolve).toHaveCount(remaining);
      await resolve.first().click();
    }
    await expect(page.getByRole("heading", { name: "No open alerts" })).toBeVisible();
    await page.getByRole("button", { name: "Reset alerts" }).click();
    await expect(page.getByRole("button", { name: /Visa expires in 7 days/ })).toBeVisible();
  });

  test("resolving from inside the sheet closes it and updates the list", async ({ page }) => {
    await page.goto("/gallery");
    await page.getByRole("button", { name: /RAK-07 starts 12 Feb 2027/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Mark resolved" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: /RAK-07 starts 12 Feb 2027/ })).toHaveCount(0);
  });

  test("the agent's steps arrive one by one, then the answer, then a collapsed trace", async ({
    page,
  }) => {
    await page.goto("/gallery");
    await page.getByRole("button", { name: "Ask Workforce Agent" }).click();

    const card = page.getByRole("article", { name: /Workforce Agent/ });
    await expect(card.getByText("Workforce Agent is working…")).toBeVisible();
    await expect(card.getByText("Checking visas", { exact: true })).toBeVisible();
    // The answer must not exist yet while steps are still arriving.
    await expect(card.getByText(/8 cleared, 2 excluded for/)).toHaveCount(0);
    await page.screenshot({ path: "e2e/screenshots/gallery-agent-working-1440.png" });

    await expect(card.getByText(/8 cleared, 2 excluded for/)).toBeVisible({ timeout: 8000 });
    await expect(card.getByRole("note")).toContainText("Excluded by the agent (2)");
    await expect(card.getByRole("note")).toContainText("visa expires 12 Jan 2027");
    // Trace collapses after the run and can be reopened.
    await expect(card.getByText("check_documents · 12 workers checked, 2 fail.")).toHaveCount(0);
    await card.getByRole("button", { name: /Trace · 5 steps/ }).click();
    await expect(card.getByText("check_documents · 12 workers checked, 2 fail.")).toBeVisible();
  });

  test("the table sorts, selects, and shows loading, empty and error states", async ({ page }) => {
    await page.goto("/gallery");
    const rows = () =>
      page.getByRole("table", { name: "Available steel fixers" }).locator("tbody tr");
    await expect(rows()).toHaveCount(5);

    await page.getByRole("button", { name: /^Worker/ }).click();
    await expect(rows().first()).toContainText("Anil Kumar");
    await page.getByRole("button", { name: /^Worker/ }).click();
    await expect(rows().first()).toContainText("Suresh Nair");

    await page.getByRole("checkbox", { name: "Select all rows" }).check();
    await expect(page.getByText("5 selected")).toBeVisible();

    await page.getByRole("button", { name: "Loading", exact: true }).click();
    await expect(
      page.getByRole("status", { name: "Loading Available steel fixers" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Empty", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No candidates match these filters" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Error", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "sleeps after 15 minutes" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).first().click();
    await expect(rows()).toHaveCount(5);
  });

  test("the status chip changes its label when the state changes", async ({ page }) => {
    await page.goto("/gallery");
    const demo = page.locator("section[aria-labelledby=chips]");
    await expect(demo.getByText("Open", { exact: true })).toBeVisible();
    await demo.getByRole("button", { name: "Change state" }).click();
    await expect(demo.getByText("In progress", { exact: true })).toBeVisible();
  });
});

test.describe("mobile (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });

  test("the table becomes cards and the sheet fits the screen", async ({ page }) => {
    await page.goto("/gallery");
    await expect(page.getByRole("table", { name: "Available steel fixers" })).toBeHidden();
    await expect(page.getByText("Anil Kumar").last()).toBeVisible();

    await page.getByRole("button", { name: /Visa expires in 7 days/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "e2e/screenshots/gallery-sheet-390-dark.png" });
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("numbers appear at once and the sheet opens without sliding", async ({ page }) => {
    await page.goto("/gallery");
    // No counting: the very first read is already the final value.
    await expect(kpi(page, "Deployed")).toHaveText("112", { timeout: 500 });
    await page.getByRole("button", { name: /Visa expires in 7 days/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
