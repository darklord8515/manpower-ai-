import { expect, test, type Page } from "@playwright/test";
import {
  CEO_USER,
  EXEC_USER,
  haveSession,
  mockApi,
  mockProjects,
  mockRecruitment,
} from "./fixtures";

/** Reserve, release, raise a recruitment request, and move requests along the pipeline (mocked API). */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function open(page: Page, path: string, user?: typeof CEO_USER) {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  const sent = await mockRecruitment(page);
  await page.goto(path);
  return sent;
}

const labour = (page: Page) => page.getByRole("region", { name: "General labour" });
const rows = (page: Page) => page.locator("table tbody tr");

test.describe("on the forecast", () => {
  test("reserving: free people are ticked, late joiners are not, and the answer names each person", async ({
    page,
  }) => {
    const sent = await open(page, "/projects/RAK-07/forecast");
    await labour(page).getByRole("button", { name: "Reserve people" }).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByRole("heading", { name: "Reserve general labour people" }),
    ).toBeVisible();
    await expect(sheet.getByLabel(/Ram Bahadur/)).toBeChecked();
    await expect(sheet.getByLabel(/Naresh Das/)).toBeChecked();
    await expect(sheet.getByLabel(/Tariq Mondal/)).not.toBeChecked(); // could join late
    await expect(sheet.getByText(/You will reserve 4 people\./)).toBeVisible();
    await expect(
      sheet.getByText(/2 start only after they finish on another project/),
    ).toBeVisible();

    await sheet.getByLabel(/Tariq Mondal/).check();
    await expect(sheet.getByText(/1 will start later than 12 Feb 2027/)).toBeVisible();
    await sheet.getByRole("button", { name: /^Reserve 5$/ }).click();
    await expect(sheet.getByText("5 of 5 reserved.")).toBeVisible();
    expect(sent.reserve).toHaveLength(1);
    expect((sent.reserve[0] as { trade: string }).trade).toBe("general_labour");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("a person the server refuses is named with the reason, and the rest are still reserved", async ({
    page,
  }) => {
    await open(page, "/projects/RAK-07/forecast");
    await labour(page).getByRole("button", { name: "Reserve people" }).click();
    const sheet = page.getByRole("dialog");
    // The mocked server refuses EMP-0172, who the forecast lists only under "Not counted".
    await page.route(/\/api\/projects\/RAK-07\/reserve$/, (r) =>
      r.fulfill({
        json: {
          reserved: 1,
          results: [
            {
              code: "EMP-0170",
              name: "Ram Bahadur",
              outcome: "reserved",
              reason: null,
              starts_on: "2027-02-12",
            },
            {
              code: "EMP-0172",
              name: "Gopal Das",
              outcome: "refused",
              reason: "Residency visa ends 9 Mar 2027",
            },
          ],
        },
      }),
    );
    await sheet.getByRole("button", { name: /^Reserve \d+$/ }).click();
    await expect(sheet.getByText("1 of 2 reserved.")).toBeVisible();
    await expect(sheet.getByText("Not reserved: Residency visa ends 9 Mar 2027")).toBeVisible();
    await expect(sheet.getByText(/Reserved from 12 Feb 2027/)).toBeVisible();
  });

  test("a reserved person can be released", async ({ page }) => {
    const sent = await open(page, "/projects/RAK-07/forecast");
    await labour(page).getByRole("button", { name: "Show people" }).click();
    await expect(labour(page).getByRole("heading", { name: "Reserved (1)" })).toBeVisible();
    await expect(labour(page).getByText(/from 12 Feb 2027, after leaving RAK-05/)).toBeVisible();
    await labour(page).getByRole("button", { name: "Release Sunil Perera" }).click();
    await expect(labour(page).getByText("Sunil Perera was released.")).toBeVisible();
    expect(sent.release).toEqual([{ employee_codes: ["EMP-0180"] }]);
  });

  test("raising a request: pre-filled, checked, then saved", async ({ page }) => {
    const sent = await open(page, "/projects/RAK-07/forecast");
    await labour(page).getByRole("button", { name: "Raise recruitment request" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("How many")).toHaveValue("1");
    await expect(sheet.getByLabel("Hiring")).toHaveValue("overseas");
    await expect(sheet.getByLabel("Needed by")).toHaveValue("2026-12-14"); // overseas lead time
    await sheet.getByLabel("Hiring").selectOption("local");
    await expect(sheet.getByLabel("Needed by")).toHaveValue("2027-01-13"); // local lead time

    await sheet.getByLabel("Reason").fill("too short");
    await sheet.getByRole("button", { name: "Raise request" }).click();
    await expect(sheet.getByText("Give a reason of at least 10 characters.")).toBeVisible();
    await expect(sheet.getByLabel("Reason")).toBeFocused();
    expect(sent.raise).toHaveLength(0);

    await sheet.getByLabel("Reason").fill("One labourer short for the logistics hub");
    await sheet.getByRole("button", { name: "Raise request" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      labour(page).getByText("RR-2026-0005 was raised for 1 general labour."),
    ).toBeVisible();
    expect(sent.raise).toEqual([
      expect.objectContaining({
        project: "RAK-07",
        trade: "general_labour",
        headcount: 1,
        source: "local",
        needed_by: "2027-01-13",
      }),
    ]);
  });

  test("a date in the past is refused before anything is sent", async ({ page }) => {
    const sent = await open(page, "/projects/RAK-07/forecast");
    await labour(page).getByRole("button", { name: "Raise recruitment request" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Needed by").fill("2026-10-01");
    await sheet.getByLabel("Reason").fill("One labourer short for the logistics hub");
    await sheet.getByRole("button", { name: "Raise request" }).click();
    await expect(sheet.getByText("The needed-by date cannot be in the past.")).toBeVisible();
    expect(sent.raise).toHaveLength(0);
  });

  test("the HR Executive sees the buttons disabled, with the reason", async ({ page }) => {
    await open(page, "/projects/RAK-07/forecast", EXEC_USER);
    const reserve = labour(page).getByRole("button", { name: "Reserve people" });
    const raise = labour(page).getByRole("button", { name: "Raise recruitment request" });
    await expect(reserve).toBeDisabled();
    await expect(raise).toBeDisabled();
    await expect(reserve).toHaveAttribute("title", /needs permission to approve assignments/);
    await expect(labour(page).getByText("Some actions need the HR Manager.")).toBeVisible();
    await labour(page).getByRole("button", { name: "Show people" }).click();
    await expect(labour(page).getByRole("button", { name: /^Release/ })).toHaveCount(0);
  });

  test("the MD/CEO may reserve but not raise a request", async ({ page }) => {
    await open(page, "/projects/RAK-07/forecast", CEO_USER);
    await expect(labour(page).getByRole("button", { name: "Reserve people" })).toBeEnabled();
    await expect(
      labour(page).getByRole("button", { name: "Raise recruitment request" }),
    ).toBeDisabled();
  });

  test("a trade nobody can fill has Reserve switched off, with the reason", async ({ page }) => {
    await open(page, "/projects/RAK-07/forecast");
    const mason = page.getByRole("region", { name: "Mason" });
    await expect(mason.getByRole("button", { name: "Reserve people" })).toBeDisabled();
    await expect(mason.getByRole("button", { name: "Reserve people" })).toHaveAttribute(
      "title",
      "Nobody can be reserved for this trade.",
    );
  });
});

test.describe("the Recruitment screen", () => {
  test("shows what is in progress, with the late arrival and the replacement flagged", async ({
    page,
  }) => {
    await open(page, "/recruitment");
    await expect(page.getByText("4 people on the way in 3 requests")).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    const first = rows(page).filter({ hasText: "RR-2026-0001" });
    await expect(first.getByText("Visa processing")).toBeVisible();
    await expect(first.getByText("late", { exact: true })).toBeVisible();
    await expect(
      rows(page).filter({ hasText: "RR-2026-0003" }).getByText("Replaces Suresh Nair"),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Finished or cancelled/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).getByText("Active")).toBeVisible();
  });

  test("leavers with nobody to replace them are listed, and a replacement can be raised", async ({
    page,
  }) => {
    const sent = await open(page, "/recruitment");
    await expect(
      page.getByRole("heading", { name: "Leaving, with nobody to replace them (2)" }),
    ).toBeVisible();
    await expect(page.getByText("Leaving on 15 Dec 2026 (terminated)")).toBeVisible();
    await page.getByRole("button", { name: "Raise a replacement for Farhan Khan" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/replacing Farhan Khan/)).toBeVisible();
    await expect(sheet.getByLabel("Needed by")).toHaveValue("2026-12-15");
    await sheet.getByRole("button", { name: "Raise request" }).click();
    await expect(page.getByText("RR-2026-0005 was raised to replace")).toBeVisible();
    expect((sent.raise[0] as { replaces: string }).replaces).toBe("EMP-0595");
  });

  test("moving everyone, then only some, to the next stage", async ({ page }) => {
    const sent = await open(page, "/recruitment");
    await page.getByRole("button", { name: "Move RR-2026-0003 to offer issued" }).click();
    let sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Everyone in the request moves.")).toBeVisible();
    await sheet.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("1 person moved to offer issued (RR-2026-0003).")).toBeVisible();

    await page.getByRole("button", { name: "Move RR-2026-0002 to visa processing" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByLabel("How many are moving").fill("1");
    await expect(
      sheet.getByText("1 will stay in offer issued as a separate request."),
    ).toBeVisible();
    await sheet.getByLabel(/Expected arrival/).fill("2027-01-20");
    await sheet.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText(/1 person moved to visa processing/)).toBeVisible();
    expect(sent.advance).toEqual([
      expect.objectContaining({ to: "offer_issued", count: 1 }),
      expect.objectContaining({ to: "visa_processing", count: 1, expected_arrival: "2027-01-20" }),
    ]);
  });

  test("a number that is too high is explained and nothing is sent", async ({ page }) => {
    const sent = await open(page, "/recruitment");
    await page.getByRole("button", { name: "Move RR-2026-0002 to visa processing" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("How many are moving").fill("5");
    await sheet.getByRole("button", { name: "Move", exact: true }).click();
    await expect(sheet.getByText("Enter a number from 1 to 2.")).toBeVisible();
    expect(sent.advance).toHaveLength(0);
  });

  test("cancelling asks first and keeps the request in the list as cancelled", async ({ page }) => {
    const sent = await open(page, "/recruitment");
    await page.getByRole("button", { name: "Cancel RR-2026-0001" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/cancels the whole request for 1 person/)).toBeVisible();
    await sheet.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(sent.advance).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel RR-2026-0001" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByText("RR-2026-0001 was cancelled.")).toBeVisible();
    expect(sent.advance).toEqual([expect.objectContaining({ to: "cancelled" })]);
  });

  test("the HR Executive can read but has no buttons", async ({ page }) => {
    await open(page, "/recruitment", EXEC_USER);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole("button", { name: /^Move RR/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Raise a replacement/ })).toHaveCount(0);
  });

  test("a failed load shows the reason and Retry works", async ({ page }) => {
    await haveSession(page);
    await mockApi(page);
    await mockProjects(page);
    await mockRecruitment(page);
    let failing = true;
    await page.route(/\/api\/recruitment-requests$/, (r) =>
      failing
        ? r.fulfill({ status: 500, json: { detail: "The server had a problem." } })
        : r.fallback(),
    );
    await page.goto("/recruitment");
    await expect(page.getByText("The server had a problem.")).toBeVisible();
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(rows(page)).toHaveCount(3);
  });
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`recruitment · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("recruitment, reserve and raise", async ({ page }) => {
        await open(page, "/recruitment");
        await expect(
          page.getByText("Visa processing").locator("visible=true").first(),
        ).toBeVisible();
        await page.waitForTimeout(500);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/recruitment-${viewport.name}-${theme}.png`,
          fullPage: true,
        });

        await page.goto("/projects/RAK-07/forecast");
        await labour(page).getByRole("button", { name: "Reserve people" }).click();
        await expect(page.getByRole("dialog").getByText(/You will reserve/)).toBeVisible();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await page.screenshot({ path: `e2e/screenshots/reserve-${viewport.name}-${theme}.png` });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();

        await labour(page).getByRole("button", { name: "Raise recruitment request" }).click();
        await expect(page.getByRole("dialog").getByLabel("Reason")).toBeVisible();
        await page.waitForTimeout(300);
        await noSidewaysScroll(page);
        await page.screenshot({ path: `e2e/screenshots/raise-${viewport.name}-${theme}.png` });
      });
    });
  }
}
