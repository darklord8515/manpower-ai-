/**
 * Deterministic calculations over the fictional demo data. No randomness, no clock: "today" is DEMO_NOW.
 */
import { UTILIZATION_TARGET } from '../config/workforce';
import { formatDayMonth, formatInt } from '../lib/format';
import { DEMO_NOW, projects, trades, urgentApprovals } from './demo';
import { mobilizationLines, projectLabour, TRADE_KEYS } from './labour';
import type { Approval, Project, TradeKey } from './types';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const DAY_MS = 86_400_000;

export function projectByCode(code: string): Project {
  const project = projects.find((candidate) => candidate.code === code);
  if (!project) throw new Error(`Unknown project ${code}`);
  return project;
}

export const tradeName = (key: TradeKey) => trades.find((trade) => trade.key === key)!.trade;

/** "56 short", "4 over" or "Fully staffed", for a required-minus-deployed gap. */
export function gapLabel(gap: number) {
  if (gap === 0) return 'Fully staffed';
  return gap > 0 ? `${formatInt(gap)} short` : `${formatInt(-gap)} over`;
}

/* ---------- Pending coverage ---------- */

export interface CoverageSource {
  employees: number;
  label: string;
}

/** Approvals that would add people but aren't mobilizations already counted in mobilizationLines. */
const otherCoveringApprovals = urgentApprovals.filter(
  (approval) => (approval.kind === 'Labour hire' || approval.kind === 'Transfer') && approval.trade,
);

export function coverageSources(code: string, trade: TradeKey): CoverageSource[] {
  const fromMobilizations = mobilizationLines
    .filter((line) => line.project === code && line.trade === trade)
    .map((line) => ({
      employees: line.employees,
      label: line.reference ?? `${line.requests} mobilization ${line.requests === 1 ? 'request' : 'requests'}`,
    }));
  const fromApprovals = otherCoveringApprovals
    .filter((approval) => approval.project === code && approval.trade === trade)
    .map((approval) => ({ employees: approval.headcount, label: approval.id }));
  return [...fromMobilizations, ...fromApprovals];
}

/* ---------- Project labour ---------- */

export interface TradeLabourRow {
  key: TradeKey;
  trade: string;
  required: number;
  deployed: number;
  /** Required minus deployed. Negative means over-staffed. */
  gap: number;
  pending: number;
  /** Shortage that no pending request would fill. */
  uncovered: number;
  sources: CoverageSource[];
}

export function projectTradeRows(code: string): TradeLabourRow[] {
  const labour = projectLabour[code];
  return TRADE_KEYS.map((key, index) => {
    const deployed = labour.deployed[index];
    const gap = labour.gaps[key] ?? 0;
    const sources = coverageSources(code, key);
    const pending = sum(sources.map((source) => source.employees));
    return {
      key,
      trade: tradeName(key),
      required: deployed + gap,
      deployed,
      gap,
      pending,
      uncovered: Math.max(gap - pending, 0),
      sources,
    };
  })
    .filter((row) => row.required > 0 || row.deployed > 0)
    .sort((a, b) => b.gap - a.gap || b.required - a.required);
}

export interface LabourSummary {
  required: number;
  deployed: number;
  short: number;
  over: number;
  pending: number;
  uncovered: number;
}

function summarize(rows: TradeLabourRow[]): LabourSummary {
  return {
    required: sum(rows.map((row) => row.required)),
    deployed: sum(rows.map((row) => row.deployed)),
    short: sum(rows.map((row) => Math.max(row.gap, 0))),
    over: sum(rows.map((row) => Math.max(-row.gap, 0))),
    pending: sum(rows.map((row) => row.pending)),
    uncovered: sum(rows.map((row) => row.uncovered)),
  };
}

export const projectLabourSummary = (code: string) => summarize(projectTradeRows(code));

export const companyLabourSummary: LabourSummary = summarize(projects.flatMap((project) => projectTradeRows(project.code)));

export const projectsShort = projects.filter((project) => project.required > project.deployed).length;
export const isSeverelyShort = (project: Project) => (project.required - project.deployed) / project.required >= 0.1;
export const severelyShortCount = projects.filter(isSeverelyShort).length;

/* ---------- Trade balance ---------- */

export interface TradeBalance {
  key: TradeKey;
  short: number;
  available: number;
  mobilizing: number;
  /** Shortage that the people mobilizing and available could not fill. */
  unfilled: number;
}

export const tradeBalances: TradeBalance[] = trades.map((trade) => {
  const index = TRADE_KEYS.indexOf(trade.key);
  const short = sum(projects.map((project) => Math.max(projectLabour[project.code].gaps[TRADE_KEYS[index]] ?? 0, 0)));
  return {
    key: trade.key,
    short,
    available: trade.available,
    mobilizing: trade.mobilizing,
    unfilled: Math.max(short - trade.mobilizing - trade.available, 0),
  };
});

export const tradeBalance = (key: TradeKey) => tradeBalances.find((balance) => balance.key === key)!;

/* ---------- Utilization vs shortage ---------- */

export const peopleToReachTarget = (deployed: number, total: number) =>
  Math.max(Math.ceil((UTILIZATION_TARGET / 100) * total - deployed), 0);

/* ---------- Approval impact ---------- */

export interface ImpactLine {
  code: string;
  name: string;
  before: number;
  after: number;
  /** True when this decision makes the project's staffing worse. */
  worsens: boolean;
}

export interface ApprovalImpact {
  lines: ImpactLine[];
  risks: string[];
}

function impactLine(code: string, change: number): ImpactLine {
  const project = projectByCode(code);
  const before = project.required - project.deployed;
  const after = before - change;
  return { code, name: project.name, before, after, worsens: after > before && after > 0 };
}

export const weeksUntil = (iso: string) => Math.floor((Date.parse(iso) - Date.parse(DEMO_NOW)) / (7 * DAY_MS));

export function approvalImpact(approval: Approval): ApprovalImpact {
  const adds = approval.effect === 'adds';
  const lines = [impactLine(approval.project, adds ? approval.headcount : -approval.headcount)];
  if (approval.sourceProject) lines.push(impactLine(approval.sourceProject, -approval.headcount));

  const risks: string[] = [];
  for (const line of lines) {
    if (!line.worsens) continue;
    const weeks = weeksUntil(projectByCode(line.code).handover);
    risks.push(`${line.name} would be ${formatInt(line.after)} short, ${weeks} weeks before handover.`);
  }

  if (approval.kind === 'Labour hire' && approval.trade) {
    const available = tradeBalance(approval.trade).available;
    risks.push(
      `${formatInt(available)} company ${tradeName(approval.trade).toLowerCase()} are available today. Using them first would reduce this hire.`,
    );
  } else {
    const notReady = approval.readiness.total - approval.readiness.ready;
    if (notReady > 0) {
      risks.push(`${formatInt(notReady)} not cleared yet, so they may miss the ${formatDayMonth(approval.requiredOn)} date.`);
    }
  }

  const uncovered = adds ? projectLabourSummary(approval.project).uncovered : 0;
  if (uncovered > 0) {
    risks.push(`${formatInt(uncovered)} more on this project are short with no request raised.`);
  }

  return { lines, risks };
}
