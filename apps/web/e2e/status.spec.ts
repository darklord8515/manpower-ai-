import { expect, test, type Page } from "@playwright/test";

/**
 * The "definition of done" harness: every screen is captured at 1440 and 390, light and dark,
 * and checked for horizontal overflow. API calls are mocked so the shots are deterministic.
 * Screenshots land in e2e/screenshots (git-ignored) for review against docs/design-direction.md.
 */
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const THEMES = ["light", "dark"] as const;
const HEALTHY = { status: "ok", db: "ok", env: "local" };

async function mockHealth(page: Page, mode: "ok" | "degraded" | "down" | "slow") {
  await page.route("**/health", async (route) => {
    if (mode === "down") return route.abort("connectionrefused");
    if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 6000));
    if (mode === "degraded") {
      return route.fulfill({
        status: 503,
        json: { status: "degraded", db: "down", env: "local" },
      });
    }
    return route.fulfill({ json: HEALTHY });
  });
}

/** Next.js adds its own hidden role="alert" route announcer, so target ours by its text. */
function apiErrorAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: "API unreachable" });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`status page · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("healthy state", async ({ page }) => {
        await mockHealth(page, "ok");
        await page.goto("/status");
        await expect(page.getByText("Connected")).toBeVisible();
        await expect(page.getByRole("img", { name: "Alhamra" })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: `e2e/screenshots/status-${viewport.name}-${theme}.png` });
      });
    });
  }
}

test.describe("other states (1440 light and 390 dark)", () => {
  test("loading skeleton", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHealth(page, "slow");
    await page.goto("/status");
    await expect(page.getByLabel("Checking the API")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/status-loading-1440-light.png" });
  });

  test("error state offers a retry", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await mockHealth(page, "down");
    await page.goto("/status");
    await expect(apiErrorAlert(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "e2e/screenshots/status-error-390-dark.png" });
    await context.close();
  });

  test("degraded database is a warning, not an error", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHealth(page, "degraded");
    await page.goto("/status");
    await expect(page.getByText("Unreachable")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/status-degraded-1440-light.png" });
  });
});

test.describe("interaction", () => {
  test("the theme toggle switches, persists across reload, and works by keyboard", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHealth(page, "ok");
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/status");

    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lightBackground = await background();

    await page.keyboard.press("Tab");
    const toggle = page.getByRole("button", { name: /light and dark/i });
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background()).not.toBe(lightBackground);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("retry recovers once the API answers", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let healthy = false;
    await page.route("**/health", (route) =>
      healthy ? route.fulfill({ json: HEALTHY }) : route.abort("connectionrefused"),
    );
    await page.goto("/status");
    await expect(apiErrorAlert(page)).toBeVisible();
    healthy = true;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Connected")).toBeVisible();
  });
});
