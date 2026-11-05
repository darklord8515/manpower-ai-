import type { MobilizationLine, ProjectLabour } from './types';

/**
 * Fictional demonstration data, invented for this demo. It does not come from any company file.
 *
 * `deployed` lists people on site by trade, in the order of `TRADE_KEYS`.
 * `gaps` lists required minus deployed for each trade that differs. Negative means over-staffed.
 * e2e/data.spec.ts checks that every row and column reconciles with the project and trade totals.
 */
export const TRADE_KEYS = ['steel', 'masons', 'carpenters', 'mep', 'engineers', 'operators', 'general'] as const;

export const projectLabour: Record<string, ProjectLabour> = {
  'P-2407': { deployed: [134, 42, 103, 14, 40, 22, 57], gaps: { steel: 34, masons: 22 } },
  'P-2411': { deployed: [7, 27, 19, 178, 54, 9, 62], gaps: { engineers: 4 } },
  'P-2418': { deployed: [5, 42, 54, 97, 36, 5, 48], gaps: { mep: 41, engineers: 12 } },
  'P-2402': { deployed: [4, 100, 46, 33, 25, 4, 36], gaps: { masons: 2 } },
  'P-2425': { deployed: [76, 24, 58, 8, 23, 12, 32], gaps: { carpenters: 57 } },
  'P-2429': { deployed: [104, 32, 79, 11, 31, 17, 44], gaps: { carpenters: 2 } },
  'P-2414': { deployed: [18, 46, 19, 18, 17, 12, 34], gaps: { general: -4 } },
  'P-2433': { deployed: [0, 7, 5, 5, 32, 74, 73], gaps: { operators: 40, general: 39 } },
  'P-2409': { deployed: [12, 40, 35, 32, 30, 18, 54], gaps: { carpenters: 4 } },
  'P-2404': { deployed: [3, 21, 26, 48, 18, 2, 24], gaps: { mep: 3, engineers: 5 } },
  'P-2398': { deployed: [2, 51, 24, 16, 13, 2, 18], gaps: { general: -1 } },
  'P-2421': { deployed: [38, 12, 30, 4, 11, 6, 17], gaps: { masons: 14, general: 8 } },
  'P-2416': { deployed: [3, 10, 7, 68, 21, 4, 24], gaps: { mep: 3 } },
  'P-2438': { deployed: [46, 16, 23, 3, 12, 11, 18], gaps: { general: 1 } },
  'P-2395': { deployed: [2, 42, 19, 14, 11, 1, 15], gaps: { general: -4 } },
  'P-2420': { deployed: [2, 7, 5, 43, 13, 2, 15], gaps: { mep: 23 } },
  'P-2431': { deployed: [12, 11, 8, 7, 9, 7, 14], gaps: { mep: 12, operators: 15 } },
  'P-2440': { deployed: [23, 8, 12, 2, 6, 6, 9], gaps: { masons: 4 } },
};

/** The 37 pending mobilization requests, grouped by project and trade. */
export const mobilizationLines: MobilizationLine[] = [
  { project: 'P-2407', trade: 'steel', employees: 34, requests: 1, awaitingApproval: 1, reference: 'MB-1184' },
  { project: 'P-2425', trade: 'carpenters', employees: 57, requests: 1, awaitingApproval: 1, reference: 'MB-1191' },
  { project: 'P-2421', trade: 'masons', employees: 14, requests: 3, awaitingApproval: 1 },
  { project: 'P-2440', trade: 'masons', employees: 4, requests: 1, awaitingApproval: 0 },
  { project: 'P-2418', trade: 'mep', employees: 20, requests: 5, awaitingApproval: 2 },
  { project: 'P-2420', trade: 'mep', employees: 10, requests: 3, awaitingApproval: 1 },
  { project: 'P-2411', trade: 'engineers', employees: 4, requests: 2, awaitingApproval: 1 },
  { project: 'P-2404', trade: 'engineers', employees: 5, requests: 2, awaitingApproval: 0 },
  { project: 'P-2431', trade: 'operators', employees: 12, requests: 4, awaitingApproval: 2 },
  { project: 'P-2433', trade: 'general', employees: 26, requests: 15, awaitingApproval: 5 },
];
