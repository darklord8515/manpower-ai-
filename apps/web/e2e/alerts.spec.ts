import { expect, test, type Page } from "@playwright/test";
import { mockAlerts, type AlertsOptions } from "./alerts-fixtures";
import { CEO_USER, INSIGHTS, haveSession, mockApi, mockProjects } from "./fixtures";

/** The Action Center with the API mocked: what the screens do with the answers they get. */

type User = typeof CEO_USER;

async function open(page: Page, options: AlertsOptions = {}, user?: User, path = "/todo") {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  const fake = await mockAlerts(page, options);
  await page.goto(path);
  return fake;
}

const rows = (page: Page) => page.locator("li[data-alert]");
const row = (page: Page, start: string) => rows(page).filter({ hasText: start });
const title = (page: Page, start: string) =>
  page.getByRole("button", { name: new RegExp(`^${start}`) });
const sheet = (page: Page) => page.getByRole("dialog");
const bell = (page: Page, n: number) =>
  page.getByRole("button", { name: `Alerts: ${n} need${n === 1 ? "s" : ""} attention` });

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

test("To-do is in the sidebar and lists every open alert, the most urgent first", async ({
  page,
}) => {
  await open(page, {}, undefined, "/");
  await page.getByRole("link", { name: "To-do" }).first().click();
  await expect(page).toHaveURL(/\/todo/);
  await expect(page.getByText("9 need attention, 3 for information")).toBeVisible();
  await expect(page.getByText("Detectors last ran at 09:00 on 5 Nov 2026.")).toBeVisible();
  await expect(rows(page)).toHaveCount(12);
  await expect(rows(page).nth(0)).toContainText("Harish Mondal");
  await expect(rows(page).nth(1)).toContainText("Sanjeev Rana");
  await expect(row(page, "SR-2026-0001")).toContainText("Escalated to HR Manager");
  for (const label of ["Open · 12", "All · 12", "Critical · 2", "Action needed · 7", "Info · 3"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
});

test("the bell shows how many need attention and the five most urgent, and opens one", async ({
  page,
}) => {
  await open(page, {}, undefined, "/");
  await bell(page, 9).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(6); // five alerts and "Open To-do"
  await expect(menu.getByText("Detectors last ran at 09:00 on 5 Nov 2026.")).toBeVisible();
  await menu.getByRole("menuitem", { name: /Sanjeev Rana/ }).click();
  await expect(page).toHaveURL(/\/todo\?alert=alert-doc-2/);
  await expect(sheet(page).getByText("EMP-0088").first()).toBeVisible();
});

test("an alert opens with its explanation, the facts behind it, the action and the history", async ({
  page,
}) => {
  await open(page);
  await title(page, "Sanjeev Rana").click();
  await expect(page).toHaveURL(/\?alert=alert-doc-2/);
  const s = sheet(page);
  await expect(
    s.getByText(/The residency visa of Sanjeev Rana \(EMP-0088\) ends in 7 days/),
  ).toBeVisible();
  const facts = s.getByRole("table", { name: "Facts behind this alert" });
  await expect(facts.getByRole("row", { name: /Ends on 12 Nov 2026/ })).toBeVisible();
  await expect(facts.getByRole("row", { name: /Days left 7/ })).toBeVisible();
  await expect(s.getByRole("link", { name: "Open worker" })).toHaveAttribute(
    "href",
    "/workers?worker=EMP-0088",
  );
  await expect(s.getByRole("region", { name: "History" })).toContainText("Raised");
  await expect(s.getByText("Critical").first()).toBeVisible();
});

test("Esc closes the alert and puts the focus back on its row", async ({ page }) => {
  await open(page);
  await title(page, "Sanjeev Rana").click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(title(page, "Sanjeev Rana")).toBeFocused();
  await expect(page).not.toHaveURL(/\?alert=/);
});

test("taking an alert makes it yours and shows it in the list", async ({ page }) => {
  const fake = await open(page);
  await title(page, "Sanjeev Rana").click();
  await sheet(page).getByRole("button", { name: "Take it" }).click();
  await expect(sheet(page).getByText("You took this alert.")).toBeVisible();
  await expect(sheet(page).getByText("You are working on this.")).toBeVisible();
  expect(fake.seen.actions.at(-1)?.action).toBe("take");
  await page.keyboard.press("Escape");
  await expect(row(page, "Sanjeev Rana")).toContainText("In progress");
  await expect(row(page, "Sanjeev Rana")).toContainText("Noura Demo");
  await page.getByLabel("Assigned to me").check();
  await expect(rows(page)).toHaveCount(1);
});

test("an alert can be given to someone else", async ({ page }) => {
  await open(page);
  await title(page, "Sanjeev Rana").click();
  await sheet(page).getByRole("button", { name: "Assign", exact: true }).click();
  const form = sheet(page).getByRole("form", { name: "Assign this alert" });
  await expect(form.getByRole("button", { name: "Assign" })).toBeDisabled();
  await form.getByLabel("Assign to").selectOption({ label: "Priya Demo · HR Executive" });
  await form.getByRole("button", { name: "Assign" }).click();
  await expect(sheet(page).getByText("Assigned to Priya Demo.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "Sanjeev Rana")).toContainText("Priya Demo");
});

test("a critical alert can be snoozed for a day at most, and the counts follow", async ({
  page,
}) => {
  await open(page);
  await expect(bell(page, 9)).toBeVisible();
  await title(page, "Sanjeev Rana").click();
  await sheet(page).getByRole("button", { name: "Snooze", exact: true }).click();
  const panel = sheet(page).getByRole("group", { name: "Snooze until" });
  await expect(panel.getByRole("button", { name: "4 hours" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Tomorrow 07:00" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "3 days" })).toHaveCount(0); // too long for critical
  await expect(panel.getByLabel("Or pick a day")).toHaveCount(0);
  await panel.getByRole("button", { name: "4 hours" }).click();
  await expect(sheet(page).getByText("Snoozed until 5 Nov 2026.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "Sanjeev Rana")).toHaveCount(0); // gone from the open list
  await expect(page.getByRole("button", { name: "Critical · 1" })).toBeVisible();
  await expect(bell(page, 8)).toBeVisible(); // the bell followed, without a reload
  await page.getByRole("button", { name: "Snoozed · 1" }).click();
  await expect(row(page, "Sanjeev Rana")).toContainText("Snoozed until 5 Nov 2026");
});

test("a lesser alert can be snoozed to a day of your choice, up to a week", async ({ page }) => {
  await open(page);
  await title(page, "Tariq Zaman").click();
  await sheet(page).getByRole("button", { name: "Snooze", exact: true }).click();
  const panel = sheet(page).getByRole("group", { name: "Snooze until" });
  await expect(panel.getByRole("button", { name: "3 days" })).toBeVisible();
  const day = panel.getByLabel("Or pick a day");
  await expect(day).toHaveAttribute("max", "2026-11-12");
  await day.fill("2026-11-10");
  await panel.getByRole("button", { name: "Snooze until 10 Nov 2026" }).click();
  await expect(sheet(page).getByText("Snoozed until 10 Nov 2026.")).toBeVisible();
});

test("dismissing needs a reason of 10 characters, and the alert moves to Cleared", async ({
  page,
}) => {
  const fake = await open(page);
  await title(page, "Aamir Lama").click();
  await sheet(page).getByRole("button", { name: "Dismiss", exact: true }).click();
  const form = sheet(page).getByRole("form", { name: "Dismiss this alert" });
  const submit = form.getByRole("button", { name: "Dismiss alert" });
  await form.getByLabel("Why is this being dismissed?").fill("too short");
  await expect(form.getByText("9 of 10 characters")).toBeVisible();
  await expect(submit).toBeDisabled();
  await form.getByLabel("Why is this being dismissed?").fill("Renewal already in progress");
  await submit.click();
  await expect(sheet(page).getByText("Dismissed.")).toBeVisible();
  await expect(
    sheet(page).getByText(/Dismissed on 5 Nov 2026: Renewal already in progress/),
  ).toBeVisible();
  expect(fake.seen.actions.at(-1)).toMatchObject({ action: "dismiss" });
  await page.keyboard.press("Escape");
  await expect(row(page, "Aamir Lama")).toHaveCount(0);
  await page.getByRole("button", { name: "Cleared" }).click();
  await expect(row(page, "Aamir Lama")).toContainText("Dismissed");
});

test("an alert that clears by itself can only be snoozed, not dismissed", async ({ page }) => {
  await open(page);
  await title(page, "MOB-2026-0107").click();
  await expect(sheet(page).getByRole("button", { name: "Snooze", exact: true })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
  await expect(sheet(page).getByRole("link", { name: "Open mobilization" })).toHaveAttribute(
    "href",
    "/mobilization?mob=MOB-2026-0107",
  );
});

test("alerts can be filtered by severity, type, project and words, and the filters cleared", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Critical · 2" }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "All · 12" }).click();
  await page.getByLabel("Filter by type").selectOption("mobilization_stuck");
  await expect(rows(page)).toHaveCount(3);
  await page.getByLabel("Filter by type").selectOption("");
  await page.getByLabel("Filter by project").selectOption("RAK-07");
  await expect(rows(page)).toHaveCount(1);
  await page.getByLabel("Filter by project").selectOption("");
  await page.getByLabel("Search alerts").fill("nobody by this name");
  await expect(page.getByText("No alerts match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(12);
});

test("several alerts can be snoozed or assigned at once", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Info · 3" }).click();
  await page.getByLabel("Select: Aamir Lama").check();
  await page.getByLabel("Select: RAK-01 Site 2").check();
  const bulk = page.getByRole("region", { name: "Bulk actions" });
  await expect(bulk.getByText("2 selected")).toBeVisible();
  await bulk.getByRole("button", { name: "Snooze", exact: true }).click();
  await bulk.getByRole("button", { name: "4 hours" }).click();
  await expect(page.getByText("Snoozed until 5 Nov 2026 (2 alerts).")).toBeVisible();
  await expect(rows(page)).toHaveCount(1);

  await page.getByLabel("Select every alert in the list").check();
  await bulk.getByRole("button", { name: "Assign", exact: true }).click();
  await bulk.getByLabel("Assign to").selectOption({ label: "Priya Demo · HR Executive" });
  await bulk.getByRole("button", { name: "Assign", exact: true }).last().click();
  await expect(page.getByText("Assigned to Priya Demo (1 alert).")).toBeVisible();
});

test("the MD/CEO sees every alert, with no way to change one", async ({ page }) => {
  await open(page, { canAct: false }, CEO_USER);
  await expect(rows(page)).toHaveCount(12);
  await expect(page.getByLabel("Select every alert in the list")).toHaveCount(0);
  await expect(page.getByLabel("Assigned to me")).toHaveCount(0);
  await expect(bell(page, 9)).toBeVisible();
  await title(page, "Sanjeev Rana").click();
  await expect(sheet(page).getByText("Only HR works on alerts.")).toBeVisible();
  await expect(
    sheet(page).getByRole("button", { name: /Take it|Assign|Snooze|Dismiss/ }),
  ).toHaveCount(0);
  await expect(sheet(page).getByRole("link", { name: "Open worker" })).toBeVisible();
});

test("with nothing open the list says so and when the detectors last ran", async ({ page }) => {
  await open(page, { empty: true });
  await expect(page.getByText("No open alerts")).toBeVisible();
  await expect(page.getByText("Detectors last ran at 09:00 on 5 Nov 2026.").last()).toBeVisible();
  await expect(bell(page, 0)).toBeVisible();
});

test("a failed list shows the reason and a Retry", async ({ page }) => {
  await open(page, { failList: true });
  await expect(page.getByText("Couldn’t load the alerts")).toBeVisible();
  await expect(page.getByText("The alert list is unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("an alert that cannot be opened shows the reason and a Retry", async ({ page }) => {
  await open(page, { failDetail: true });
  await title(page, "Sanjeev Rana").click();
  await expect(sheet(page).getByText("The alert could not be opened.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a link with ?alert= opens that alert straight away", async ({ page }) => {
  await open(page, {}, undefined, "/todo?alert=alert-short");
  await expect(sheet(page).getByText(/Shamal Logistics Hub needs 12 general labour/)).toBeVisible();
  await expect(sheet(page).getByRole("link", { name: "Open forecast" })).toHaveAttribute(
    "href",
    "/projects/RAK-07/forecast",
  );
});

test("an alert's action links open the other screen with the person, request or checklist already chosen", async ({
  page,
}) => {
  // The other screens' data is not what is tested here, only that they keep what the link carried.
  await page.route(/\/api\/(workers|requests|mobilizations)/, (route) =>
    route.fulfill({ status: 500, json: { detail: "Not part of this test." } }),
  );
  const links = [
    { alert: "alert-doc-2", link: "Open worker", url: "/workers?worker=EMP-0088" },
    { alert: "alert-approval", link: "Open Allocation", url: "/requests?request=SR-2026-0001" },
    { alert: "alert-mob-7", link: "Open mobilization", url: "/mobilization?mob=MOB-2026-0107" },
  ];
  for (const { alert, link, url } of links) {
    await open(page, {}, undefined, `/todo?alert=${alert}`);
    await sheet(page).getByRole("link", { name: link }).click();
    await expect(page).toHaveURL(new RegExp(url.replace("?", "\\?")));
    // The address is pushed first; a screen that read the old address then rewrote it. Wait that out.
    await page.waitForTimeout(700);
    expect(page.url()).toContain(url);
  }
});

test("the HR Home starts with the Action Center and the insight from the API", async ({ page }) => {
  await open(page, {}, undefined, "/");
  const widget = page.locator('[data-widget="action_center"]');
  await expect(page.getByText(INSIGHTS.hr)).toBeVisible();
  await expect(widget).toBeVisible();
  await expect(widget.getByRole("link", { name: "Critical: 2" })).toHaveAttribute(
    "href",
    "/todo?severity=critical",
  );
  await expect(widget.getByRole("link", { name: "Action needed: 7" })).toBeVisible();
  await expect(widget.getByRole("link", { name: /Harish Mondal/ })).toHaveAttribute(
    "href",
    "/todo?alert=alert-doc-1",
  );
  await expect(widget.getByRole("link", { name: "Open To-do" })).toHaveAttribute("href", "/todo");
  expect(await widget.evaluate((el) => el.parentElement?.firstElementChild === el)).toBe(true); // first
});

test("the MD/CEO's Home counts the alerts by severity and opens the read-only list", async ({
  page,
}) => {
  await open(page, { canAct: false }, CEO_USER, "/");
  const tile = page.locator('[data-widget="alert_counts"]');
  await expect(tile.getByRole("link", { name: "Critical: 2" })).toBeVisible();
  await expect(tile.getByRole("link", { name: "Action needed: 7" })).toBeVisible();
  await tile.getByRole("link", { name: "Critical: 2" }).click();
  await expect(page).toHaveURL(/\/todo\?severity=critical/);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Critical · 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("HR can change a project's dates, and the sheet says when they make no sense", async ({
  page,
}) => {
  await open(page, {}, undefined, "/projects");
  await page.getByRole("button", { name: "Change dates of RAK-07" }).click();
  const s = sheet(page);
  await expect(s.getByRole("button", { name: "Save dates" })).toBeDisabled(); // nothing changed
  await s.getByLabel("Ends").fill("2027-01-01");
  await expect(s.getByRole("alert")).toContainText(
    "The end date must not be before the start date.",
  );
  await expect(s.getByRole("button", { name: "Save dates" })).toBeDisabled();
  await s.getByLabel("Ends").fill("2028-01-31");
  const sent = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith("/api/projects/RAK-07"),
  );
  await s.getByRole("button", { name: "Save dates" }).click();
  expect((await sent).postDataJSON()).toEqual({ ends_on: "2028-01-31" }); // only what changed
  await expect(page.getByText("RAK-07 now runs from 12 Feb 2027 to 31 Jan 2028.")).toBeVisible();
});

test("at 390px the list wraps, the bell fits and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(rows(page)).toHaveCount(12);
  await noSidewaysScroll(page);
  await bell(page, 9).click();
  const menu = await page.getByRole("menu").boundingBox();
  expect(menu && menu.x >= 0 && menu.x + menu.width <= 390).toBe(true);
  await page.keyboard.press("Escape");
  await title(page, "Sanjeev Rana").click();
  await expect(sheet(page).getByRole("table", { name: "Facts behind this alert" })).toBeVisible();
  await noSidewaysScroll(page);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`alerts · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("the list, an alert, a bulk snooze, the bell and both Homes", async ({ page }) => {
        const shot = (name: string, fullPage = true) =>
          page.screenshot({
            path: `e2e/screenshots/alerts-${name}-${viewport.name}-${theme}.png`,
            fullPage,
          });

        await open(page);
        await expect(rows(page)).toHaveCount(12);
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await shot("list");

        await title(page, "Sanjeev Rana").click();
        await expect(
          sheet(page).getByRole("table", { name: "Facts behind this alert" }),
        ).toBeVisible();
        await page.waitForTimeout(300);
        await shot("alert", false);
        await page.keyboard.press("Escape");

        await page.getByRole("button", { name: "Info · 3" }).click();
        await page.getByLabel("Select: Aamir Lama").check();
        await page.getByLabel("Select: RAK-01 Site 2").check();
        await page
          .getByRole("region", { name: "Bulk actions" })
          .getByRole("button", { name: "Snooze", exact: true })
          .click();
        await page.waitForTimeout(300);
        await shot("bulk");

        await page.goto("/");
        await expect(page.locator('[data-widget="action_center"]')).toBeVisible();
        await bell(page, 9).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await page.waitForTimeout(300);
        await shot("bell", false);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await shot("home");
      });

      test("the MD/CEO's Home and the read-only list", async ({ page }) => {
        const shot = (name: string) =>
          page.screenshot({
            path: `e2e/screenshots/alerts-${name}-${viewport.name}-${theme}.png`,
            fullPage: true,
          });
        await open(page, { canAct: false }, CEO_USER, "/");
        await expect(page.locator('[data-widget="alert_counts"]')).toBeVisible();
        await page.waitForTimeout(500);
        await shot("home-ceo");
        await page.goto("/todo");
        await expect(rows(page)).toHaveCount(12);
        await page.waitForTimeout(300);
        await shot("list-ceo");
      });
    });
  }
}
