/**
 * Deterministic projections from the fictional demo data. These are fixed rules, not an AI model:
 * they add no new source figures, and "today" is DEMO_NOW.
 */
import { DEMO_NOW, projects } from './demo';
import { projectLabour, TRADE_KEYS } from './labour';
import { projectTradeRows } from './labourSelectors';
import type { Project, UtilizationPoint } from './types';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const DAY_MS = 86_400_000;

export const FORECAST_HORIZON_DAYS = 60;

const byHandover = [...projects].sort((a, b) => a.handover.localeCompare(b.handover));

export interface Transition {
  project: Project;
  /** People on site today, who are released when the project hands over. */
  releasing: number;
}

export const upcomingTransitions = (count: number): Transition[] =>
  byHandover.slice(0, count).map((project) => ({ project, releasing: project.deployed }));

const horizonEnd = Date.parse(DEMO_NOW) + FORECAST_HORIZON_DAYS * DAY_MS;
const handingOverSoon = byHandover.filter((project) => Date.parse(project.handover) <= horizonEnd);

const releasingOfTrade = (index: number) => sum(handingOverSoon.map((project) => projectLabour[project.code].deployed[index]));

const uncoveredOfTrade = (key: (typeof TRADE_KEYS)[number]) =>
  sum(projects.map((project) => projectTradeRows(project.code).find((row) => row.key === key)?.uncovered ?? 0));

/** People released soon whose trade matches a shortage that has no request raised. */
const matchByTrade = TRADE_KEYS.map((key, index) => Math.min(releasingOfTrade(index), uncoveredOfTrade(key)));

const uncoveredTotal = sum(TRADE_KEYS.map(uncoveredOfTrade));

export const redeployment = {
  projects: handingOverSoon,
  releasing: sum(handingOverSoon.map((project) => project.deployed)),
  matches: sum(matchByTrade),
  remaining: uncoveredTotal - sum(matchByTrade),
};

/** Month-end dates, starting with the current month. */
const MONTH_ENDS = ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'];

/** Labour still required at each month end, if every project hands over on time and none start. */
export const requiredWorkforceByMonth: UtilizationPoint[] = MONTH_ENDS.map((monthEnd) => ({
  week: monthEnd,
  value: sum(projects.filter((project) => project.handover > monthEnd).map((project) => project.required)),
}));
