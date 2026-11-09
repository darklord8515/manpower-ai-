import { expect, test, type Page } from "@playwright/test";
import { mockChat } from "./chat-fixtures";
import { HR_USER, haveSession, mockApi, mockProjects } from "./fixtures";

/** The floating chat button: on every page except Virtual HR's own, opens the drawer. */

async function open(page: Page, path: string, permissions?: string[]) {
  await haveSession(page);
  // The same person, with only the permissions given (a role without AI access).
  await mockApi(page, permissions ? { user: { ...HR_USER, permissions } } : {});
  await mockProjects(page);
  await mockChat(page, {});
  await page.goto(path);
  await expect(page.locator("#main")).toBeVisible();
}

const launcher = (page: Page) => page.getByRole("button", { name: "Chat with Virtual HR" });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Virtual HR" });

test("the button shows on Home and Projects, opens the drawer, and Esc brings the page back", async ({
  page,
}) => {
  await open(page, "/");
  await expect(launcher(page)).toBeVisible();
  await launcher(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(launcher(page)).toBeHidden(); // not on top of the open drawer
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(launcher(page)).toBeVisible();
  await page.goto("/projects");
  await expect(launcher(page)).toBeVisible();
});

test("it can be reached and used by keyboard", async ({ page }) => {
  await open(page, "/");
  await launcher(page).focus();
  await expect(launcher(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer(page)).toBeVisible();
});

test("it is not on the Virtual HR page, where the chat is already open", async ({ page }) => {
  await open(page, "/assistant");
  await expect(launcher(page)).toHaveCount(0);
});

test("without access to the assistant there is no button", async ({ page }) => {
  await open(page, "/", ["project:read", "employee:read"]);
  await expect(launcher(page)).toHaveCount(0);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`launcher · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      test("Home with the button", async ({ page }) => {
        await open(page, "/");
        await expect(launcher(page)).toBeVisible();
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `e2e/screenshots/launcher-${viewport.name}-${theme}.png`,
        });
      });
    });
  }
}
