import { expect, test, type Page } from "@playwright/test";
import { mockChat, type ChatOptions } from "./chat-fixtures";
import { CEO_USER, HR_USER, haveSession, mockApi, mockProjects } from "./fixtures";

/** Virtual HR: the Cmd+K drawer and the page, with the API mocked. */

type User = typeof HR_USER;

async function open(page: Page, path: string, options: ChatOptions = {}, user?: User) {
  await haveSession(page);
  await mockApi(page, user ? { user } : {});
  await mockProjects(page);
  const chat = await mockChat(page, options);
  await page.goto(path);
  // The shortcut only works once the signed-in shell is on screen.
  await expect(page.locator("#main")).toBeVisible();
  return chat;
}

const drawer = (page: Page) => page.getByRole("dialog", { name: "Virtual HR" });
const answers = (page: Page) => page.getByRole("article", { name: /^Answer from the/ });
const box = (page: Page) => page.getByRole("textbox", { name: "Your question" });

async function ask(page: Page, question: string) {
  await box(page).fill(question);
  await box(page).press("Enter");
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

test("the top-bar button opens the drawer; a suggestion asks, steps appear, then the answer", async ({
  page,
}) => {
  const chat = await open(page, "/");
  await page.getByRole("button", { name: "Ask Virtual HR" }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(box(page)).toBeFocused();
  await expect(drawer(page).getByRole("heading", { name: "Ask Virtual HR" })).toBeVisible();

  await drawer(page).getByRole("button", { name: "Who is available right now?" }).click();
  await expect(drawer(page).getByText("Understood the question")).toBeVisible();
  const card = answers(page).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("table")).toBeVisible({ timeout: 8000 });
  await expect(card.getByText("12 workers match (available, Steel fixer).")).toBeVisible();
  await expect(card.getByText("Anil Kumar")).toBeVisible();
  await expect(card.getByText(/Understood by the AI as workers/)).toBeVisible();
  await expect(card.getByText("Trace · 2 steps")).toBeVisible();
  expect(chat.sent).toEqual([{ message: "Who is available right now?" }]);
});

test("Ctrl+K opens it from anywhere, Esc closes it, and focus returns to where it was", async ({
  page,
}) => {
  await open(page, "/");
  await page.keyboard.press("Control+k");
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(drawer(page)).toBeHidden();
});

test("the thread is kept when the drawer is closed and opened again, and the link closes it", async ({
  page,
}) => {
  await open(page, "/");
  await page.getByRole("button", { name: "Ask Virtual HR" }).click();
  await ask(page, "any free steel fixers?");
  await expect(answers(page).first().getByRole("table")).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ask Virtual HR" }).click();
  await expect(answers(page)).toHaveCount(1); // still there

  await answers(page).first().getByRole("link", { name: "Open these in Workers" }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(page).toHaveURL(/\/workers\?trade=Steel\+fixer&status=available/);
});

test("a follow-up continues the conversation; New chat starts a fresh one", async ({ page }) => {
  const chat = await open(page, "/");
  await page.keyboard.press("Control+k");
  await ask(page, "any free steel fixers?");
  await expect(answers(page).first().getByRole("table")).toBeVisible({ timeout: 8000 });
  await ask(page, "and the alerts?");
  await expect(answers(page)).toHaveCount(2);
  // An earlier answer keeps its full height as the thread grows (it is not squeezed to fit).
  const clipped = await answers(page)
    .first()
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(clipped).toBeLessThanOrEqual(0);
  await expect(
    answers(page)
      .nth(1)
      .getByRole("link", { name: /Anil Kumar’s residency visa/ }),
  ).toBeVisible({
    timeout: 8000,
  });
  expect(chat.sent[1]).toEqual({ message: "and the alerts?", conversation_id: "conv-new" });
  await drawer(page).getByRole("button", { name: "Start a new chat" }).click();
  await expect(answers(page)).toHaveCount(0);
  await expect(drawer(page).getByRole("heading", { name: "Ask Virtual HR" })).toBeVisible();
});

test("a question about salary is refused and shows no data", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Control+k");
  await ask(page, "what is the salary of EMP-0142");
  const card = page.getByRole("article", { name: "Answer from the Virtual HR" });
  await expect(card.getByRole("note")).toContainText("holds no salary or pay data", {
    timeout: 8000,
  });
  await expect(card.getByRole("table")).toHaveCount(0);
});

test("a wrong word is asked about, not guessed", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Control+k");
  await ask(page, "any unobtainium welders?");
  await expect(answers(page).first()).toContainText(
    "The trades are: Carpenter, Mason, Steel fixer",
    {
      timeout: 8000,
    },
  );
});

test("when no model is set up it says so, and plain questions still answer", async ({ page }) => {
  await open(page, "/", { off: true });
  await page.keyboard.press("Control+k");
  await expect(drawer(page).getByText(/No AI model is set up on this server/)).toBeVisible();
  await ask(page, "show me the alerts");
  await expect(answers(page).first().getByText("Python only")).toBeVisible({ timeout: 8000 });
});

test("a refused send explains itself and can be tried again", async ({ page }) => {
  await open(page, "/", { refuse: "That is a lot of questions in a short time." });
  await page.keyboard.press("Control+k");
  await ask(page, "who is free?");
  await expect(drawer(page).getByRole("alert")).toContainText(
    "That is a lot of questions in a short time.",
  );
  await expect(drawer(page).getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(drawer(page).getByText("who is free?")).toHaveCount(1);
});

test("a server that stops answering ends in a message, not a spinner", async ({ page }) => {
  await open(page, "/", { deadPolls: true });
  await page.keyboard.press("Control+k");
  await ask(page, "who is free?");
  await expect(drawer(page).getByText("Lost touch with the server. Try again.")).toBeVisible({
    timeout: 10000,
  });
});

test("someone without AI access sees no button, and Ctrl+K does nothing", async ({ page }) => {
  await open(
    page,
    "/",
    {},
    {
      ...HR_USER,
      permissions: HR_USER.permissions.filter((p) => p !== "ai:use"),
    },
  );
  await expect(page.getByRole("button", { name: "Ask Virtual HR" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Virtual HR" })).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(drawer(page)).toHaveCount(0);
});

test("the MD/CEO can ask too, and gets links, not buttons that change anything", async ({
  page,
}) => {
  await open(page, "/", {}, CEO_USER);
  await page.keyboard.press("Control+k");
  await ask(page, "show me the alerts");
  const card = answers(page).first();
  await expect(card.getByRole("link", { name: "Open To-do" })).toBeVisible({ timeout: 8000 });
  await expect(card.getByRole("button", { name: /approve|reserve|resolve/i })).toHaveCount(0);
});

// -------------------------------------------------------------------------------------- the page

const SAVED = [
  { id: "conv-a", title: "any free steel fixers?", updated_at: "2026-11-05T05:00:00Z" },
  { id: "conv-b", title: "show me the alerts", updated_at: "2026-11-04T05:00:00Z" },
];

test("the page lists your conversations, opens one, and starts a new chat", async ({ page }) => {
  await open(page, "/assistant", { saved: SAVED });
  await expect(page.getByRole("heading", { name: "Virtual HR", level: 1 })).toBeVisible();
  const history = page.getByRole("navigation", { name: "Your conversations" });
  await expect(history.getByRole("button", { name: /^show me the alerts/ })).toBeVisible();
  await history.getByRole("button", { name: /^any free steel fixers\?/ }).click();
  await expect(answers(page).first().getByRole("table")).toBeVisible();
  await expect(history.getByRole("button", { name: /^any free steel fixers\?/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(answers(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Virtual HR" })).toHaveAttribute(
    "href",
    "/assistant",
  );
});

test("deleting a conversation asks first, then removes it and says so", async ({ page }) => {
  const chat = await open(page, "/assistant", { saved: SAVED });
  const history = page.getByRole("navigation", { name: "Your conversations" });
  await history.getByRole("button", { name: "Delete conversation: show me the alerts" }).click();
  await expect(history.getByRole("button", { name: "Delete?" })).toBeVisible();
  expect(chat.deleted).toEqual([]);
  await history.getByRole("button", { name: "Delete?" }).click();
  await expect(page.getByRole("status")).toContainText("Conversation deleted.");
  await expect(history.getByRole("button", { name: /^show me the alerts/ })).toHaveCount(0);
  expect(chat.deleted).toEqual(["conv-b"]);
});

test("a new question on the page appears in the history", async ({ page }) => {
  await open(page, "/assistant");
  const history = page.getByRole("navigation", { name: "Your conversations" });
  await expect(history.getByText("No conversations yet")).toBeVisible();
  await ask(page, "any free steel fixers?");
  await expect(answers(page).first().getByRole("table")).toBeVisible({ timeout: 8000 });
  await expect(history.getByRole("button", { name: /^any free steel fixers\?/ })).toBeVisible();
});

test("on a phone the answer fits and the table scrolls inside its card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/assistant");
  await ask(page, "any free steel fixers?");
  await expect(answers(page).first().getByRole("table")).toBeVisible({ timeout: 8000 });
  await noSidewaysScroll(page);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("navigation", { name: "Your conversations" })).toBeVisible();
  await noSidewaysScroll(page);
});

// ---------------------------------------------------------------------------- the screenshots

for (const viewport of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`virtual hr · ${viewport.name}px · ${theme}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });

      test("the drawer and the page", async ({ page }) => {
        // The drawer is fixed to the window, so it is shown as the window sees it.
        const shot = (name: string) =>
          page.screenshot({
            path: `e2e/screenshots/assistant-${name}-${viewport.name}-${theme}.png`,
            fullPage: name === "page",
          });

        await open(page, "/", { saved: SAVED });
        await page.getByRole("button", { name: "Ask Virtual HR" }).click();
        await expect(
          drawer(page).getByRole("button", { name: "Who is available right now?" }),
        ).toBeVisible();
        await page.waitForTimeout(300);
        await shot("drawer-empty");
        await ask(page, "any free steel fixers?");
        await expect(drawer(page).getByText("Understood the question")).toBeVisible();
        await page.waitForTimeout(250);
        await shot("drawer-working");
        await expect(answers(page).first().getByRole("table")).toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(500);
        await noSidewaysScroll(page);
        await shot("drawer-answer");
        await ask(page, "can we staff RAK-07 next month?");
        await expect(answers(page).nth(1).getByRole("img", { name: "Mason: 6 of 10" })).toBeVisible(
          {
            timeout: 8000,
          },
        );
        await page.waitForTimeout(500);
        await shot("drawer-forecast");
        await ask(page, "what is the salary of EMP-0142");
        await expect(
          page.getByRole("article", { name: "Answer from the Virtual HR" }).getByRole("note"),
        ).toContainText("holds no salary or pay data", { timeout: 8000 });
        await page.waitForTimeout(400);
        await shot("drawer-refusal");

        await page.keyboard.press("Escape");
        await page.goto("/assistant");
        await expect(page.getByRole("heading", { name: "Virtual HR", level: 1 })).toBeVisible();
        await ask(page, "show me the alerts");
        await expect(
          answers(page)
            .first()
            .getByRole("link", { name: /Anil Kumar’s residency visa/ }),
        ).toBeVisible({
          timeout: 8000,
        });
        await page.waitForTimeout(500);
        await noSidewaysScroll(page);
        await shot("page");
      });
    });
  }
}
