import { expect, test, type Page } from "@playwright/test";
import { mockAgent, type AgentOptions } from "./agent-fixtures";
import { CEO_USER, haveSession, mockApi, mockProjects } from "./fixtures";
import { mockRequests } from "./requests-fixtures";

/** The Workforce agent on the Allocation board and the forecast, with the API mocked. */

type User = typeof CEO_USER;

async function open(page: Page, path: string, options: AgentOptions = {}, user?: User) {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  const board = await mockRequests(page);
  const agent = await mockAgent(page, options);
  await page.goto(path);
  return { board, agent };
}

const steel = (page: Page) => page.getByRole("region", { name: "Steel fixer line" });
const card = (page: Page) => page.getByRole("article", { name: "Answer from the Workforce agent" });
const ask = (page: Page) => steel(page).getByRole("button", { name: "Ask Workforce agent" });

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

test("the agent's steps appear one by one, then who it recommends and who the rules dropped", async ({
  page,
}) => {
  const { agent } = await open(page, "/requests");
  await ask(page).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText("Workforce agent is working…")).toBeVisible();
  await expect(card(page).getByText("Read the request line")).toBeVisible();
  await expect(card(page).getByRole("button", { name: /Use these/ })).toHaveCount(0); // not yet

  await expect(card(page).getByText("Recommends 3 workers, 4 places stay open.")).toBeVisible({
    timeout: 8000,
  });
  const list = card(page).getByRole("list", { name: "Recommended workers" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("Imran Qureshi");
  await expect(list).toContainText("reason worded by the rules"); // the one the model's wording failed
  await expect(card(page).getByRole("note")).toContainText("Dropped by the rules (1)");
  await expect(card(page).getByRole("note")).toContainText("POLICY_LATE");
  await expect(card(page).getByText("Trace · 3 steps")).toBeVisible();
  expect(agent.started).toEqual([
    { kind: "recommend_line", request_no: "SR-2026-0001", line_id: "line-steel" },
  ]);
});

test("Use these chooses them as the agent's, with the run, and the line shows it", async ({
  page,
}) => {
  const { board } = await open(page, "/requests");
  await ask(page).click();
  await card(page).getByRole("button", { name: "Use these 3" }).click({ timeout: 8000 });
  await expect(
    page.getByText(
      "3 workers chosen from the Workforce agent’s recommendation. Check them, then approve.",
    ),
  ).toBeVisible();
  expect(board.seen.agentPicks).toEqual([
    { codes: ["EMP-0107", "EMP-0112", "EMP-0117"], run: "run-1" },
  ]);
  await expect(steel(page)).toContainText("Level 2 or higher · 3 of 7 selected");
  await expect(card(page)).toContainText("3 workers added to the line.");
  await expect(card(page).getByRole("button", { name: /Use these/ })).toHaveCount(0);
  await expect(
    steel(page).locator('li[data-worker="EMP-0107"]').getByText("Suggested by the Workforce agent"),
  ).toBeAttached();
});

test("with no model on the server the button is there, switched off, with the reason", async ({
  page,
}) => {
  await open(page, "/requests", { off: true });
  await expect(ask(page)).toBeDisabled();
  await expect(ask(page)).toHaveAccessibleDescription("The AI model is not set up on this server.");
  await expect(steel(page).getByText("The AI model is not set up on this server.")).toBeVisible();
});

test("someone who cannot prepare a line is not offered the agent", async ({ page }) => {
  await open(page, "/requests", {}, CEO_USER);
  await expect(steel(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Workforce agent" })).toHaveCount(0);
});

test("a run that cannot start says why, and Try again asks once more", async ({ page }) => {
  await open(page, "/requests", { refuseStart: "The AI model is not set up on this server." });
  await ask(page).click();
  await expect(card(page).getByText("The agent could not finish.")).toBeVisible();
  await expect(card(page).getByText("The AI model is not set up on this server.")).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a run that fails shows the reason in plain words and keeps what it did", async ({ page }) => {
  await open(page, "/requests", {
    fail: "The AI model did not give a usable answer. Try again.",
    slow: 1,
  });
  await ask(page).click();
  await expect(card(page).getByText("The agent could not finish.")).toBeVisible({ timeout: 8000 });
  await expect(
    card(page).getByText("The AI model did not give a usable answer. Try again."),
  ).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Use these 3" })).toHaveCount(0);
});

test("when the agent finds no one it says so and offers nothing to apply", async ({ page }) => {
  await open(page, "/requests", { nobody: true });
  await ask(page).click();
  await expect(card(page).getByText("No one is cleared for the open places.")).toBeVisible({
    timeout: 8000,
  });
  await expect(card(page).getByRole("button", { name: /Use these/ })).toHaveCount(0);
});

test("Esc closes the agent's panel", async ({ page }) => {
  await open(page, "/requests");
  await ask(page).click();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
});

test("the forecast can be explained in words, and says the words are AI's", async ({ page }) => {
  const { agent } = await open(page, "/projects/RAK-07/forecast");
  await page.getByRole("button", { name: "Explain" }).click();
  await expect(card(page)).toBeVisible();
  await expect(
    card(page).getByText(/RAK-07 needs 6 people in Test trade and 4 can be deployed/),
  ).toBeVisible({ timeout: 8000 });
  await expect(card(page).getByText(/Written by AI from the numbers below/)).toBeVisible();
  expect(agent.started).toEqual([{ kind: "explain_forecast", project: "RAK-07", start: null }]);
  await card(page).getByRole("button", { name: "Close" }).click();
  await expect(card(page)).toHaveCount(0);
});

test("an explanation belongs to the date it was asked for: changing the date closes it", async ({
  page,
}) => {
  await open(page, "/projects/RAK-07/forecast");
  await page.getByRole("button", { name: "Explain" }).click();
  await expect(card(page)).toBeVisible();
  await page.getByLabel("What if it starts on").fill("2027-03-01");
  await expect(card(page)).toHaveCount(0);
});

test("on the forecast the button is switched off, with the reason, when there is no model", async ({
  page,
}) => {
  await open(page, "/projects/RAK-07/forecast", { off: true });
  await expect(page.getByRole("button", { name: "Explain" })).toBeDisabled();
  await expect(page.getByText("The AI model is not set up on this server.")).toBeVisible();
});

test("at 390px the agent's panel fits and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/requests");
  await ask(page).click();
  await expect(card(page).getByText("Recommends 3 workers, 4 places stay open.")).toBeVisible({
    timeout: 8000,
  });
  await noSidewaysScroll(page);
});

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`agent · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("recommendation, applied, and the forecast explanation", async ({ page }) => {
        const shot = (name: string) =>
          page.screenshot({
            path: `e2e/screenshots/agent-${name}-${viewport.name}-${theme}.png`,
            fullPage: true,
          });

        await open(page, "/requests");
        await ask(page).click();
        await expect(card(page).getByText("Read the request line")).toBeVisible();
        await page.waitForTimeout(300);
        await shot("working");
        await expect(card(page).getByText("Recommends 3 workers, 4 places stay open.")).toBeVisible(
          {
            timeout: 8000,
          },
        );
        await page.waitForTimeout(500);
        await noSidewaysScroll(page);
        await shot("recommendation");
        await card(page).getByRole("button", { name: "Use these 3" }).click();
        await expect(card(page)).toContainText("3 workers added to the line.");
        await page.waitForTimeout(400);
        await shot("applied");

        await page.goto("/projects/RAK-07/forecast");
        await page.getByRole("button", { name: "Explain" }).click();
        await expect(card(page).getByText(/RAK-07 needs 6 people/)).toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(400);
        await noSidewaysScroll(page);
        await shot("explain");
      });
    });
  }
}
