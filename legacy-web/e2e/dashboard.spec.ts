import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const projectsPanel = (page: Page) => page.getByRole('region', { name: 'Project progress' });
const approvalsPanel = (page: Page) => page.getByRole('region', { name: 'Pending approvals' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Executive dashboard', level: 1 })).toBeVisible();
});

test('shows every section in the brief, with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();

  const figures = page.getByRole('region', { name: 'Key figures' });
  await expect(figures).toContainText('Active projects');
  await expect(figures).toContainText('18');
  await expect(figures).toContainText('Total workforce');
  await expect(figures).toContainText('4,286');
  await expect(figures).toContainText('Employees deployed');
  await expect(figures).toContainText('3,412');
  await expect(figures).toContainText('Pending mobilizations');
  await expect(figures).toContainText('37');

  for (const name of [
    'Workforce utilization',
    'Project progress',
    'Pending approvals',
    'Key alerts',
    'AI Workforce Forecast',
    'Project timeline and workforce demand',
    'Upcoming project transitions',
    'Recent activity',
  ]) {
    await expect(page.getByRole('region', { name })).toBeVisible();
  }
  await expect(page.locator('main footer')).toContainText('fictional and do not represent company data');
  await expect(page.locator('main footer')).toContainText('not an approved company target');
  await expect(page).toHaveTitle('Executive dashboard (Demo) | CONSTRUCTIQ');
  expect(errors).toEqual([]);
});

test('sidebar collapses, remembers its state and shows tooltips', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'Primary' });
  const before = (await sidebar.boundingBox())!.width;
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(before);
  await expect(sidebar.getByText('Mobilization', { exact: true })).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'Employees' }).hover();
  await expect(sidebar.getByText('Employees')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(sidebar.getByText('Mobilization', { exact: true })).toBeVisible();
});

test('unbuilt navigation says so instead of pretending', async ({ page }) => {
  await page.getByRole('button', { name: 'Employees' }).click();
  await expect(page.getByRole('status')).toContainText('Employees isn’t part of this build yet.');
  await expect(page.getByRole('button', { name: 'Executive dashboard' })).toHaveAttribute('aria-current', 'page');
});

test('workforce shows four states with counts and shares', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Workforce utilization' });
  const states = panel.getByRole('list', { name: 'Workforce by status' }).getByRole('listitem');
  await expect(states).toHaveCount(4);
  await expect(states.nth(0)).toContainText('Deployed');
  await expect(states.nth(0)).toContainText('3,412');
  await expect(states.nth(0)).toContainText('79.6%');
  await expect(states.nth(1)).toContainText('Mobilizing');
  await expect(states.nth(1)).toContainText('186');
  await expect(states.nth(2)).toContainText('Available');
  await expect(states.nth(2)).toContainText('412');
  await expect(states.nth(3)).toContainText('Unavailable');
  await expect(states.nth(3)).toContainText('276');
  await expect(states.nth(3)).toContainText('198 on leave');
  await expect(states.nth(3)).toContainText('78 on visa or medical hold');
  await expect(panel.getByRole('img', { name: /Workforce status: 3,412 deployed/ })).toBeVisible();
});

for (const width of [1440, 375, 320]) {
  test(`every workforce segment is at least 6px wide at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const widths = await page
      .getByRole('img', { name: /Workforce status/ })
      .locator('span')
      .evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().width));
    expect(widths).toHaveLength(5);
    for (const segment of widths) expect(segment).toBeGreaterThanOrEqual(6);
  });
}

test('labour table headers line up with their figures', async ({ page }) => {
  const panel = projectsPanel(page);
  await panel.getByRole('button', { name: /Sanbouk Quay Towers, labour/ }).first().click();
  const detail = panel.locator('#labour-P-2407');
  const header = (await detail.getByRole('columnheader', { name: 'Required' }).boundingBox())!;
  const cell = (await detail.getByRole('row', { name: /Steel fixers/ }).getByRole('cell').first().boundingBox())!;
  expect(Math.abs(header.x + header.width - (cell.x + cell.width))).toBeLessThan(2);
});

test('sidebar is charcoal, with four groups and a clear current page', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'Primary' });
  await expect(sidebar).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  for (const group of ['Operations', 'Planning', 'Analytics', 'Administration']) {
    await expect(sidebar.getByRole('list', { name: group })).toBeVisible();
  }
  const current = sidebar.getByRole('button', { name: 'Executive dashboard' });
  await expect(current).toHaveCSS('color', 'rgb(184, 32, 46)');
  await expect(current).toHaveCSS('background-color', 'rgb(252, 235, 237)');
  await expect(sidebar.getByRole('button', { name: 'Reports' })).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('curved workspace edge follows the sidebar and the screen', async ({ page }) => {
  const corners = page.locator('[class*="corner"]');
  await expect(corners).toHaveCount(2);
  const edges = async () => {
    const boxes = await corners.evaluateAll((items) => items.map((item) => item.getBoundingClientRect()).map((r) => ({ x: r.x, top: r.top, bottom: r.bottom })));
    return boxes;
  };
  let [top, bottom] = await edges();
  expect(top.x).toBe(248);
  expect(top.top).toBe(0);
  expect(bottom.bottom).toBe(900);

  await page.evaluate(() => window.scrollTo(0, 700));
  [top, bottom] = await edges();
  expect(top.top).toBe(0);
  expect(bottom.bottom).toBe(900);

  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.waitForTimeout(400);
  [top] = await edges();
  expect(top.x).toBe(68);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  expect(before).toBeGreaterThan(0);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(corners).toHaveCount(0);
});

for (const width of [1440, 1280, 768, 375, 320]) {
  test(`KPI figures and bars line up across cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const cards = page.getByRole('region', { name: 'Key figures' }).locator('dl > div');
    await expect(cards).toHaveCount(6);
    const rows = await cards.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        const bar = item.querySelector('[data-size="sm"]')!.getBoundingClientRect();
        return { top: Math.round(box.top), height: Math.round(box.height), bar: Math.round(bar.top) };
      }),
    );
    for (const card of rows) {
      const sameRow = rows.filter((other) => other.top === card.top);
      for (const other of sameRow) {
        expect(other.height).toBe(card.height);
        expect(other.bar).toBe(card.bar);
      }
    }
  });
}

test('forecast states that no AI model is connected', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'AI Workforce Forecast' });
  await expect(panel).toContainText('Demo');
  await expect(panel).toContainText('No AI model is connected');
  await expect(panel).toContainText('Oasis Schools Package');
  await expect(panel).toContainText('230');
  await expect(panel.getByRole('button')).toHaveCount(0);
  await expect(panel.getByRole('link')).toHaveCount(0);
});

test('timeline and transitions show figures derived from the demo data', async ({ page }) => {
  const timeline = page.getByRole('region', { name: 'Project timeline and workforce demand' });
  await expect(timeline).toContainText('Deployed today (3,412)');
  await expect(timeline).toContainText('no new projects start');
  await expect(timeline.getByRole('group', { name: /falling from 3,748 to 2,538/ })).toBeVisible();

  const transitions = page.getByRole('region', { name: 'Upcoming project transitions' });
  const items = transitions.getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('Oasis Schools Package');
  await expect(items.first()).toContainText('20 Dec');
  await expect(items.first()).toContainText('126 releasing');
});

for (const width of [1440, 1280, 768, 375, 320]) {
  test(`chart date labels do not collide at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const charts = page.locator('svg[role="group"]');
    await expect(charts).toHaveCount(2);
    for (const chart of await charts.all()) {
      const boxes = await chart.locator('text[text-anchor="middle"]').evaluateAll((labels) =>
        labels.map((label) => label.getBoundingClientRect()).map((box) => ({ left: box.left, right: box.right })),
      );
      expect(boxes.length).toBeGreaterThan(1);
      for (let index = 1; index < boxes.length; index++) expect(boxes[index].left).toBeGreaterThan(boxes[index - 1].right);
    }
  });
}

for (const width of [768, 375, 320]) {
  test(`header controls stay on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(200);
    const search = (await page.getByRole('combobox', { name: /Search projects/ }).boundingBox())!;
    const bell = (await page.getByRole('button', { name: /Notifications/ }).boundingBox())!;
    expect(Math.abs(search.y + search.height / 2 - (bell.y + bell.height / 2))).toBeLessThan(4);
    const header = (await page.locator('main').locator('..').locator('header').first().boundingBox())!;
    expect(header.height).toBeLessThanOrEqual(width < 640 ? 85 : 61);
  });
}

test('workforce summary shows coverage', async ({ page }) => {
  const panel = projectsPanel(page);
  await expect(panel).toContainText('90.8% of required roles filled');
  await expect(panel.getByRole('img', { name: /3,403 of 3,748 required roles filled/ })).toBeVisible();
});

test('labour totals are shown above the project table', async ({ page }) => {
  const summary = projectsPanel(page).getByLabel('Labour across all projects');
  for (const text of ['3,748', '3,412', '345', 'on 15 projects', '238', '107']) await expect(summary).toContainText(text);
});

test('the 10%+ short filter finds the seven projects', async ({ page }) => {
  const panel = projectsPanel(page);
  await panel.getByRole('button', { name: /^10%\+ short/ }).click();
  await expect(panel.locator('tbody tr')).toHaveCount(7);
  await expect(panel.locator('tbody')).toContainText('Wadi Link Road');
  await expect(panel.locator('tbody')).not.toContainText('Ghaf Grove Villas');
});

test('a project row expands to show labour by trade, by mouse and keyboard', async ({ page }) => {
  const panel = projectsPanel(page);
  const button = panel.getByRole('button', { name: /Sanbouk Quay Towers, labour by trade/ }).first();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  const detail = panel.locator('#labour-P-2407');
  await expect(detail).toBeVisible();
  const row = (name: string) => detail.getByRole('row', { name: new RegExp(name) });
  await expect(row('Steel fixers').getByRole('cell')).toHaveText(['168', '134', '34', '34', '0']);
  await expect(row('Masons').getByRole('cell')).toHaveText(['64', '42', '22', '0', '22']);
  await expect(row('Total').getByRole('cell')).toHaveText(['468', '412', '56', '34', '22']);
  await expect(detail).toContainText('MB-1184 (34)');
  await expect(detail).toContainText('doesn’t change with decisions made on this page');

  await button.focus();
  await page.keyboard.press('Enter');
  await expect(detail).toHaveCount(0);
});

test('several rows can be open, and an over-staffed project reads correctly', async ({ page }) => {
  const panel = projectsPanel(page);
  await panel.getByRole('button', { name: /Show 8 more/ }).click();
  await panel.getByRole('button', { name: /Arish Residences, Block 4, labour/ }).first().click();
  await panel.getByRole('button', { name: /Wadi Link Road, Package 3, labour/ }).first().click();
  await expect(panel.locator('#labour-P-2395')).toContainText('4 over');
  await expect(panel.locator('#labour-P-2433')).toContainText('RQ-3307 (40)');
  await expect(panel.locator('#labour-P-2433')).toContainText('15 mobilization requests (26)');
});

test('utilization explains why available people may not fill the shortage', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Workforce utilization' });
  await expect(panel).toContainText('Projects are 345 short across 15 sites, and 412 people are available.');
  await expect(panel).toContainText('178 of them are general labour');
  await expect(panel).toContainText('equipment operators would still be 5 short');
  const operators = panel.getByRole('listitem').filter({ hasText: 'Equipment operators' });
  await expect(operators).toContainText('55 short');
  await expect(operators).toContainText('12 mobilizing');
  await expect(operators).toContainText('38 available');
  await expect(panel).toContainText('5 can’t be filled internally');
  await expect(panel).toContainText('not an approved company target');
});

test('approvals show impact, date, readiness and consequences, with no costs', async ({ page }) => {
  const panel = approvalsPanel(page);
  await expect(panel).toContainText('Sanbouk Quay Towers: 56 short to 22 short');
  await expect(panel).toContainText('On site by 9 Nov. Ready: 29 of 34 (3 visas, 2 medicals outstanding).');
  await expect(panel).toContainText('22 more on this project are short with no request raised.');
  await expect(panel).toContainText('Barajeel Mixed-Use Development: 57 short to fully staffed');
  await expect(panel).toContainText('38 company equipment operators are available today.');
  await expect(panel).toContainText('Dune Park Industrial Units: 3 short to 15 short');
  await expect(panel).toContainText('All 12 ready');
  await expect(panel).toContainText('Arish Residences, Block 4: 4 over to 24 short');
  await expect(panel).toContainText('Released by 7 Nov');
  await expect(panel).toContainText('Arish Residences, Block 4 would be 24 short, 8 weeks before handover.');
  await expect(panel).not.toContainText(/AED|Dh\b|cost/i);
});

for (const width of [1440, 768, 375, 320]) {
  test(`no overflow with labour detail open at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const panel = projectsPanel(page);
    const button = panel.getByRole('button', { name: /Wadi Link Road, Package 3, labour/ }).locator('visible=true').first();
    await button.click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const clipped = await panel.locator('[id^="labour-P-2433"] :is(th, td)').locator('visible=true').evaluateAll((cells) =>
      cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => cell.textContent),
    );
    expect(clipped).toEqual([]);
  });
}

test('project table filters, sorts and expands', async ({ page }) => {
  const panel = projectsPanel(page);
  const rows = panel.locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Umm Al Quwain');
  await expect(panel.locator('tbody tr[data-project="P-2404"]')).toContainText(/−1 pt(?!s)/);

  await panel.getByRole('button', { name: /Show 8 more/ }).click();
  await expect(rows).toHaveCount(18);

  await panel.getByRole('button', { name: /^Delayed/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(panel.locator('tbody')).not.toContainText('On track');

  await panel.getByRole('button', { name: /^All/ }).click();
  const project = panel.getByRole('button', { name: 'Project', exact: true });
  await project.click();
  await expect(rows.first()).toContainText('Arish Residences');
  await expect(panel.getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'ascending');
  await project.click();
  await expect(rows.first()).toContainText('Zafran Community Centre');
});

test('search finds a project and reveals it, even when filtered out', async ({ page }) => {
  const panel = projectsPanel(page);
  await panel.getByRole('button', { name: /^Delayed/ }).click();
  await expect(panel.locator('tbody tr')).toHaveCount(3);

  const search = page.getByRole('combobox', { name: /Search projects/ });
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.fill('ghaf');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');

  const row = panel.locator('tbody tr[data-project="P-2402"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-highlight', 'true');
  await expect(row).toBeInViewport();

  await search.fill('zzz');
  await expect(page.getByText('No projects match “zzz”')).toBeVisible();
});

test('approving is reversible, updates the counts and keeps focus', async ({ page }) => {
  const panel = approvalsPanel(page);
  await expect(page.getByText('21 approvals are waiting')).toBeVisible();

  await panel.getByRole('button', { name: /^Approve MB-1184/ }).click();
  await expect(panel).toContainText('Approved MB-1184');
  await expect(page.getByText('20 approvals are waiting')).toBeVisible();
  const undo = panel.getByRole('button', { name: 'Undo decision on MB-1184' });
  await expect(undo).toBeFocused();

  await undo.click();
  await expect(page.getByText('21 approvals are waiting')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Approve MB-1184/ })).toBeFocused();
  await expect(panel).toContainText('session only');
});

test('notifications open, mark read, and close on Escape', async ({ page }) => {
  const bell = page.getByRole('button', { name: 'Notifications, 3 unread' });
  await bell.click();
  const menu = page.getByRole('region', { name: 'Notifications' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('profile menu states that accounts are not built', async ({ page }) => {
  await page.getByRole('button', { name: /profile menu/ }).click();
  await expect(page.getByRole('region', { name: 'Profile' })).toContainText('aren’t built yet');
});

test('trend chart answers to pointer and keyboard', async ({ page }) => {
  const chart = page.getByRole('group', { name: /Weekly utilization/ });
  await chart.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/^Week of /).first()).toBeVisible();
  await page.mouse.move(0, 0);

  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Week of 26 Oct').first()).toBeAttached();
});

for (const width of [1920, 1440, 1280, 1024, 768, 375, 320]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test(`demo label stays on screen after scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect(page.getByText('Fictional Demo Data', { exact: true })).toBeInViewport();
  });

  test(`approval buttons work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const panel = approvalsPanel(page);
    await panel.getByRole('button', { name: /^Decline TR-0218/ }).click();
    await expect(panel).toContainText('Declined TR-0218');
    await panel.getByRole('button', { name: 'Undo decision on TR-0218' }).click();
    const approve = panel.getByRole('button', { name: /^Approve TR-0218/ });
    const decline = panel.getByRole('button', { name: /^Decline TR-0218/ });
    const [a, d] = [(await approve.boundingBox())!, (await decline.boundingBox())!];
    expect(Math.abs(a.y - d.y)).toBeLessThan(2);
  });
}

test('handover stays visible when the column has no room', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await expect(projectsPanel(page).locator('tbody tr').first()).toContainText('Handover');
});

test('the trend and trade charts sit side by side at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const panel = page.getByRole('region', { name: 'Workforce utilization' });
  const trend = (await panel.getByRole('heading', { name: 'Last 12 weeks' }).boundingBox())!;
  const trade = (await panel.getByRole('heading', { name: /By trade/ }).boundingBox())!;
  expect(Math.abs(trend.y - trade.y)).toBeLessThan(2);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('tapping the trend chart shows a reading, and tapping elsewhere clears it', async ({ page }) => {
    const chart = page.getByRole('group', { name: /Weekly utilization/ });
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const tooltip = page.locator('[class*="tooltip"]').filter({ hasText: 'Week of' });
    await expect(tooltip).toBeVisible();
    await page.getByRole('heading', { name: 'Workforce utilization' }).tap();
    await expect(tooltip).toHaveCount(0);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('phones show 5 projects first, with the rest one tap away', async ({ page }) => {
    const panel = projectsPanel(page);
    await expect(panel.locator('li[data-project]')).toHaveCount(5);
    await panel.getByRole('button', { name: /Show 13 more/ }).click();
    await expect(panel.locator('li[data-project]')).toHaveCount(18);
  });

  test('drawer opens, traps the page behind it, and closes on Escape', async ({ page }) => {
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await menu.click();
    const close = page.getByRole('button', { name: 'Close navigation' });
    await expect(close).toBeFocused();
    await expect(page.locator('main').locator('..')).toHaveAttribute('inert');
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(page.locator('main').locator('..')).not.toHaveAttribute('inert');
  });

  test('projects switch to a list, and approvals come before analysis', async ({ page }) => {
    const panel = projectsPanel(page);
    await expect(panel.locator('table')).toBeHidden();
    await expect(panel.locator('li[data-project]').first()).toBeVisible();

    const approvals = (await approvalsPanel(page).boundingBox())!;
    const utilization = (await page.getByRole('region', { name: 'Workforce utilization' }).boundingBox())!;
    expect(approvals.y).toBeLessThan(utilization.y);
  });

  test('interactive targets are at least 24px', async ({ page }) => {
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main button, header button, main input'))
        .filter((element) => (element as HTMLElement).getClientRects().length > 0)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.height < 24 || rect.width < 24;
        })
        .map((element) => element.textContent),
    );
    expect(small).toEqual([]);
  });
});

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 375, height: 812 }],
] as const) {
  test(`no accessibility violations on ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page }).analyze();
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(' ')).slice(0, 4),
    }));
    expect(summary).toEqual([]);
  });
}
