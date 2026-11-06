import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, EXEC_USER, haveSession, mockApi, mockProjects } from "./fixtures";
import { mockRequests, type RequestsOptions } from "./requests-fixtures";

/** The Allocation board with the API mocked: what the screen does with the answers it gets. */

type User = typeof CEO_USER;

async function open(page: Page, options: RequestsOptions = {}, user?: User, path = "/requests") {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  const fake = await mockRequests(page, options);
  await page.goto(path);
  return fake;
}

const card = (page: Page, no: string) => page.locator(`button[data-request="${no}"]`);
const steel = (page: Page) => page.getByRole("region", { name: "Steel fixer line" });
const pool = (page: Page) => page.getByRole("complementary", { name: "Candidate pool" });
const worker = (page: Page, code: string) => page.locator(`li[data-worker="${code}"]`);

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

test("Allocation is in the sidebar and opens the first request with its line, pool and exclusions", async ({
  page,
}) => {
  await haveSession(page);
  await mockApi(page);
  await mockProjects(page);
  await mockRequests(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Allocation" }).first().click();
  await expect(page).toHaveURL(/\/requests/);

  await expect(card(page, "SR-2026-0001")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "SR-2026-0001")).toContainText("7 × Steel fixer");
  await expect(card(page, "SR-2026-0001")).toContainText("Needed from 8 Nov 2026 · High");
  await expect(card(page, "SR-2026-0001")).toContainText("0 of 7 approved");
  await expect(card(page, "SR-2026-0001")).toContainText("Waiting for approval");
  await expect(card(page, "SR-2026-0002")).toContainText("3 × Carpenter");

  await expect(page.getByRole("heading", { name: /SR-2026-0001/ })).toBeVisible();
  await expect(steel(page).getByRole("heading", { name: /Steel fixer/ })).toContainText("× 7");
  await expect(steel(page)).toContainText("Level 2 or higher · 0 of 7 selected");
  await expect(steel(page)).toContainText("7 open slots");

  // The rules' exclusions sit above the workers, each with its plain reason and rule code.
  await expect(steel(page).getByText("Left out by the rules (3)")).toBeVisible();
  await expect(
    steel(page).getByText("Residency visa ends 12 Jan 2027, before 3 Feb 2027").first(),
  ).toBeVisible();
  await expect(steel(page).getByText("ASSIGN_STATUS")).toBeVisible();

  await expect(pool(page).locator("li[data-candidate]")).toHaveCount(10);
});

test("Suggest people fills the line with the rules' picks and says who chose them", async ({
  page,
}) => {
  const fake = await open(page);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(
    page.getByText("7 workers suggested by the rules. Check them, then approve."),
  ).toBeVisible();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
  await expect(steel(page)).toContainText("7 of 7 selected");
  await expect(worker(page, "EMP-0107").getByText("Suggested by the rules")).toBeAttached();
  await expect(worker(page, "EMP-0107")).toContainText("Free now; level 4; documents valid");
  await expect(steel(page).getByRole("button", { name: "Approve 7 workers" })).toBeEnabled();
  // Nothing is left to suggest, and the pool no longer lists the chosen.
  await expect(steel(page).getByRole("button", { name: "Suggest people" })).toHaveCount(0);
  await expect(pool(page).locator("li[data-candidate]")).toHaveCount(3);
  expect(fake.seen.suggested).toBe(1);
});

test("a person can be added from the pool, removed with a reason, and restored", async ({
  page,
}) => {
  const fake = await open(page);
  await pool(page).getByRole("button", { name: "Add Imran Qureshi" }).click();
  await expect(page.getByText("Imran Qureshi was added to the steel fixer line.")).toBeVisible();
  await expect(worker(page, "EMP-0107")).toBeVisible();
  await expect(steel(page)).toContainText("1 of 7 selected");

  await worker(page, "EMP-0107").getByRole("button", { name: "Remove Imran Qureshi" }).click();
  const remove = steel(page).getByRole("button", { name: "Remove 1 worker" });
  await expect(remove).toBeDisabled(); // a reason is required
  const why = steel(page).getByLabel(/Why 1 worker is taken off/);
  await why.fill("No");
  await expect(remove).toBeDisabled();
  await why.fill("Needed on another project");
  await remove.click();

  await expect(page.getByText("Removed 1 worker.")).toBeVisible();
  expect(fake.seen.removed).toEqual([{ code: "EMP-0107", reason: "Needed on another project" }]);
  await expect(steel(page).getByRole("heading", { name: "Removed (1)" })).toBeVisible();
  await expect(steel(page).getByText("Needed on another project")).toBeVisible();

  await steel(page).getByRole("button", { name: "Restore Imran Qureshi" }).click();
  await expect(page.getByText("Imran Qureshi is back on the line.")).toBeVisible();
  await expect(worker(page, "EMP-0107")).toBeVisible();
});

test("Esc closes the remove form without removing anyone", async ({ page }) => {
  await open(page);
  await pool(page).getByRole("button", { name: "Add Imran Qureshi" }).click();
  await worker(page, "EMP-0107").getByRole("button", { name: "Remove Imran Qureshi" }).click();
  const why = steel(page).getByLabel(/Why 1 worker is taken off/);
  await expect(why).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(why).toHaveCount(0);
  await expect(worker(page, "EMP-0107")).toBeVisible();
});

test("several workers can be removed at once with one reason", async ({ page }) => {
  const fake = await open(page);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
  await worker(page, "EMP-0107").getByLabel("Select Imran Qureshi").check();
  await worker(page, "EMP-0112").getByLabel("Select Saleem Akhtar").check();
  await steel(page).getByRole("button", { name: "Remove selected (2)" }).click();
  await steel(page)
    .getByLabel(/Why 2 workers are taken off/)
    .fill("Moving to the carpenter line");
  await steel(page).getByRole("button", { name: "Remove 2 workers" }).click();
  await expect(page.getByText("Removed 2 workers.")).toBeVisible();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(5);
  expect(fake.seen.removed.map((r) => r.code)).toEqual(["EMP-0107", "EMP-0112"]);
});

test("a swap replaces one worker with another, and Esc cancels it", async ({ page }) => {
  await open(page);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);

  await steel(page).getByRole("button", { name: "Swap Imran Qureshi" }).click();
  await expect(
    steel(page).getByText("Choose who takes Imran Qureshi’s place in the pool."),
  ).toBeVisible();
  await expect(pool(page).getByRole("button", { name: "Swap in Ravi Shankar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(steel(page).getByText(/Choose who takes/)).toHaveCount(0);
  await expect(pool(page).getByRole("button", { name: "Add Ravi Shankar" })).toBeDisabled();

  await steel(page).getByRole("button", { name: "Swap Imran Qureshi" }).click();
  await pool(page).getByRole("button", { name: "Swap in Ravi Shankar" }).click();
  await expect(page.getByText("Ravi Shankar replaces Imran Qureshi.")).toBeVisible();
  await expect(worker(page, "EMP-0147")).toBeVisible();
  await expect(worker(page, "EMP-0107")).toHaveCount(0);
  await expect(steel(page).getByText("Swapped for Ravi Shankar")).toBeVisible();
});

test("when the rules refuse a person, the reason shows on that candidate and nothing changes", async ({
  page,
}) => {
  await open(page, {
    refuse: {
      "EMP-0147": [{ rule: "ASSIGN_OVERLAP", message: "Already on RAK-02 until 30 Nov 2026" }],
    },
  });
  await pool(page).getByRole("button", { name: "Add Ravi Shankar" }).click();
  const row = pool(page).locator('li[data-candidate="EMP-0147"]');
  await expect(row.getByRole("alert")).toContainText("Already on RAK-02 until 30 Nov 2026");
  await expect(row.getByRole("alert")).toContainText("ASSIGN_OVERLAP");
  await expect(steel(page)).toContainText("0 of 7 selected");
});

test("a refused swap puts the original worker back", async ({ page }) => {
  await open(page, {
    refuse: { "EMP-0147": [{ rule: "ASSIGN_LEAVE", message: "On leave from 12 Nov 2026" }] },
  });
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
  await steel(page).getByRole("button", { name: "Swap Imran Qureshi" }).click();
  await pool(page).getByRole("button", { name: "Swap in Ravi Shankar" }).click();
  await expect(
    pool(page).locator('li[data-candidate="EMP-0147"]').getByRole("alert"),
  ).toContainText("On leave from 12 Nov 2026");
  await expect(worker(page, "EMP-0107")).toBeVisible();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
});

test("the pool can be searched and narrowed by level and documents", async ({ page }) => {
  await open(page);
  const items = pool(page).locator("li[data-candidate]");
  await pool(page).getByLabel("Search the pool").fill("Ravi");
  await expect(items).toHaveCount(1);
  await pool(page).getByLabel("Search the pool").fill("");
  await expect(items).toHaveCount(10);
  await pool(page).getByLabel("Minimum level").selectOption("4");
  await expect(items).toHaveCount(3);
  await pool(page).getByLabel("Minimum level").selectOption("0");
  await pool(page).getByLabel("Documents valid only").check();
  await expect(items).toHaveCount(9);
  await expect(pool(page).getByText("Documents end first")).toHaveCount(0);
  await pool(page).getByLabel("Search the pool").fill("nobody at all");
  await expect(pool(page).getByText("No one matches these filters.")).toBeVisible();
});

test("the pool shows a loading state while it loads", async ({ page }) => {
  await open(page, { poolDelayMs: 1500 });
  await expect(pool(page).getByLabel("Loading the pool")).toBeVisible();
  await expect(pool(page).locator("li[data-candidate]")).toHaveCount(10);
});

test("approving shows what will happen, then locks the line with the mobilization numbers", async ({
  page,
}) => {
  const fake = await open(page);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
  await steel(page).getByRole("button", { name: "Approve 7 workers" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Approve steel fixer for SR-2026-0001" }),
  ).toBeVisible();
  await expect(dialog.getByText("7 assignments planned, 7 mobilizations started.")).toBeVisible();
  await expect(dialog.getByText("2 depend on another job finishing on time.")).toBeVisible();
  await expect(
    dialog.getByText("The line will be 7 of 7. The request will be filled."),
  ).toBeVisible();
  await expect(dialog.getByText("Becomes Mobilizing now.").first()).toBeVisible();
  expect(fake.seen.approvals.every((a) => a.preview)).toBe(true); // the preview wrote nothing

  await dialog.getByRole("button", { name: "Approve 7 workers" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(
      "Approved 7 workers as steel fixer. 7 mobilizations started (MOB-2026-0001 to MOB-2026-0007).",
    ),
  ).toBeVisible();
  await expect(steel(page)).toContainText("Approved by Noura Demo on 6 Nov 2026");
  await expect(
    steel(page).getByRole("list", { name: "Approved workers" }).locator("li"),
  ).toHaveCount(7);
  await expect(steel(page)).toContainText("MOB-2026-0001");
  await expect(steel(page).getByRole("button", { name: /Approve|Reject/ })).toHaveCount(0);
  await expect(card(page, "SR-2026-0001")).toContainText("Filled");
  await expect(card(page, "SR-2026-0001")).toContainText("7 of 7 approved");
  await expect(pool(page)).toHaveCount(0); // a filled request needs no pool
});

test("Esc closes the approval preview without approving", async ({ page }) => {
  const fake = await open(page);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await steel(page).getByRole("button", { name: "Approve 7 workers" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fake.seen.approvals.some((a) => !a.preview)).toBe(false);
  await expect(steel(page)).toContainText("7 of 7 selected");
});

test("if someone no longer passes the rules, approving says who and why and saves nothing", async ({
  page,
}) => {
  await open(page, {
    blockApprove: [
      { rule: "DOC_VALID_THROUGH", message: "Residency visa ends 12 Jan 2027, before 3 Feb 2027" },
    ],
  });
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await steel(page).getByRole("button", { name: "Approve 7 workers" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Someone no longer passes the rules");
  await expect(
    dialog.getByText("Residency visa ends 12 Jan 2027, before 3 Feb 2027"),
  ).toBeVisible();
  await expect(dialog.getByText("DOC_VALID_THROUGH")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Approve 7 workers" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(steel(page)).toContainText("7 of 7 selected");
});

test("a line with nobody chosen cannot be approved, and says why", async ({ page }) => {
  await open(page);
  await expect(steel(page).getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(steel(page).getByText("Choose at least one worker first.")).toBeVisible();
});

test("a line can be rejected with a reason of at least 10 characters", async ({ page }) => {
  const fake = await open(page);
  await steel(page).getByRole("button", { name: "Reject line" }).click();
  const submit = steel(page)
    .getByRole("form", { name: "Reject the steel fixer line" })
    .getByRole("button", { name: "Reject line" });
  const reason = steel(page).getByLabel("Why is this line rejected?");
  await expect(submit).toBeDisabled();
  await reason.fill("Too short");
  await expect(steel(page).getByText("9 of 10 characters")).toBeVisible();
  await expect(submit).toBeDisabled();
  await reason.fill("Budget not approved yet");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("The steel fixer line was rejected.")).toBeVisible();
  expect(fake.seen.rejected).toEqual(["Budget not approved yet"]);
  await expect(steel(page)).toContainText(
    "Rejected by Noura Demo on 6 Nov 2026: Budget not approved yet",
  );
  await expect(card(page, "SR-2026-0001")).toContainText("Rejected");
});

test("a request can be cancelled with a reason", async ({ page }) => {
  const fake = await open(page);
  await page.getByRole("button", { name: "Cancel request" }).click();
  const confirm = page
    .getByRole("form", { name: "Cancel SR-2026-0001" })
    .getByRole("button", { name: "Cancel request" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Why is SR-2026-0001 cancelled/).fill("The tower was re-planned");
  await confirm.click();
  await expect(page.getByText("SR-2026-0001 was cancelled.")).toBeVisible();
  expect(fake.seen.cancelled).toEqual(["SR-2026-0001"]);
  await expect(card(page, "SR-2026-0001")).toContainText("Cancelled");
  await expect(pool(page)).toHaveCount(0);
});

test("the HR Executive prepares a request but cannot approve it", async ({ page }) => {
  await open(page, { canApprove: false }, EXEC_USER);
  await expect(steel(page).getByText("Approving needs the HR Manager.")).toBeVisible();
  await expect(steel(page).getByRole("button", { name: /Approve|Reject line/ })).toHaveCount(0);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "New request" })).toBeVisible();
});

test("a request you raised yourself says someone else has to approve it", async ({ page }) => {
  await open(page, {
    canApprove: false,
    approveNote: "You raised this request, so someone else has to approve it.",
  });
  await expect(
    steel(page).getByText("You raised this request, so someone else has to approve it."),
  ).toBeVisible();
  await expect(steel(page).getByRole("button", { name: /Approve/ })).toHaveCount(0);
});

test("the MD sees the board to approve, without the pool or the New request button", async ({
  page,
}) => {
  await open(page, {}, CEO_USER);
  await expect(card(page, "SR-2026-0001")).toBeVisible();
  await expect(pool(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New request" })).toHaveCount(0);
  await expect(steel(page).getByRole("button", { name: "Suggest people" })).toHaveCount(0);
  await expect(steel(page).getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
});

test("a new request is checked, sent, and opened on the board", async ({ page }) => {
  const fake = await open(page);
  await page.getByRole("button", { name: "New request" }).click();
  const sheet = page.getByRole("dialog", { name: "New staffing request" });
  await sheet.getByRole("button", { name: "Send request" }).click();
  await expect(sheet.getByText("Choose the project the workers are for.")).toBeVisible();
  await expect(sheet.getByText("Choose the date the workers are needed from.")).toBeVisible();
  await expect(sheet.getByText("Choose a trade.")).toBeVisible();
  await expect(sheet.getByText("Enter a whole number from 1 to 500.")).toBeVisible();

  await sheet.getByLabel("Project").selectOption("RAK-07");
  await expect(sheet.getByLabel("From")).toHaveValue("2027-02-12"); // taken from the project
  await expect(sheet.getByLabel("Until (optional)")).toHaveValue("2027-12-31");
  await sheet.getByLabel("Priority").selectOption("1");
  await sheet.getByLabel("Trade 1", { exact: true }).selectOption("steel_fixer");
  await sheet.getByLabel("How many 1").fill("4");
  await sheet.getByLabel("Minimum level 1").selectOption("3");
  await sheet.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByText("SR-2026-0003 was sent for approval.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /SR-2026-0003/ })).toBeVisible();
  await expect(card(page, "SR-2026-0003")).toHaveAttribute("aria-pressed", "true");
  expect(fake.seen.raised).toEqual([
    {
      project: "RAK-07",
      needed_from: "2027-02-12",
      needed_until: "2027-12-31",
      priority: 1,
      source_text: null,
      lines: [{ trade: "steel_fixer", headcount: 4, min_level: 3 }],
    },
  ]);
});

test("Esc closes the New request sheet", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "New request" }).click();
  await expect(page.getByRole("dialog", { name: "New staffing request" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the arrow keys move between requests and Enter opens one", async ({ page }) => {
  await open(page);
  await card(page, "SR-2026-0001").focus();
  await page.keyboard.press("ArrowRight");
  await expect(card(page, "SR-2026-0002")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page, "SR-2026-0002")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /SR-2026-0002/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Carpenter line" })).toContainText("3 open slots");
  await page.keyboard.press("ArrowLeft");
  await expect(card(page, "SR-2026-0001")).toBeFocused();
});

test("requests can be searched and filtered", async ({ page }) => {
  await open(page);
  await page.getByLabel("Search requests").fill("Khuzam");
  await expect(page.locator("button[data-request]")).toHaveCount(1);
  await expect(card(page, "SR-2026-0002")).toBeVisible();
  await page.getByLabel("Search requests").fill("");
  await expect(page.locator("button[data-request]")).toHaveCount(2);
  await page.getByLabel("Filter by project").selectOption("RAK-03");
  await expect(page.locator("button[data-request]")).toHaveCount(1);
  await page.getByLabel("Filter by status").selectOption("filled");
  await expect(page.getByText("No request matches these filters.")).toBeVisible();
});

test("with no requests the board says so and offers a way to start", async ({ page }) => {
  await open(page, { empty: true });
  await expect(
    page.getByText("No staffing requests yet. Send one to start filling a project."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New request" })).toBeVisible();
});

test("a failed list shows the reason and a Retry", async ({ page }) => {
  await open(page, { failList: true });
  await expect(page.getByText("Couldn’t load requests")).toBeVisible();
  await expect(page.getByText("The request list is unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a request that cannot be opened shows the reason and a Retry", async ({ page }) => {
  await open(page, { failDetail: true });
  await expect(page.getByText("Couldn’t open the request")).toBeVisible();
  await expect(page.getByText("The request could not be opened.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("at 390px the request bar scrolls sideways, the page does not, and workers become cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(card(page, "SR-2026-0001")).toBeVisible();
  const scrolls = await page
    .getByRole("group", { name: "Requests" })
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  await steel(page).getByRole("button", { name: "Suggest people" }).click();
  await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
  await expect(worker(page, "EMP-0107")).toContainText("Documents until");
  await noSidewaysScroll(page);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`allocation · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("board, approval preview, approved line and new request", async ({ page }) => {
        const shot = (name: string, fullPage = true) =>
          page.screenshot({
            path: `e2e/screenshots/requests-${name}-${viewport.name}-${theme}.png`,
            fullPage,
          });

        await open(page);
        await expect(card(page, "SR-2026-0001")).toBeVisible();
        await expect(pool(page).locator("li[data-candidate]")).toHaveCount(10);
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await shot("empty-line");

        await steel(page).getByRole("button", { name: "Suggest people" }).click();
        await expect(steel(page).locator("li[data-worker]")).toHaveCount(7);
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await shot("board");

        await steel(page).getByRole("button", { name: "Approve 7 workers" }).click();
        await expect(page.getByRole("dialog").getByText(/7 assignments planned/)).toBeVisible();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await shot("approve", false);

        await page.getByRole("dialog").getByRole("button", { name: "Approve 7 workers" }).click();
        await expect(steel(page)).toContainText("Approved by Noura Demo");
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await shot("approved");

        await page.getByRole("button", { name: "New request" }).click();
        await expect(page.getByRole("dialog", { name: "New staffing request" })).toBeVisible();
        await page.waitForTimeout(300);
        await shot("new", false);
      });
    });
  }
}
