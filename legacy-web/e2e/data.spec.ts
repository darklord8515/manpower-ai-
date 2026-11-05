import { expect, test } from '@playwright/test';
import { UTILIZATION_TARGET } from '../src/config/workforce';
import {
  activities,
  alerts,
  DEMO_NOW,
  mobilizations,
  projects,
  trades,
  TOTAL_PENDING_APPROVALS,
  urgentApprovals,
  utilizationTrend,
  workforceSegments,
} from '../src/data/demo';
import { redeployment, requiredWorkforceByMonth, upcomingTransitions } from '../src/data/forecastSelectors';
import { mobilizationLines, projectLabour, TRADE_KEYS } from '../src/data/labour';
import {
  approvalImpact,
  companyLabourSummary,
  gapLabel,
  peopleToReachTarget,
  projectByCode,
  projectLabourSummary,
  projectTradeRows,
  projectsShort,
  severelyShortCount,
  tradeBalance,
  tradeBalances,
} from '../src/data/labourSelectors';
import { deployedWorkforce, totalWorkforce, utilization, workforceStates } from '../src/data/selectors';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test.describe('demo data reconciles', () => {
  test('the target stays the agreed illustrative placeholder', () => {
    expect(UTILIZATION_TARGET).toBe(85);
  });

  test('project headcount equals deployed workforce', () => {
    expect(sum(projects.map((project) => project.deployed))).toBe(deployedWorkforce);
  });

  test('trade totals equal workforce totals', () => {
    expect(sum(trades.map((trade) => trade.total))).toBe(totalWorkforce);
    expect(sum(trades.map((trade) => trade.deployed))).toBe(deployedWorkforce);
  });

  test('trend ends at the current utilization', () => {
    expect(utilizationTrend.at(-1)!.value).toBeCloseTo(utilization, 1);
  });

  test('the four workforce states account for everyone', () => {
    expect(sum(workforceStates.map((state) => state.count))).toBe(totalWorkforce);
    expect(workforceStates.map((state) => state.key)).toEqual(['deployed', 'mobilizing', 'available', 'unavailable']);
    expect(workforceStates[3].count).toBe(198 + 78);
  });

  test('mobilizing employees match the pending mobilization count', () => {
    expect(workforceSegments.find((segment) => segment.key === 'mobilizing')!.count).toBe(mobilizations.employees);
  });

  test('shown approvals fit within the total', () => {
    expect(urgentApprovals.length).toBeLessThanOrEqual(TOTAL_PENDING_APPROVALS);
    expect(mobilizations.awaitingApproval).toBeLessThanOrEqual(TOTAL_PENDING_APPROVALS);
  });

  test('project status agrees with how far behind plan it is', () => {
    for (const project of projects) {
      const behind = project.planned - project.progress;
      if (project.status === 'on-track') expect(behind, project.name).toBeLessThanOrEqual(2);
      if (project.status !== 'on-track') expect(behind, project.name).toBeGreaterThanOrEqual(5);
    }
  });

  test('each trade accounts for all of its people', () => {
    for (const trade of trades) {
      expect(trade.deployed + trade.mobilizing + trade.available + trade.leave + trade.hold, trade.trade).toBe(trade.total);
    }
  });

  test('trade statuses add up to the workforce segments', () => {
    const segment = (key: string) => workforceSegments.find((item) => item.key === key)!.count;
    expect(sum(trades.map((trade) => trade.mobilizing))).toBe(segment('mobilizing'));
    expect(sum(trades.map((trade) => trade.available))).toBe(segment('available'));
    expect(sum(trades.map((trade) => trade.leave))).toBe(segment('leave'));
    expect(sum(trades.map((trade) => trade.hold))).toBe(segment('hold'));
  });

  test('every project has a labour record that matches its totals', () => {
    expect(Object.keys(projectLabour).sort()).toEqual(projects.map((project) => project.code).sort());
    for (const project of projects) {
      const labour = projectLabour[project.code];
      expect(sum(labour.deployed), project.code).toBe(project.deployed);
      expect(sum(Object.values(labour.gaps)), project.code).toBe(project.required - project.deployed);
    }
  });

  test('deployed by trade adds up across projects', () => {
    TRADE_KEYS.forEach((key, index) => {
      const total = sum(projects.map((project) => projectLabour[project.code].deployed[index]));
      expect(total, key).toBe(trades.find((trade) => trade.key === key)!.deployed);
    });
  });

  test('no trade row has a negative figure', () => {
    for (const project of projects) {
      for (const row of projectTradeRows(project.code)) {
        expect(row.required, project.code + row.key).toBeGreaterThanOrEqual(0);
        expect(row.deployed, project.code + row.key).toBeGreaterThanOrEqual(0);
        expect(row.uncovered, project.code + row.key).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('mobilization lines match the KPI and the trade totals', () => {
    expect(sum(mobilizationLines.map((line) => line.employees))).toBe(mobilizations.employees);
    expect(sum(mobilizationLines.map((line) => line.requests))).toBe(mobilizations.awaitingApproval + mobilizations.inReadiness);
    expect(sum(mobilizationLines.map((line) => line.awaitingApproval))).toBe(mobilizations.awaitingApproval);
    for (const trade of trades) {
      const lines = mobilizationLines.filter((line) => line.trade === trade.key);
      expect(sum(lines.map((line) => line.employees)), trade.key).toBe(trade.mobilizing);
    }
  });

  test('pending coverage never exceeds the shortage it covers', () => {
    for (const project of projects) {
      for (const row of projectTradeRows(project.code)) {
        expect(row.pending, project.code + row.key).toBeLessThanOrEqual(Math.max(row.gap, 0));
      }
    }
  });

  test('company labour totals add up', () => {
    expect(companyLabourSummary).toEqual({ required: 3748, deployed: 3412, short: 345, over: 9, pending: 238, uncovered: 107 });
    expect(companyLabourSummary.short - companyLabourSummary.over).toBe(companyLabourSummary.required - companyLabourSummary.deployed);
    expect(companyLabourSummary.short - companyLabourSummary.pending).toBe(companyLabourSummary.uncovered);
    expect(projectsShort).toBe(15);
    expect(severelyShortCount).toBe(7);
  });

  test('project summaries match the worked example', () => {
    expect(projectLabourSummary('P-2407')).toMatchObject({ required: 468, deployed: 412, short: 56, pending: 34, uncovered: 22 });
    const rows = projectTradeRows('P-2407');
    expect(rows[0]).toMatchObject({ key: 'steel', gap: 34, pending: 34, uncovered: 0 });
    expect(rows[1]).toMatchObject({ key: 'masons', gap: 22, pending: 0, uncovered: 22 });
  });

  test('only equipment operators cannot be filled from people mobilizing and available', () => {
    expect(tradeBalances.filter((balance) => balance.unfilled > 0).map((balance) => balance.key)).toEqual(['operators']);
    expect(tradeBalance('operators')).toMatchObject({ short: 55, mobilizing: 12, available: 38, unfilled: 5 });
    expect(sum(tradeBalances.map((balance) => balance.short))).toBe(345);
  });

  test('people needed to reach the target', () => {
    expect(peopleToReachTarget(deployedWorkforce, totalWorkforce)).toBe(232);
    expect(peopleToReachTarget(4000, 4000)).toBe(0);
  });

  test('gap labels', () => {
    expect(gapLabel(56)).toBe('56 short');
    expect(gapLabel(-4)).toBe('4 over');
    expect(gapLabel(0)).toBe('Fully staffed');
  });

  test('approval titles, readiness and dates are consistent', () => {
    for (const approval of urgentApprovals) {
      expect(Number(approval.title.match(/\d+/)![0]), approval.id).toBe(approval.headcount);
      expect(approval.readiness.total, approval.id).toBe(approval.headcount);
      expect(approval.readiness.ready + sum(approval.readiness.outstanding.map((item) => item.count)), approval.id).toBe(approval.readiness.total);
      expect(Date.parse(approval.requiredOn), approval.id).toBeGreaterThan(Date.parse(DEMO_NOW));
    }
  });

  test('approval impacts are calculated correctly', () => {
    const impact = (id: string) => approvalImpact(urgentApprovals.find((approval) => approval.id === id)!);

    expect(impact('MB-1184').lines).toMatchObject([{ before: 56, after: 22, worsens: false }]);
    expect(impact('MB-1184').risks).toEqual([
      '5 not cleared yet, so they may miss the 9 Nov date.',
      '22 more on this project are short with no request raised.',
    ]);

    expect(impact('MB-1191').lines).toMatchObject([{ before: 57, after: 0, worsens: false }]);

    expect(impact('RQ-3307').lines).toMatchObject([{ before: 79, after: 39, worsens: false }]);
    expect(impact('RQ-3307').risks[0]).toBe('38 company equipment operators are available today. Using them first would reduce this hire.');

    expect(impact('TR-0218').lines).toMatchObject([
      { code: 'P-2418', before: 53, after: 41, worsens: false },
      { code: 'P-2416', before: 3, after: 15, worsens: true },
    ]);

    expect(impact('DM-0427').lines).toMatchObject([{ code: 'P-2395', before: -4, after: 24, worsens: true }]);
    expect(impact('DM-0427').risks[0]).toBe('Arish Residences, Block 4 would be 24 short, 8 weeks before handover.');
  });

  test('a transfer source has enough of that trade to send', () => {
    const transfer = urgentApprovals.find((approval) => approval.id === 'TR-0218')!;
    const source = projectTradeRows(transfer.sourceProject!).find((row) => row.key === transfer.trade)!;
    expect(source.deployed).toBeGreaterThanOrEqual(transfer.headcount);
  });

  test('figures quoted in alerts match the data', () => {
    const text = alerts.map((alert) => `${alert.title} ${alert.detail}`).join(' ');
    const wadi = projectByCode('P-2433');
    expect(text).toContain(`is ${wadi.required - wadi.deployed} people short`);
    expect(text).toContain(`${wadi.planned - wadi.progress} points behind plan`);
    expect(text).toContain(`${workforceSegments.find((segment) => segment.key === 'hold')!.count} employees cannot deploy`);
    expect(text).toContain(`${projectByCode('P-2398').deployed} people still on site`);
  });

  test('calculations are repeatable', () => {
    const run = () => JSON.stringify(urgentApprovals.map(approvalImpact));
    expect(run()).toBe(run());
  });

  test('demo data contains no real-looking source references', () => {
    const text = JSON.stringify({ projects, urgentApprovals, alerts, activities });
    expect(text).not.toMatch(/excel|\.xlsx|spreadsheet/i);
  });

  test('required workforce falls only as projects hand over', () => {
    expect(requiredWorkforceByMonth.map((point) => point.value)).toEqual([3748, 3523, 3273, 3123, 2763, 2538]);
    expect(requiredWorkforceByMonth[0].value).toBe(companyLabourSummary.required);
  });

  test('redeployment figures reconcile', () => {
    expect(redeployment.projects.map((project) => project.code)).toEqual(['P-2398', 'P-2395']);
    expect(redeployment.releasing).toBe(126 + 104);
    expect(redeployment.matches).toBeGreaterThan(0);
    expect(redeployment.matches).toBeLessThanOrEqual(redeployment.releasing);
    expect(redeployment.matches + redeployment.remaining).toBe(companyLabourSummary.uncovered);
  });

  test('transitions are in date order and release the people on site', () => {
    const transitions = upcomingTransitions(4);
    const dates = transitions.map((item) => item.project.handover);
    expect(dates).toEqual([...dates].sort());
    for (const item of transitions) expect(item.releasing).toBe(item.project.deployed);
  });

  test('activity is in reverse time order', () => {
    const times = activities.map((activity) => activity.at);
    expect(times).toEqual([...times].sort().reverse());
  });
});
