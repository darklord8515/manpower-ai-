import { expect, test, type Page } from "@playwright/test";
import { CEO_USER, haveSession, mockApi } from "./fixtures";

/** The calendar, with the API mocked: the demo date is 5 Nov 2026. */

type Entry = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  starts: string;
  ends: string;
  href: string | null;
  editable: boolean;
  expected: boolean;
};

const entry = (over: Partial<Entry> & Pick<Entry, "id" | "kind" | "title" | "starts">): Entry => ({
  detail: null,
  ends: over.starts,
  href: null,
  editable: false,
  expected: false,
  ...over,
});

const BASE: Entry[] = [
  entry({
    id: "meeting:1",
    kind: "meeting",
    title: "Safety induction at Marina Waterfront",
    starts: "2026-11-12",
    editable: true,
  }),
  entry({
    id: "deadline:2",
    kind: "deadline",
    title: "MoHRE quota submission deadline",
    starts: "2026-11-19",
    editable: true,
  }),
  entry({
    id: "leave:3",
    kind: "leave",
    title: "Bikash Rai on leave",
    detail: "annual leave · EMP-0107",
    starts: "2026-11-16",
    ends: "2026-11-22",
    href: "/workers?worker=EMP-0107",
    editable: true,
  }),
  entry({
    id: "documents:4",
    kind: "documents",
    title: "2 documents run out",
    detail: "Residency visa",
    starts: "2026-11-12",
    href: "/documents",
  }),
  entry({
    id: "holiday:5",
    kind: "holiday",
    title: "Commemoration Day and National Day",
    starts: "2026-12-01",
    ends: "2026-12-03",
  }),
  entry({
    id: "project_end:6",
    kind: "project_end",
    title: "Aila Homes ends",
    detail: "RAK-02",
    starts: "2026-11-30",
    href: "/projects/RAK-02",
  }),
];

async function open(page: Page, options: { user?: typeof CEO_USER; fail?: boolean } = {}) {
  await haveSession(page);
  await mockApi(page, options.user ? { user: options.user } : {});
  const sent: unknown[] = [];
  const entries = [...BASE];
  await page.route(/\/api\/calendar\?/, (route) => {
    if (options.fail)
      return route.fulfill({ status: 500, json: { detail: "The server had a problem." } });
    const url = new URL(route.request().url());
    const [s, e] = [url.searchParams.get("start")!, url.searchParams.get("end")!];
    return route.fulfill({
      json: {
        start: s,
        end: e,
        today: "2026-11-05",
        can_edit: !options.user,
        entries: entries
          .filter((x) => x.starts <= e && x.ends >= s)
          .map((x) => ({ ...x, editable: x.editable && !options.user })),
      },
    });
  });
  await page.route("**/api/calendar/events", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    const made = entry({
      id: "event:new",
      kind: body.kind,
      title: body.title,
      starts: body.starts_on,
      ends: body.ends_on ?? body.starts_on,
      editable: true,
    });
    entries.push(made);
    return route.fulfill({ status: 201, json: made });
  });
  await page.route(/\/api\/calendar\/(events|leaves)\/[^/]+$/, async (route) => {
    const id = route
      .request()
      .url()
      .split("/")
      .slice(-2)
      .join(":")
      .replace("events", "event")
      .replace("leaves", "leave");
    sent.push({ removed: id });
    const at = entries.findIndex((x) => x.id.startsWith(id.split(":")[0]));
    if (at >= 0) entries.splice(at, 1);
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/calendar/leaves", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    if (body.employee_code === "EMP-0107")
      return route.fulfill({
        status: 409,
        json: { detail: "Bikash Rai already has leave that overlaps those dates" },
      });
    const made = entry({
      id: "leave:new",
      kind: "leave",
      title: "Anil Kumar on leave",
      starts: body.starts_on,
      ends: body.ends_on,
      editable: true,
    });
    entries.push(made);
    return route.fulfill({ status: 201, json: made });
  });
  await page.goto("/calendar");
  return sent;
}

const day = (page: Page, iso: string) =>
  page.getByRole("gridcell", { name: new RegExp(`^${iso},`) });
const sheet = (page: Page) => page.getByRole("dialog");

test("the month opens on the demo date and shows what is on each day", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "November 2026" })).toBeVisible();
  await expect(day(page, "2026-11-12")).toContainText("Safety induction at Marina Waterfront");
  await expect(day(page, "2026-11-12")).toContainText("2 documents run out");
  await expect(day(page, "2026-11-20")).toContainText("Bikash Rai on leave"); // a leave covers every day
  await expect(day(page, "2026-11-05")).toHaveAccessibleName(/0 entries/);
});

test("moving to December shows the national holiday across its three days", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "December 2026" })).toBeVisible();
  for (const d of ["2026-12-01", "2026-12-02", "2026-12-03"])
    await expect(day(page, d)).toContainText("National Day");
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: "November 2026" })).toBeVisible();
});

test("kinds can be switched off and on", async ({ page }) => {
  await open(page);
  const leave = page.getByRole("button", { name: "Leave", exact: true });
  await expect(leave).toHaveAttribute("aria-pressed", "true");
  await leave.click();
  await expect(leave).toHaveAttribute("aria-pressed", "false");
  await expect(day(page, "2026-11-20")).not.toContainText("on leave");
  await leave.click();
  await expect(day(page, "2026-11-20")).toContainText("on leave");
});

test("HR opens a day, adds an event, and it appears; then removes it", async ({ page }) => {
  const sent = await open(page);
  await day(page, "2026-11-25").click();
  await expect(sheet(page).getByRole("heading", { name: "25 Nov 2026" })).toBeVisible();
  await expect(sheet(page).getByText("A free day")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Add an event" }).click();
  await sheet(page).getByLabel("What is happening").fill("Camp inspection");
  await sheet(page).getByLabel("Type").selectOption("meeting");
  await sheet(page).getByRole("button", { name: "Add to calendar" }).click();
  await expect(page.getByRole("status")).toContainText("“Camp inspection” was added");
  await expect(sheet(page).getByText("Camp inspection")).toBeVisible(); // the day shows it at once
  await page.keyboard.press("Escape");
  await expect(day(page, "2026-11-25")).toContainText("Camp inspection");
  expect(sent[0]).toMatchObject({
    title: "Camp inspection",
    starts_on: "2026-11-25",
    kind: "meeting",
  });
  await day(page, "2026-11-25").click();
  await sheet(page).getByRole("button", { name: "Remove Camp inspection" }).click();
  await expect(sheet(page).getByText("A free day")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status")).toContainText("was removed");
  await expect(day(page, "2026-11-25")).not.toContainText("Camp inspection");
});

test("HR adds a leave, and a clash is explained", async ({ page }) => {
  await open(page);
  await day(page, "2026-11-03").click();
  await sheet(page).getByRole("button", { name: "Add a leave" }).click();
  await sheet(page).getByLabel("Employee code").fill("emp-0107");
  await sheet(page).getByLabel("Last day of leave").fill("2026-11-04");
  await sheet(page).getByRole("button", { name: "Add leave" }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("already has leave that overlaps");
  await sheet(page).getByLabel("Employee code").fill("EMP-0142");
  await sheet(page).getByRole("button", { name: "Add leave" }).click();
  await expect(page.getByRole("status")).toContainText("Anil Kumar on leave");
  await expect(sheet(page).getByText("Anil Kumar on leave")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(day(page, "2026-11-03")).toContainText("Anil Kumar on leave");
});

test("Esc closes the day, and the MD can look but not change", async ({ page }) => {
  await open(page, { user: CEO_USER });
  await day(page, "2026-11-12").click();
  await expect(sheet(page).getByText("Safety induction at Marina Waterfront")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Add an event" })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
});

test("a failed load shows the reason and a Retry", async ({ page }) => {
  await open(page, { fail: true });
  await expect(page.getByText("The server had a problem.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`calendar · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      test("the month and a day", async ({ page }) => {
        await open(page);
        await expect(day(page, "2026-11-12")).toBeVisible();
        await page.waitForTimeout(400);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `e2e/screenshots/calendar-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
        await day(page, "2026-11-12").click();
        await expect(sheet(page)).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `e2e/screenshots/calendar-day-${viewport.name}-${theme}.png`,
        });
      });
    });
  }
}
