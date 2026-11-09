import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, EXEC_USER, haveSession, mockApi, mockProjects } from "./fixtures";
import { mockMobilizations, type MobilizationOptions } from "./mobilization-fixtures";

/** The Mobilization screen with the API mocked: what the screen does with the answers it gets. */

type User = typeof CEO_USER;

async function open(
  page: Page,
  options: MobilizationOptions = {},
  user?: User,
  path = "/mobilization",
) {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  const fake = await mockMobilizations(page, options);
  await page.goto(path);
  return fake;
}

const card = (page: Page, no: string) => page.locator(`button[data-mob="${no}"]`);
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const sheet = (page: Page) => page.getByRole("dialog");
const task = (page: Page, title: string) => sheet(page).locator(`li[data-task="${title}"]`);

const DOCS = "Verify residency visa and medical fitness";

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

test("Mobilization is in the sidebar and shows everyone in their stage", async ({ page }) => {
  await haveSession(page);
  await mockApi(page);
  await mockProjects(page);
  await mockMobilizations(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Mobilization" }).first().click();
  await expect(page).toHaveURL(/\/mobilization/);

  await expect(page.getByText("9 people being mobilized, 2 with an overdue task")).toBeVisible();
  await expect(column(page, "Pending checklist").locator("button[data-mob]")).toHaveCount(1);
  await expect(column(page, "In progress").locator("button[data-mob]")).toHaveCount(6);
  await expect(column(page, "Ready to report").locator("button[data-mob]")).toHaveCount(2);
  await expect(column(page, "On site").locator("button[data-mob]")).toHaveCount(0);
  await expect(column(page, "On site").getByText("Nobody has arrived recently.")).toBeVisible();
  await expect(column(page, "In progress").getByLabel("6 people")).toBeVisible();

  const stuck = card(page, "MOB-2026-0107");
  await expect(stuck).toContainText("Girish Nair");
  await expect(stuck).toContainText("1 overdue");
  await expect(stuck).toContainText("1 of 3 tasks done");
  await expect(stuck).toContainText("Reports 8 Nov 2026");
  await expect(card(page, "MOB-2026-0105")).not.toContainText("overdue");
});

test("a card opens the checklist by department, with what is overdue and who did what", async ({
  page,
}) => {
  await open(page);
  await card(page, "MOB-2026-0107").click();
  await expect(sheet(page).getByRole("heading", { name: "Girish Nair" })).toBeVisible();
  await expect(page).toHaveURL(/\?mob=MOB-2026-0107/);
  await expect(sheet(page).getByText("MOB-2026-0107")).toBeVisible();
  for (const department of ["Human Resources", "Site workforce"]) {
    await expect(sheet(page).getByRole("region", { name: department })).toBeVisible();
  }
  await expect(task(page, DOCS)).toContainText("Due 1 Nov 2026");
  await expect(task(page, DOCS)).toContainText("Overdue");
  await expect(task(page, "Issue PPE")).toContainText("Done by Noura Demo, 4 Nov 2026");
  await expect(task(page, "Site induction")).toContainText("Due 8 Nov 2026");
  await expect(task(page, "Site induction")).not.toContainText("Overdue");
  await expect(sheet(page).getByText("1 of 3 tasks done, 1 overdue")).toBeVisible();
});

test("Esc closes the checklist and puts the focus back on the card", async ({ page }) => {
  await open(page);
  await card(page, "MOB-2026-0107").click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(card(page, "MOB-2026-0107")).toBeFocused();
  await expect(page).not.toHaveURL(/\?mob=/);
});

test("a card can be opened from the keyboard", async ({ page }) => {
  await open(page);
  await card(page, "MOB-2026-0109").focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("heading", { name: "Ismail Qadir" })).toBeVisible();
});

test("a link with ?mob= opens that checklist straight away", async ({ page }) => {
  await open(page, {}, undefined, "/mobilization?mob=MOB-2026-0107");
  await expect(sheet(page).getByRole("heading", { name: "Girish Nair" })).toBeVisible();
});

test("marking a task done updates the checklist and moves the card", async ({ page }) => {
  const fake = await open(page);
  await expect(
    column(page, "Pending checklist").locator(`button[data-mob="MOB-2026-0109"]`),
  ).toBeVisible();
  await card(page, "MOB-2026-0109").click();
  await sheet(page)
    .getByRole("button", { name: `Mark done: ${DOCS}` })
    .click();
  await expect(sheet(page).getByText(`${DOCS} is done.`)).toBeVisible();
  await expect(task(page, DOCS)).toContainText("Done by Noura Demo");
  await expect(sheet(page).getByText("1 of 3 tasks done")).toBeVisible();
  expect(fake.seen.ticks).toEqual([{ mob: "MOB-2026-0109", task: DOCS, action: "done" }]);
  await page.keyboard.press("Escape");
  await expect(
    column(page, "In progress").locator(`button[data-mob="MOB-2026-0109"]`),
  ).toBeVisible();
  await expect(column(page, "Pending checklist").locator("button[data-mob]")).toHaveCount(0);
  await expect(page.getByText("9 people being mobilized, 1 with an overdue task")).toBeVisible();
});

test("a done task can be opened again", async ({ page }) => {
  await open(page);
  await card(page, "MOB-2026-0106").click();
  await sheet(page)
    .getByRole("button", { name: `Reopen ${DOCS}` })
    .click();
  await expect(sheet(page).getByText(`${DOCS} is open again.`)).toBeVisible();
  await expect(task(page, DOCS)).toContainText("Due 1 Nov 2026");
  await page.keyboard.press("Escape");
  await expect(
    column(page, "Pending checklist").locator(`button[data-mob="MOB-2026-0106"]`),
  ).toBeVisible();
});

test("when the server refuses a change, the sheet says why and nothing moves", async ({ page }) => {
  await open(page, { refuseTicks: "MOB-2026-0109 is completed." });
  await card(page, "MOB-2026-0109").click();
  await sheet(page)
    .getByRole("button", { name: `Mark done: ${DOCS}` })
    .click();
  await expect(sheet(page).getByRole("alert")).toContainText("MOB-2026-0109 is completed.");
  await expect(sheet(page).getByText("0 of 3 tasks done")).toBeVisible();
});

test("arrival cannot be confirmed before the report day, and the sheet says when", async ({
  page,
}) => {
  await open(page);
  await card(page, "MOB-2026-0101").click();
  await expect(
    sheet(page).getByText("Reports on 8 Nov 2026. Arrival can be confirmed from that day."),
  ).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Confirm arrival" })).toBeDisabled();
});

test("arrival waits for the checklist, and says how many tasks are open", async ({ page }) => {
  await open(page, { today: "2026-11-08" });
  await card(page, "MOB-2026-0103").click();
  await expect(
    sheet(page).getByText("Finish the checklist first: 1 task is still open."),
  ).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Confirm arrival" })).toBeDisabled();
});

test("confirming arrival makes the person arrive and moves the card to On site", async ({
  page,
}) => {
  const fake = await open(page, { today: "2026-11-08" });
  await card(page, "MOB-2026-0101").click();
  const confirm = sheet(page).getByRole("button", { name: "Confirm arrival" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(sheet(page).getByText("Arrival confirmed.")).toBeVisible();
  await expect(sheet(page).getByText("Aamir Siddiqui arrived on 8 Nov 2026.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Confirm arrival" })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /Reopen|Mark done/ })).toHaveCount(0);
  expect(fake.seen.arrivals).toEqual(["MOB-2026-0101"]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Aamir Siddiqui arrived and is now Deployed.")).toBeVisible();
  await expect(column(page, "On site").locator(`button[data-mob="MOB-2026-0101"]`)).toContainText(
    "Arrived 8 Nov 2026",
  );
  await expect(column(page, "Ready to report").locator("button[data-mob]")).toHaveCount(1);
});

test("the HR Executive ticks tasks too", async ({ page }) => {
  await open(page, {}, EXEC_USER);
  await card(page, "MOB-2026-0109").click();
  await expect(sheet(page).getByRole("button", { name: `Mark done: ${DOCS}` })).toBeEnabled();
});

test("the MD sees the pipeline and every checklist but cannot change anything", async ({
  page,
}) => {
  await open(page, { canChange: false }, CEO_USER);
  await expect(card(page, "MOB-2026-0107")).toBeVisible();
  await card(page, "MOB-2026-0107").click();
  await expect(sheet(page).getByText("Only HR ticks tasks off.")).toBeVisible();
  await expect(sheet(page).getByText("Only HR confirms arrival.")).toBeVisible();
  await expect(
    sheet(page).getByRole("button", { name: /Mark done|Reopen|Confirm arrival/ }),
  ).toHaveCount(0);
  await expect(task(page, "Issue PPE")).toContainText("Done by Noura Demo");
});

test("the pipeline can be searched and filtered", async ({ page }) => {
  await open(page);
  const cards = page.locator("button[data-mob]");
  await page.getByLabel("Search the pipeline").fill("Girish");
  await expect(cards).toHaveCount(1);
  await expect(card(page, "MOB-2026-0107")).toBeVisible();
  await page.getByLabel("Search the pipeline").fill("");
  await expect(cards).toHaveCount(9);
  await page.getByLabel("Filter by project").selectOption("RAK-03");
  await expect(cards).toHaveCount(3);
  await page.getByLabel("Filter by project").selectOption("");
  await page.getByLabel("Overdue only").check();
  await expect(cards).toHaveCount(2);
  await expect(card(page, "MOB-2026-0107")).toBeVisible();
  await expect(card(page, "MOB-2026-0109")).toBeVisible();
  await page.getByLabel("Search the pipeline").fill("nobody by this name");
  await expect(page.getByText("No one matches these filters")).toBeVisible();
});

test("with nobody being mobilized the screen says so and points to Allocation", async ({
  page,
}) => {
  await open(page, { empty: true });
  await expect(page.getByText("Nobody is being mobilized")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Allocation" })).toHaveAttribute(
    "href",
    "/requests",
  );
});

test("a failed pipeline shows the reason and a Retry", async ({ page }) => {
  await open(page, { failList: true });
  await expect(page.getByText("Couldn’t load the pipeline")).toBeVisible();
  await expect(page.getByText("The pipeline is unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a checklist that cannot be opened shows the reason and a Retry", async ({ page }) => {
  await open(page, { failDetail: true });
  await card(page, "MOB-2026-0107").click();
  await expect(sheet(page).getByText("Couldn’t load")).toBeVisible();
  await expect(sheet(page).getByText("The checklist could not be opened.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Retry" })).toBeVisible();
});

test("at 390px the stages stack, the page does not scroll sideways, and a checklist opens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(card(page, "MOB-2026-0107")).toBeVisible();
  await noSidewaysScroll(page);
  const first = await column(page, "Pending checklist").boundingBox();
  const second = await column(page, "In progress").boundingBox();
  expect(first && second && second.y > first.y + first.height - 1).toBe(true); // stacked, not side by side
  await card(page, "MOB-2026-0107").click();
  await expect(task(page, DOCS)).toContainText("Overdue");
  await noSidewaysScroll(page);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`mobilization · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("board, checklists and arrival", async ({ page }) => {
        const shot = (name: string, fullPage = true) =>
          page.screenshot({
            path: `e2e/screenshots/mobilization-${name}-${viewport.name}-${theme}.png`,
            fullPage,
          });

        await open(page, { today: "2026-11-08" });
        await expect(card(page, "MOB-2026-0107")).toBeVisible();
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await shot("board");

        await card(page, "MOB-2026-0107").click();
        await expect(task(page, DOCS)).toContainText("Overdue");
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await shot("checklist", false);
        await page.keyboard.press("Escape");

        await card(page, "MOB-2026-0101").click();
        await expect(sheet(page).getByRole("button", { name: "Confirm arrival" })).toBeEnabled();
        await page.waitForTimeout(300);
        await shot("ready", false);
        await sheet(page).getByRole("button", { name: "Confirm arrival" }).click();
        await expect(sheet(page).getByText("Aamir Siddiqui arrived on 8 Nov 2026.")).toBeVisible();
        await page.waitForTimeout(300);
        await shot("arrived", false);
        await page.keyboard.press("Escape");
        await expect(column(page, "On site").locator("button[data-mob]")).toHaveCount(1);
        await page.waitForTimeout(300);
        await shot("board-after");
      });
    });
  }
}
