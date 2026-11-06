import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, haveSession, HR_USER, mockApi, SUMMARY } from "./fixtures";

/**
 * Sign-in, the app shell and Home, with the API mocked so the checks are fast and exact.
 * (e2e/live.spec.ts runs the same flows against a real API and the seeded database.)
 */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test.describe("sign-in", () => {
  test("a visitor with no session is sent to the sign-in page", async ({ page }) => {
    await mockApi(page, { user: null });
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(heading(page)).toHaveText("Sign in");
  });

  test("the page they asked for is remembered", async ({ page }) => {
    await mockApi(page, { user: null });
    await page.goto("/somewhere?x=1");
    await expect(page).toHaveURL(/\/login\?next=%2Fsomewhere%3Fx%3D1$/);
  });

  test("signing in lands on Home with the greeting", async ({ page }) => {
    await mockApi(page, { user: null });
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({
        json: HR_USER,
        headers: { "set-cookie": "cq_session=abc; Path=/; HttpOnly; SameSite=Lax" },
      }),
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill("noura.demo@constructiq.test");
    await page.getByLabel("Password", { exact: true }).fill("a-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page)).toContainText(/Good (morning|afternoon|evening), Noura/);
  });

  test("a wrong password gets a plain message and keeps the email", async ({ page }) => {
    await mockApi(page, { user: null });
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 401, json: { detail: "Email or password is not right" } }),
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill("noura.demo@constructiq.test");
    await page.getByLabel("Password", { exact: true }).fill("wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Email or password is not right." }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("noura.demo@constructiq.test");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  });

  test("a lock-out shows how long to wait", async ({ page }) => {
    await mockApi(page, { user: null });
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({
        status: 429,
        json: { detail: "Too many attempts. Try again later." },
        headers: { "retry-after": "600" },
      }),
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.test");
    await page.getByLabel("Password", { exact: true }).fill("x");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/Try again in 10:0\d/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  });

  test("demo accounts appear only when the server says so", async ({ page }) => {
    await mockApi(page, { user: null, demo: true });
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /HR Executive/ })).toBeVisible();
    const other = await page.context().newPage();
    await mockApi(other, { user: null, demo: false });
    await other.goto("/login");
    await expect(other.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(other.getByText("Demo accounts")).toHaveCount(0);
  });

  test("it works by keyboard: Tab through, Enter submits", async ({ page }) => {
    await mockApi(page, { user: null });
    let sent = 0;
    await page.route("**/api/auth/login", (route) => {
      sent += 1;
      return route.fulfill({ status: 401, json: { detail: "Email or password is not right" } });
    });
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeFocused(); // autofocus
    await page.keyboard.type("a@b.test");
    await page.keyboard.press("Tab");
    await page.keyboard.type("secret");
    await page.keyboard.press("Enter");
    await expect.poll(() => sent).toBe(1);
  });
});

test.describe("the app", () => {
  test.beforeEach(async ({ page }) => {
    await haveSession(page);
  });

  test("Home shows the numbers, the charts and the documents to deal with", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(heading(page)).toContainText("Noura");
    await expect(page.locator('section[aria-label="Deployed"] b').first()).toHaveText("112");
    await expect(page.getByText("of 150")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documents running out" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Documents running out per week/ })).toBeVisible();
    await expect(page.getByText("Sanjeev Rana").first()).toBeVisible();
    await expect(page.getByText("Expired 11 d ago").first()).toBeVisible();
    // Only screens that exist are in the sidebar.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
      "Home",
      "Workers",
      "Projects",
    ]);
  });

  test("the MD/CEO gets their own Home", async ({ page }) => {
    await mockApi(page, { user: CEO_USER });
    await page.goto("/");
    await expect(heading(page)).toContainText("Layla");
    await expect(page.locator('section[aria-label="People short"]')).toBeVisible();
    await expect(page.locator('section[aria-label="People short"] b').first()).toHaveText(
      String(SUMMARY.short_total),
    );
  });

  for (const [utc, word] of [
    ["2026-11-05T03:30:00Z", "morning"],
    ["2026-11-05T09:00:00Z", "afternoon"],
    ["2026-11-05T14:30:00Z", "evening"],
  ] as const) {
    test(`at ${utc} (Dubai time) the greeting and picture are for the ${word}`, async ({
      page,
    }) => {
      await mockApi(page);
      await page.clock.setFixedTime(new Date(utc));
      await page.goto("/");
      await expect(heading(page)).toHaveText(`Good ${word}, Noura`);
      await expect(page.locator(`img[src*="${word}.webp"]`).first()).toBeVisible();
    });
  }

  test("a session that ended sends the person to sign in again, with a reason", async ({
    page,
  }) => {
    await mockApi(page);
    await page.route("**/api/summary", (route) =>
      route.fulfill({ status: 401, json: { detail: "Sign in to continue" } }),
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\/login\?reason=expired/);
    await expect(page.getByRole("status")).toContainText("Your session ended");
  });

  test("the API being down shows an error with a Retry that works", async ({ page }) => {
    await mockApi(page);
    let up = false;
    await page.route("**/api/summary", (route) =>
      up
        ? route.fulfill({ json: SUMMARY })
        : route.fulfill({ status: 503, json: { detail: "The database is not answering." } }),
    );
    await page.goto("/");
    await expect(
      page.getByRole("alert").filter({ hasText: "The database is not answering." }),
    ).toBeVisible();
    up = true;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator('section[aria-label="Deployed"] b').first()).toHaveText("112");
  });

  test("signing out goes to the sign-in page", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 204 }));
    await page.goto("/");
    await page.getByRole("button", { name: /Account menu for Noura Demo/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?reason=signed-out/);
    await expect(page.getByRole("status")).toContainText("signed out");
  });

  test("the account menu opens by keyboard and Esc closes it", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /Account menu/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Dark" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Dark" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("demo tools only show in demo mode", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await expect(page.getByText("Demo tools (for the presenter)")).toBeVisible();
    await page.getByRole("menuitemradio", { name: "Preview evening" }).click();
    await expect(heading(page)).toContainText("Good evening");
  });
});

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`screens · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("sign-in", async ({ page }) => {
        await mockApi(page, { user: null, demo: true });
        await page.goto("/login");
        await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
        await noSidewaysScroll(page);
        await page.screenshot({ path: `e2e/screenshots/login-${viewport.name}-${theme}.png` });
      });

      test("Home (HR)", async ({ page }) => {
        await haveSession(page);
        await mockApi(page);
        await page.goto("/");
        await expect(page.locator('section[aria-label="Deployed"] b').first()).toHaveText("112");
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/home-hr-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });

      test("Home (MD/CEO)", async ({ page }) => {
        await haveSession(page);
        await mockApi(page, { user: CEO_USER });
        await page.goto("/");
        await expect(page.locator('section[aria-label="People short"]')).toBeVisible();
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/home-ceo-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });
    });
  }
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the menu is a drawer that closes with Esc or a link", async ({ page }) => {
    await haveSession(page);
    await mockApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link", { name: "Home" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });
});
