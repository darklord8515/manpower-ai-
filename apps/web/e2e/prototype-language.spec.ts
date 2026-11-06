import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Language check for the HR-clarity workstream (docs/design-direction.md → Language and clarity).
 * Opens every screen of the prototype that HR sees and fails if the visible text contains
 * system jargon: rule codes, permission strings, "agent", "detector", tool names and so on.
 * Content hidden inside a closed <details> is not visible text, so "Details" links are allowed.
 */
const PROTOTYPE = pathToFileURL(path.resolve(__dirname, "../../../prototype/index.html")).href;

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "rule code", pattern: /\b[A-Z]{3,}(?:_[A-Z]+)+\b/ },
  {
    name: "permission string",
    pattern:
      /\b(?:alert|staffing|assignment|mobilization|employee|project|forecast|recruitment|document|logistics|agent|user|rules|automation|report|notification):[a-z_]+\b/,
  },
  { name: "the word agent", pattern: /\bagents?\b/i },
  { name: "detector", pattern: /\bdetectors?\b/i },
  { name: "model tier", pattern: /\btier (?:mid|light)\b/i },
  {
    name: "tool name",
    pattern:
      /\b(?:search_employees|check_\w+|recommend_candidates|forecast_availability|list_expiring)\b/,
  },
  { name: "n8n / Python / evals", pattern: /\bn8n\b|\bpython\b|\bevals?\b|\bvalidators?\b/i },
  { name: "candidate pool", pattern: /candidate pool/i },
  { name: "deployable", pattern: /\bdeployable\b/i },
  { name: "transfer buffer", pattern: /transfer buffer|\bbuffer\b/i },
  { name: "slots", pattern: /\bslots?\b/i },
  { name: "'line' meaning a trade row", pattern: /\blines?\b/i },
  { name: "old severity label", pattern: /\bAction needed\b|\bCritical\b/ },
  { name: "dismiss / snooze", pattern: /\bdismiss(?:ed)?\b|\bsnooze(?:d)?\b/i },
  { name: "dead search box", pattern: /not built yet/i },
  { name: "Coming next", pattern: /coming next/i },
  { name: "prototype-only controls", pattern: /prototype only|Prototype:|Preview state/i },
  { name: "excluded by", pattern: /excluded by/i },
];

async function openPrototype(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PROTOTYPE);
  await page.evaluate(() => {
    // Skip animation delays so the checks run fast and deterministically.
    document.documentElement.style.setProperty("--dur-base", "0ms");
  });
}

const as = (role: string) => (page: Page) =>
  page.evaluate((r) => {
    // setRole / goto are the prototype's own globals.
    // @ts-expect-error prototype globals
    setRole(r, true);
  }, role);

const visit = (page_: string, req?: string) => (page: Page) =>
  page.evaluate(
    ([p, r]) => {
      // @ts-expect-error prototype globals
      goto(p, r);
    },
    [page_, req ?? null] as const,
  );

type Screen = { name: string; role: string; steps: ((page: Page) => Promise<void>)[] };

const SCREENS: Screen[] = [
  { name: "HR Console", role: "hr_manager", steps: [] },
  { name: "To-do (Action Center page)", role: "hr_manager", steps: [visit("actions")] },
  { name: "Requests board", role: "hr_manager", steps: [visit("allocation", "SR-2026-0042")] },
  {
    name: "Requests board, suggestions streamed",
    role: "hr_manager",
    steps: [
      visit("allocation", "SR-2026-0044"),
      async (page) => {
        await page
          .getByRole("button", { name: /Suggest workers/ })
          .first()
          .click();
        await page.waitForTimeout(3500);
      },
    ],
  },
  {
    name: "Requests board, swap errors",
    role: "hr_manager",
    steps: [
      visit("allocation", "SR-2026-0042"),
      async (page) => {
        await page.locator('[data-swap="SR-2026-0042-1|EMP-0107"]').first().click();
        await page.evaluate(() => {
          // @ts-expect-error prototype globals
          state.ui.availOnly = false;
          // @ts-expect-error prototype globals
          state.ui.poolLevel = "1";
          // @ts-expect-error prototype globals
          render();
        });
        await page.locator('[data-swapin="EMP-0150"]').click();
      },
    ],
  },
  { name: "Forecast", role: "hr_manager", steps: [visit("forecast")] },
  {
    name: "Forecast, hold-people and recruit forms",
    role: "hr_manager",
    steps: [
      visit("forecast"),
      async (page) => {
        await page.locator('[data-fc-reserve="Steel fixer"]').click();
        await page.locator('[data-fc-recruit="Mason"]').click();
      },
    ],
  },
  { name: "Projects", role: "hr_manager", steps: [visit("projects")] },
  { name: "CEO overview", role: "ceo", steps: [] },
];

for (const screen of SCREENS) {
  test(`HR language: ${screen.name}`, async ({ page }) => {
    await openPrototype(page);
    await as(screen.role)(page);
    for (const step of screen.steps) await step(page);
    const text = await page.evaluate(() => document.body.innerText);
    const hits = FORBIDDEN.flatMap(({ name, pattern }) => {
      const match = pattern.exec(text);
      return match ? [`${name}: "${match[0]}"`] : [];
    });
    expect(hits, `jargon visible on "${screen.name}"`).toEqual([]);
  });
}

test("HR language: every alert's detail sheet", async ({ page }) => {
  await openPrototype(page);
  await as("hr_manager")(page);
  const ids = await page.evaluate(() =>
    // @ts-expect-error prototype globals
    state.alerts.map((a: { id: string }) => a.id),
  );
  const problems: string[] = [];
  for (const id of ids) {
    await page.evaluate((alertId) => {
      // @ts-expect-error prototype globals
      openAlert(alertId);
    }, id);
    const text = await page.evaluate(() => document.body.innerText);
    for (const { name, pattern } of FORBIDDEN) {
      const match = pattern.exec(text);
      if (match) problems.push(`${id} ${name}: "${match[0]}"`);
    }
    await page.keyboard.press("Escape");
  }
  expect(problems).toEqual([]);
});

test("HR has one obvious home for each job, and no dead controls in the sidebar", async ({
  page,
}) => {
  await openPrototype(page);
  await as("hr_manager")(page);
  const labels = await page.locator("#nav .nav-item").allInnerTexts();
  const joined = labels.join(" | ");
  expect(joined).toMatch(/To-do/);
  expect(joined).toMatch(/Requests/);
  expect(joined).toMatch(/Forecast/);
  expect(joined).not.toMatch(/Coming next|Not built/i);
  await expect(page.locator("#searchInput")).toHaveCount(0);
});

test("approvals have one owner: the CEO dashboard can no longer approve", async ({ page }) => {
  await openPrototype(page);
  await as("ceo")(page);
  await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Decline/ })).toHaveCount(0);
});
