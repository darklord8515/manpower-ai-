import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, haveSession, mockApi, mockProjects } from "./fixtures";

/** Projects, adding a project, and the manpower forecast, with the API mocked. */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function open(page: Page, path = "/projects", user?: typeof CEO_USER) {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  await page.goto(path);
}

const rows = (page: Page) => page.locator("table tbody tr");

test("Projects is in the sidebar and lists every project with its status", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockProjects(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByText("7 projects, 1 in planning")).toBeVisible();
  await expect(rows(page).filter({ hasText: "RAK-07" }).getByText("Planning")).toBeVisible();
  await expect(rows(page).filter({ hasText: "RAK-03" }).getByText("8 short")).toBeVisible();
});

test("a project's forecast opens from its row", async ({ page }) => {
  await open(page);
  await rows(page).filter({ hasText: "RAK-07" }).getByRole("link", { name: "Forecast" }).click();
  await expect(page).toHaveURL(/\/projects\/RAK-07\/forecast$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Falcon Villas");
});

test("the forecast says what to do for each trade, in words made from the numbers", async ({
  page,
}) => {
  await open(page, "/projects/RAK-07/forecast");
  const labour = page.getByRole("region", { name: "General labour" });
  await expect(labour.getByText("Recruit 1", { exact: true })).toBeVisible();
  await expect(
    labour.getByText(
      /Recruit 1: locally by 13 Jan 2027, or overseas by 14 Dec 2026, or wait for 1 who finishes within 14 days of the start\./,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Covered, but 8 still depend on other projects finishing by 5 Feb 2027."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Steel fixer" }).getByText("Covered", { exact: true }),
  ).toBeVisible();
});

test("the people behind a trade are listed, with who could join late", async ({ page }) => {
  await open(page, "/projects/RAK-07/forecast");
  const labour = page.getByRole("region", { name: "General labour" });
  await labour.getByRole("button", { name: "Show people" }).click();
  await expect(labour.getByRole("heading", { name: "Free now (2)" })).toBeVisible();
  await expect(labour.getByText(/depends on RAK-05 finishing by 5 Feb 2027/)).toBeVisible();
  await expect(labour.getByRole("heading", { name: "Could join late (1)" })).toBeVisible();
  await expect(labour.getByText("14 d after the start")).toBeVisible();
  await expect(labour.getByText("Residency visa ends 9 Mar 2027")).toBeVisible();
  await expect(labour.getByRole("heading", { name: "On the way (1)" })).toBeVisible();
  await expect(labour.getByText("arrives 2 Mar 2027, 18 d after the start")).toBeVisible();
  await expect(labour.getByText("Contract ends 15 Mar 2027")).toBeVisible();
  await labour.getByRole("button", { name: "Hide people" }).click();
  await expect(labour.getByText("Free now (2)")).toHaveCount(0);
});

test("a what-if start date asks again, and goes back to the project's own date", async ({
  page,
}) => {
  await open(page, "/projects/RAK-07/forecast");
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/forecast")) asked.push(new URL(r.url()).search);
  });
  await page.getByLabel("What if it starts on").fill("2027-03-01");
  await expect(page).toHaveURL(/start=2027-03-01/);
  await expect.poll(() => asked.some((s) => s.includes("start=2027-03-01"))).toBe(true);
  await page.getByRole("button", { name: "Back to project start" }).click();
  await expect(page).not.toHaveURL(/start=/);
  await expect(page.getByLabel("What if it starts on")).toHaveValue("2027-02-12");
});

test("adding a project: mistakes are explained, then the forecast opens", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add project" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(sheet.getByText("Give the project a name of at least 3 characters.")).toBeVisible();
  await expect(sheet.getByText("Choose a start and an end date.")).toBeVisible();
  await expect(sheet.getByText("Choose a trade.")).toBeVisible();
  await expect(sheet.getByLabel("Project name")).toBeFocused();

  await sheet.getByLabel("Project name").fill("Al Hamra Marina Towers");
  await sheet.getByLabel("Starts").fill("2027-04-01");
  await sheet.getByLabel("Ends").fill("2028-03-31");
  await sheet.getByLabel("Trade 1", { exact: true }).selectOption("mason");
  await sheet.getByLabel("How many 1").fill("12");
  await sheet.getByRole("button", { name: "Add a trade" }).click();
  await sheet.getByLabel("Trade 2", { exact: true }).selectOption("carpenter");
  await sheet.getByLabel("How many 2").fill("6");
  await sheet.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/projects\/RAK-08\/forecast/);
  await expect(page.getByText("RAK-08 was added. Here is who could work on it.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("RAK-08");
});

test("a trade can only be chosen once, and a row can be removed", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add project" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Trade 1", { exact: true }).selectOption("mason");
  await sheet.getByRole("button", { name: "Add a trade" }).click();
  await expect(
    sheet.getByLabel("Trade 2", { exact: true }).locator('option[value="mason"]'),
  ).toBeDisabled();
  await sheet.getByRole("button", { name: "Remove trade 2" }).click();
  await expect(sheet.getByLabel("Trade 2", { exact: true })).toHaveCount(0);
});

test("Esc closes the form and the work in it is not kept for next time", async ({ page }) => {
  await open(page);
  const add = page.getByRole("button", { name: "Add project" });
  await add.click();
  await page.getByRole("dialog").getByLabel("Project name").fill("Half typed");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(add).toBeFocused();
  await add.click();
  await expect(page.getByRole("dialog").getByLabel("Project name")).toHaveValue("");
});

test("the server's reason is shown if saving fails", async ({ page }) => {
  await open(page);
  await page.route(/\/api\/projects$/, (r) =>
    r.request().method() === "POST"
      ? r.fulfill({
          status: 422,
          json: {
            detail: [{ msg: "Value error, A trade's dates must sit inside the project's dates." }],
          },
        })
      : r.fallback(),
  );
  await page.getByRole("button", { name: "Add project" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Project name").fill("Marina Towers");
  await sheet.getByLabel("Starts").fill("2027-04-01");
  await sheet.getByLabel("Ends").fill("2028-03-31");
  await sheet.getByLabel("Trade 1", { exact: true }).selectOption("mason");
  await sheet.getByLabel("How many 1").fill("3");
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(sheet.getByRole("alert")).toContainText(
    "A trade's dates must sit inside the project's dates.",
  );
  await expect(sheet.getByRole("button", { name: "Create project" })).toBeEnabled();
});

test("the MD/CEO sees projects and forecasts but cannot add a project", async ({ page }) => {
  await open(page, "/projects", CEO_USER);
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forecast" }).first()).toBeVisible();
});

test("an unknown project says so, and a failed forecast can be retried", async ({ page }) => {
  await open(page, "/projects/NOPE-99/forecast");
  await page.route(/\/api\/projects\/NOPE-99\/forecast/, (r) =>
    r.fulfill({ status: 404, json: { detail: "Project not found" } }),
  );
  await page.reload();
  await expect(page.getByText("Project not found").first()).toBeVisible();

  let failing = true;
  await page.route(/\/api\/projects\/RAK-07\/forecast/, (r) =>
    failing
      ? r.fulfill({ status: 500, json: { detail: "The server had a problem." } })
      : r.fallback(),
  );
  await page.goto("/projects/RAK-07/forecast");
  await expect(page.getByText("The server had a problem.")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("region", { name: "Mason" })).toBeVisible();
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`projects · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("list, add form and forecast", async ({ page }) => {
        await open(page);
        await expect(page.getByText("Falcon Villas").locator("visible=true").first()).toBeVisible();
        await page.waitForTimeout(500);
        await noSidewaysScroll(page);
        await page.screenshot({ path: `e2e/screenshots/projects-${viewport.name}-${theme}.png` });

        await page.getByRole("button", { name: "Add project" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.getByRole("dialog").getByRole("button", { name: "Create project" }).click();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/project-add-${viewport.name}-${theme}.png`,
        });
        await page.keyboard.press("Escape");

        await page.goto("/projects/RAK-07/forecast");
        await page
          .getByRole("region", { name: "General labour" })
          .getByRole("button", { name: "Show people" })
          .click();
        await expect(page.getByText("Could join late (1)")).toBeVisible();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/forecast-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });
    });
  }
}
