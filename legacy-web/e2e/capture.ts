/**
 * Saves screenshots for visual review. Usage, with the dev server running:
 *   node --experimental-strip-types e2e/capture.ts <output-folder>
 */
import { chromium } from '@playwright/test';

const outputDir = process.argv[2] ?? 'e2e/screenshots';
const widths = [1920, 1440, 1280, 1024, 768, 375, 320];

const browser = await chromium.launch();
for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: width < 700 ? 844 : 900 } });
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDir}/full-${width}.png`, fullPage: true });
  await page.screenshot({ path: `${outputDir}/view-${width}.png` });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outputDir}/end-${width}.png` });
  await page.close();
}

const viewport = (width: number, height: number) => browser.newPage({ viewport: { width, height } });

const narrow = await viewport(320, 700);
await narrow.goto('http://localhost:5173');
await narrow.waitForTimeout(400);
await narrow.getByRole('heading', { name: 'Project timeline and workforce demand' }).scrollIntoViewIfNeeded();
await narrow.evaluate(() => window.scrollBy(0, 300));
await narrow.waitForTimeout(150);
await narrow.screenshot({ path: `${outputDir}/narrow-timeline.png` });
await narrow.getByRole('heading', { name: 'AI Workforce Forecast' }).scrollIntoViewIfNeeded();
await narrow.evaluate(() => window.scrollBy(0, 300));
await narrow.waitForTimeout(150);
await narrow.screenshot({ path: `${outputDir}/narrow-forecast.png` });
await narrow.close();

const desktop = await viewport(1440, 900);
await desktop.goto('http://localhost:5173');
await desktop.waitForTimeout(400);
await desktop.screenshot({ path: `${outputDir}/view-1440.png` });
await desktop.getByRole('button', { name: /Notifications/ }).click();
await desktop.waitForTimeout(300);
await desktop.screenshot({ path: `${outputDir}/menu-notifications.png` });
await desktop.keyboard.press('Escape');
await desktop.getByRole('combobox', { name: /Search projects/ }).fill('abu');
await desktop.waitForTimeout(200);
await desktop.screenshot({ path: `${outputDir}/search-open.png` });
await desktop.keyboard.press('Escape');
await desktop.getByRole('combobox', { name: /Search projects/ }).fill('');
await desktop.getByRole('button', { name: /^Approve MB-1184/ }).click();
await desktop.getByRole('button', { name: /^Decline RQ-3307/ }).click();
const chart = desktop.getByRole('group', { name: /Weekly utilization/ });
const box = (await chart.boundingBox())!;
await desktop.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
await desktop.waitForTimeout(200);
await desktop.screenshot({ path: `${outputDir}/decided-and-tooltip.png` });
await desktop.mouse.move(0, 0);
await desktop.getByRole('button', { name: 'Collapse sidebar' }).click();
await desktop.waitForTimeout(400);
await desktop.getByRole('button', { name: 'Employees' }).hover();
await desktop.screenshot({ path: `${outputDir}/collapsed.png` });
await desktop.reload();
await desktop.waitForTimeout(300);
await desktop.getByRole('button', { name: /Sanbouk Quay Towers, labour/ }).first().click();
await desktop.getByRole('heading', { name: 'Project progress' }).scrollIntoViewIfNeeded();
await desktop.evaluate(() => window.scrollBy(0, 400));
await desktop.waitForTimeout(200);
await desktop.screenshot({ path: `${outputDir}/labour-detail-desktop.png` });
await desktop.close();

const mobile = await viewport(375, 812);
await mobile.goto('http://localhost:5173');
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${outputDir}/mobile-top.png` });
await mobile.getByRole('button', { name: /Notifications/ }).click();
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: `${outputDir}/mobile-notifications.png` });
await mobile.keyboard.press('Escape');
await mobile.getByRole('heading', { name: 'Workforce utilization' }).scrollIntoViewIfNeeded();
await mobile.evaluate(() => window.scrollBy(0, 300));
await mobile.waitForTimeout(200);
await mobile.screenshot({ path: `${outputDir}/mobile-utilization.png` });
await mobile.getByRole('heading', { name: 'Project progress' }).scrollIntoViewIfNeeded();
await mobile.evaluate(() => window.scrollBy(0, 300));
await mobile.waitForTimeout(200);
await mobile.getByRole('button', { name: /Wadi Link Road, Package 3, labour/ }).locator('visible=true').first().click();
await mobile.locator('[id^="labour-P-2433"]').locator('visible=true').first().scrollIntoViewIfNeeded();
await mobile.evaluate(() => window.scrollBy(0, 200));
await mobile.waitForTimeout(200);
await mobile.screenshot({ path: `${outputDir}/mobile-projects.png` });
await mobile.evaluate(() => window.scrollTo(0, 0));
await mobile.getByRole('button', { name: 'Open navigation' }).click();
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: `${outputDir}/mobile-drawer.png` });
await mobile.close();

await browser.close();
