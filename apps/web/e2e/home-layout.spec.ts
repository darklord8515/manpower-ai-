import { expect, test, type Locator, type Page } from "@playwright/test";
import { CEO_USER, haveSession, mockApi, type SavedLayout } from "./fixtures";

/** The customizable Home: the default layout, rearranging, hiding, saving, and what is never loaded. */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

const HR_DEFAULT = [
  "action_center",
  "expiry",
  "workforce",
  "due",
  "projects_chart",
  "by_trade",
  "unavailable",
  "leaving",
  "pipeline",
];

async function open(page: Page, options: Parameters<typeof mockApi>[1] = {}, path = "/") {
  await haveSession(page);
  const seen = await mockApi(page, options);
  await page.goto(path);
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  return seen;
}

/** The widgets on screen, in the order they appear. */
const order = (page: Page) =>
  page.locator("[data-widget]").evaluateAll((els) => els.map((e) => e.getAttribute("data-widget")));

const widget = (page: Page, id: string) => page.locator(`[data-widget="${id}"]`);

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
}

test("a new HR user sees our default layout, with the new widgets filled from their own sources", async ({
  page,
}) => {
  await open(page);
  expect(await order(page)).toEqual(HR_DEFAULT);
  await expect(widget(page, "leaving").getByText("Nabin Magar")).toBeVisible();
  await expect(widget(page, "leaving").getByText("Leaves 15 Dec 2026")).toBeVisible();
  await expect(widget(page, "pipeline").getByText("4", { exact: true }).first()).toBeVisible();
  await expect(widget(page, "pipeline").getByText("1 arrive late")).toBeVisible();
  await expect(
    widget(page, "by_trade").getByRole("img", { name: /People by trade: Steel fixer 37/ }),
  ).toBeVisible();
  await expect(widget(page, "unavailable").getByText("Kiran Jha")).toBeVisible();
  // Nothing about editing is on screen until it is asked for.
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
});

test("a saved layout is applied, and a widget the person hid is never fetched", async ({
  page,
}) => {
  const saved: SavedLayout = {
    order: ["pipeline", "expiry", "workforce", "due", "projects_chart", "unavailable"],
    hidden: ["leaving", "by_trade"],
  };
  const seen = await open(page, { layout: saved });
  expect((await order(page)).slice(0, 2)).toEqual(["pipeline", "expiry"]);
  expect(await order(page)).not.toContain("leaving");
  expect(await order(page)).not.toContain("by_trade");
  await expect(widget(page, "pipeline")).toBeVisible();
  expect(seen.trades).toBe(0); // by_trade is hidden, so its numbers are never asked for
  expect(seen.recruitment).toBeGreaterThan(0); // the pipeline widget still needs the list
});

test("hiding the widgets that need a feed means the feed is never asked for", async ({ page }) => {
  const seen = await open(page, {
    layout: {
      order: HR_DEFAULT,
      hidden: ["leaving", "pipeline", "by_trade", "unavailable"],
    },
  });
  expect(seen).toMatchObject({ recruitment: 0, trades: 0, unavailable: 0 });
});

// A tall window puts every widget on screen: a drag cannot start from below the fold.
test.describe("rearranging", () => {
  test.use({ viewport: { width: 1440, height: 2800 } });

  test("dragging a widget moves it, Done saves it, and a reload keeps it", async ({ page }) => {
    const seen = await open(page);
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByRole("button", { name: "Move Leaving soon" })).toBeVisible();
    await drag(
      page,
      page.getByRole("button", { name: "Move Leaving soon" }),
      page.getByRole("button", { name: "Move Documents running out" }),
    );
    const moved = await order(page);
    expect(moved.indexOf("leaving")).toBeLessThan(moved.indexOf("workforce"));
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Your layout was saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    expect(seen.saved).toHaveLength(1);
    // It took the place of "Documents running out", which comes right after the Action Center.
    expect(seen.saved[0]?.order.slice(0, 2)).toEqual(["action_center", "leaving"]);
    await page.reload();
    await expect(page.locator("[data-widget]").first()).toBeVisible();
    expect((await order(page)).slice(0, 2)).toEqual(["action_center", "leaving"]);
  });

  test("the keyboard can move a widget: Space, arrows, Space", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Customize" }).click();
    const before = await order(page);
    await page.getByRole("button", { name: "Move Recruitment pipeline" }).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    const after = await order(page);
    expect(after).not.toEqual(before);
    expect(after.indexOf("pipeline")).toBeLessThan(before.indexOf("pipeline"));
    await expect(page.getByRole("button", { name: "Move Recruitment pipeline" })).toBeFocused();
  });
});

test("hiding a widget moves it to the tray, and Show brings it back at the end", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Hide Where everyone is" }).click();
  expect(await order(page)).not.toContain("workforce");
  await expect(page.getByRole("heading", { name: "Hidden widgets" })).toBeVisible();
  await expect(page.getByText("On a project, mobilizing, available, not available")).toBeVisible();
  await page.getByRole("button", { name: "Show Where everyone is" }).click();
  expect((await order(page)).at(-1)).toBe("workforce");
  await expect(page.getByRole("heading", { name: "Hidden widgets" })).toHaveCount(0);
});

test("Cancel throws the changes away", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Hide Documents running out" }).click();
  expect(await order(page)).not.toContain("expiry");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await order(page)).toEqual(HR_DEFAULT);
  expect(seen.saved).toHaveLength(0);
});

test("Reset to default restores our layout, and saving it stores nothing", async ({ page }) => {
  const seen = await open(page, { layout: { order: [...HR_DEFAULT].reverse(), hidden: [] } });
  expect((await order(page))[0]).toBe("pipeline");
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  expect(await order(page)).toEqual(HR_DEFAULT);
  await expect(page.getByRole("button", { name: "Reset to default" })).toBeDisabled();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Your layout was saved.")).toBeVisible();
  expect(seen.saved).toEqual([null]); // the default is stored as "nothing", so improvements reach everyone
});

test("if saving fails the person is told and keeps their changes", async ({ page }) => {
  await open(page, { failSave: true });
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Hide Leaving soon" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn’t save right now." }),
  ).toBeVisible();
  expect(await order(page)).not.toContain("leaving"); // still editing, nothing lost
  await expect(page.getByRole("button", { name: "Done" })).toBeEnabled();
});

test("every widget can be hidden and the page says what to do", async ({ page }) => {
  await open(page, { layout: { order: HR_DEFAULT, hidden: HR_DEFAULT } }).catch(() => undefined);
  await expect(page.getByText(/Every widget is hidden/)).toBeVisible();
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Show Where everyone is" }).click();
  expect(await order(page)).toEqual(["workforce"]);
});

test("the MD/CEO has their own default, with the by-trade widget off until asked for", async ({
  page,
}) => {
  await open(page, { user: CEO_USER });
  expect(await order(page)).toEqual([
    "alert_counts",
    "projects_chart",
    "workforce",
    "projects_table",
    "pipeline",
    "leaving",
  ]);
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(page.getByRole("button", { name: "Show People by trade" })).toBeVisible();
  // HR-only widgets are not on offer to the MD.
  await expect(page.getByRole("button", { name: "Show Documents to deal with first" })).toHaveCount(
    0,
  );
});

test("a widget while editing cannot be clicked into (charts stay still)", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(widget(page, "expiry").getByRole("button", { name: "4 weeks" })).toHaveCount(1);
  expect(await widget(page, "expiry").locator("[inert]").count()).toBeGreaterThan(0);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`home · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("default and customizing", async ({ page }) => {
        await open(page, { layout: { order: HR_DEFAULT, hidden: ["pipeline"] } });
        await expect(widget(page, "leaving").getByText("Nabin Magar")).toBeVisible();
        await page.waitForTimeout(700);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/home-widgets-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "Customize" }).click();
        await expect(page.getByRole("heading", { name: "Hidden widgets" })).toBeVisible();
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await page.screenshot({
          path: `e2e/screenshots/home-customize-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      });
    });
  }
}
