import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOTYPE = pathToFileURL(path.resolve(__dirname, "../../../prototype/index.html")).href;

test.describe("gallery motion", () => {
  test("SlidingTabs moves one highlight to the chosen tab", async ({ page }) => {
    await page.goto("/gallery");
    const group = page.getByRole("group", { name: "When it expires" });
    const pill = group.locator("[aria-hidden='true'].absolute");
    await expect(pill).toHaveCount(1);
    const before = await pill.boundingBox();
    await group.getByRole("button", { name: /^Expired/ }).click();
    await expect(group.getByRole("button", { name: /^Expired/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(pill).toHaveCount(1);
    await expect.poll(async () => (await pill.boundingBox())?.x).not.toBe(before?.x);
  });

  test("with reduced motion nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/gallery");
    const group = page.getByRole("group", { name: "When it expires" });
    await group.getByRole("button", { name: /^Expired/ }).click();
    await page.getByRole("button", { name: "Replay" }).click();
    await page.getByRole("button", { name: "Next page" }).click();
    await page.waitForTimeout(250);
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity)
          .length,
    );
    expect(running).toBe(0);
    // The one value change that is meant to be seen still lands on the right number.
    await expect(page.getByText("Page 2")).toBeVisible();
  });
});

test.describe("prototype motion", () => {
  test("segmented controls have one highlight that sits under the chosen option", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PROTOTYPE);
    await page.evaluate(() => {
      // @ts-expect-error prototype globals
      setRole("hr_manager", true);
      // @ts-expect-error prototype globals
      goto("documents");
    });
    const seg = page.getByRole("group", { name: "When it expires" });
    await expect(seg.locator(".seg-pill")).toHaveCount(1);
    await seg.getByRole("button", { name: /^31–60 days/ }).click();
    await page.waitForTimeout(300);
    const pill = await page
      .getByRole("group", { name: "When it expires" })
      .locator(".seg-pill")
      .boundingBox();
    const chosen = await page
      .getByRole("group", { name: "When it expires" })
      .getByRole("button", { name: /^31–60 days/ })
      .boundingBox();
    expect(Math.abs(pill!.x - chosen!.x)).toBeLessThan(2);
    expect(Math.abs(pill!.width - chosen!.width)).toBeLessThan(2);
  });
});
