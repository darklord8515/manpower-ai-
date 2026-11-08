import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, WORKER_DETAIL, haveSession, mockApi, mockWorkers } from "./fixtures";

/** HR edits a worker from the profile sheet, with the API mocked. */

async function open(page: Page, options: { fail?: string; user?: typeof CEO_USER } = {}) {
  await haveSession(page);
  await mockApi(page, options.user ? { user: options.user } : {});
  await mockWorkers(page);
  await page.route("**/api/trades", (route) =>
    route.fulfill({ json: [{ name: "Mason" }, { name: "Painter" }, { name: "Steel fixer" }] }),
  );
  const sent: unknown[] = [];
  // Registered last, so it answers first: a save is a PATCH, everything else goes on to the mock above.
  await page.route(/\/api\/workers\/EMP-0088(\/documents\/\w+)?$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    sent.push(route.request().postDataJSON());
    if (options.fail) return route.fulfill({ status: 422, json: { detail: options.fail } });
    return route.fulfill({ json: WORKER_DETAIL });
  });
  await page.goto("/workers?worker=EMP-0088");
  return sent;
}

const sheet = (page: Page) => page.getByRole("dialog");

test("HR edits a worker: the form saves only what changed and says so", async ({ page }) => {
  const sent = await open(page);
  await sheet(page).getByRole("button", { name: "Edit details" }).click();
  const save = sheet(page).getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await sheet(page).getByLabel("Designation").fill("Foreman");
  await expect(sheet(page).getByText("1 change")).toBeVisible();
  await save.click();
  await expect(sheet(page).getByRole("status")).toContainText("details were saved");
  expect(sent).toEqual([{ designation: "Foreman" }]);
});

test("a refused change shows the reason and keeps the form open", async ({ page }) => {
  await open(page, { fail: "Enter a phone number such as +971 50 123 4567" });
  await sheet(page).getByRole("button", { name: "Edit details" }).click();
  await sheet(page).getByLabel("Phone").fill("call me");
  await sheet(page).getByRole("button", { name: "Save changes" }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("Enter a phone number");
  await expect(sheet(page).getByLabel("Phone")).toHaveValue("call me");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
});

test("a document date can be corrected from the Documents tab", async ({ page }) => {
  const sent = await open(page);
  await sheet(page)
    .getByRole("button", { name: /Documents/ })
    .click();
  await sheet(page).getByRole("button", { name: "Change date" }).first().click();
  await sheet(page)
    .getByLabel(/expires on/)
    .fill("2028-02-01");
  await sheet(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet(page).getByText(/runs out on 1 Feb 2028/)).toBeVisible();
  expect(sent).toEqual([{ expiry_date: "2028-02-01" }]);
});

test("the MD sees the profile but no way to edit it", async ({ page }) => {
  await open(page, { user: CEO_USER });
  await expect(sheet(page).getByRole("button", { name: "Documents" }).first()).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Edit details" })).toHaveCount(0);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`edit worker · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      test("the edit form", async ({ page }) => {
        await open(page);
        await sheet(page).getByRole("button", { name: "Edit details" }).click();
        await sheet(page).getByLabel("Designation").fill("Foreman");
        await page.waitForTimeout(400);
        await page.screenshot({
          path: `e2e/screenshots/worker-edit-${viewport.name}-${theme}.png`,
        });
      });
    });
  }
}
