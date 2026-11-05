/**
 * Fictional demonstration data. Every name, project, figure and date here is invented for this
 * demo. None of it comes from company records or files.
 * Totals are kept consistent on purpose: e2e/data.spec.ts checks that they reconcile.
 */
import type {
  Activity,
  Approval,
  AppNotification,
  OperationalAlert,
  Project,
  TradeUtilization,
  UtilizationPoint,
  WorkforceSegment,
} from './types';

export const DEMO_NOW = '2026-11-04T09:40:00Z';

export const currentUser = {
  firstName: 'Rashid',
  fullName: 'Rashid Example',
  role: 'Chief Operating Officer (demo)',
  initials: 'RE',
};

export const projects: Project[] = [
  { code: 'P-2407', name: 'Sanbouk Quay Towers', emirate: 'Abu Dhabi', phase: 'Structure', progress: 58, planned: 64, deployed: 412, required: 468, handover: '2027-08-31', status: 'at-risk' },
  { code: 'P-2411', name: 'Oryx Gate Logistics Park, Phase 2', emirate: 'Dubai', phase: 'MEP', progress: 71, planned: 70, deployed: 356, required: 360, handover: '2027-03-31', status: 'on-track' },
  { code: 'P-2418', name: 'Samar Medical Centre', emirate: 'Abu Dhabi', phase: 'Fit-out', progress: 62, planned: 74, deployed: 287, required: 340, handover: '2027-06-30', status: 'delayed' },
  { code: 'P-2402', name: 'Ghaf Grove Villas, Cluster C', emirate: 'Abu Dhabi', phase: 'Finishes', progress: 83, planned: 81, deployed: 248, required: 250, handover: '2027-01-31', status: 'on-track' },
  { code: 'P-2425', name: 'Barajeel Mixed-Use Development', emirate: 'Sharjah', phase: 'Structure', progress: 41, planned: 48, deployed: 233, required: 290, handover: '2027-12-15', status: 'at-risk' },
  { code: 'P-2429', name: 'Sidr Staff Village', emirate: 'Dubai', phase: 'Structure', progress: 36, planned: 35, deployed: 318, required: 320, handover: '2028-02-29', status: 'on-track' },
  { code: 'P-2414', name: 'Dhow Point Cold Storage', emirate: 'Abu Dhabi', phase: 'Envelope', progress: 54, planned: 53, deployed: 164, required: 160, handover: '2027-05-31', status: 'on-track' },
  { code: 'P-2433', name: 'Wadi Link Road, Package 3', emirate: 'Ras Al Khaimah', phase: 'Earthworks', progress: 28, planned: 39, deployed: 196, required: 275, handover: '2027-11-30', status: 'delayed' },
  { code: 'P-2409', name: 'Falaj Office Tower', emirate: 'Dubai', phase: 'Façade', progress: 66, planned: 65, deployed: 221, required: 225, handover: '2027-04-30', status: 'on-track' },
  { code: 'P-2404', name: 'Lagoon Crest Hotel', emirate: 'Ajman', phase: 'Fit-out', progress: 77, planned: 78, deployed: 142, required: 150, handover: '2027-02-28', status: 'on-track' },
  { code: 'P-2398', name: 'Oasis Schools Package', emirate: 'Abu Dhabi', phase: 'Finishes', progress: 88, planned: 86, deployed: 126, required: 125, handover: '2026-12-20', status: 'on-track' },
  { code: 'P-2421', name: 'Hajar Port Warehouse', emirate: 'Fujairah', phase: 'Structure', progress: 47, planned: 52, deployed: 118, required: 140, handover: '2027-09-30', status: 'at-risk' },
  { code: 'P-2416', name: 'Dune Park Industrial Units', emirate: 'Abu Dhabi', phase: 'MEP', progress: 59, planned: 58, deployed: 137, required: 140, handover: '2027-05-15', status: 'on-track' },
  { code: 'P-2438', name: 'Pearl Diver Retail Podium', emirate: 'Abu Dhabi', phase: 'Substructure', progress: 19, planned: 18, deployed: 129, required: 130, handover: '2028-04-30', status: 'on-track' },
  { code: 'P-2395', name: 'Arish Residences, Block 4', emirate: 'Dubai', phase: 'Finishes', progress: 91, planned: 90, deployed: 104, required: 100, handover: '2026-12-31', status: 'on-track' },
  { code: 'P-2420', name: 'Zafran Community Centre', emirate: 'Sharjah', phase: 'MEP', progress: 52, planned: 60, deployed: 87, required: 110, handover: '2027-07-31', status: 'at-risk' },
  { code: 'P-2431', name: 'Mangrove Substation Works', emirate: 'Umm Al Quwain', phase: 'Civil', progress: 33, planned: 46, deployed: 68, required: 95, handover: '2027-10-31', status: 'delayed' },
  { code: 'P-2440', name: 'Sadu Villas, Phase 1', emirate: 'Abu Dhabi', phase: 'Substructure', progress: 24, planned: 23, deployed: 66, required: 70, handover: '2028-01-31', status: 'on-track' },
];

export const workforceSegments: WorkforceSegment[] = [
  { key: 'deployed', label: 'Deployed', count: 3412 },
  { key: 'mobilizing', label: 'Mobilizing', count: 186 },
  { key: 'available', label: 'Available', count: 412 },
  { key: 'leave', label: 'On leave', count: 198 },
  { key: 'hold', label: 'Visa or medical hold', count: 78 },
];

export const trades: TradeUtilization[] = [
  { key: 'steel', trade: 'Steel fixers', total: 548, deployed: 491, mobilizing: 34, available: 6, leave: 12, hold: 5 },
  { key: 'masons', trade: 'Masons and blockwork', total: 612, deployed: 538, mobilizing: 18, available: 30, leave: 19, hold: 7 },
  { key: 'carpenters', trade: 'Carpenters and formwork', total: 684, deployed: 572, mobilizing: 57, available: 26, leave: 21, hold: 8 },
  { key: 'mep', trade: 'MEP technicians', total: 742, deployed: 601, mobilizing: 30, available: 62, leave: 35, hold: 14 },
  { key: 'engineers', trade: 'Engineers and supervisors', total: 518, deployed: 402, mobilizing: 9, available: 72, leave: 28, hold: 7 },
  { key: 'operators', trade: 'Equipment operators', total: 286, deployed: 214, mobilizing: 12, available: 38, leave: 16, hold: 6 },
  { key: 'general', trade: 'General labour', total: 896, deployed: 594, mobilizing: 26, available: 178, leave: 67, hold: 31 },
];

export const utilizationTrend: UtilizationPoint[] = [
  { week: '2026-08-17', value: 74.8 },
  { week: '2026-08-24', value: 75.6 },
  { week: '2026-08-31', value: 76.1 },
  { week: '2026-09-07', value: 75.4 },
  { week: '2026-09-14', value: 76.9 },
  { week: '2026-09-21', value: 77.3 },
  { week: '2026-09-28', value: 78.2 },
  { week: '2026-10-05', value: 77.8 },
  { week: '2026-10-12', value: 78.6 },
  { week: '2026-10-19', value: 79.1 },
  { week: '2026-10-26', value: 78.9 },
  { week: '2026-11-02', value: 79.6 },
];

export const workforceChangeThisWeek = { total: 15, deployed: 42 };

export const mobilizations = {
  awaitingApproval: 14,
  inReadiness: 23,
  employees: 186,
};

/** All approvals waiting on management. `urgentApprovals` are the ones shown on the dashboard. */
export const TOTAL_PENDING_APPROVALS = 21;

export const urgentApprovals: Approval[] = [
  { id: 'MB-1184', kind: 'Mobilization', title: '34 steel fixers to Sanbouk Quay Towers', requestedBy: 'Mariam Sample', due: 'Today', headcount: 34, project: 'P-2407', effect: 'adds', trade: 'steel', requiredOn: '2026-11-09', requiredLabel: 'On site by', readiness: { ready: 29, total: 34, outstanding: [{ count: 3, label: 'visas' }, { count: 2, label: 'medicals' }] } },
  { id: 'RQ-3307', kind: 'Labour hire', title: '40 equipment operators for Wadi Link Road, Package 3', requestedBy: 'Imran Sample', due: 'Today', headcount: 40, project: 'P-2433', effect: 'adds', trade: 'operators', requiredOn: '2026-11-30', requiredLabel: 'On site by', readiness: { ready: 0, total: 40, outstanding: [{ count: 40, label: 'visas and medicals' }] } },
  { id: 'MB-1191', kind: 'Mobilization', title: '57 formwork carpenters to Barajeel Mixed-Use', requestedBy: 'Mariam Sample', due: 'Today', headcount: 57, project: 'P-2425', effect: 'adds', trade: 'carpenters', requiredOn: '2026-11-12', requiredLabel: 'On site by', readiness: { ready: 52, total: 57, outstanding: [{ count: 3, label: 'visas' }, { count: 2, label: 'site inductions' }] } },
  { id: 'TR-0218', kind: 'Transfer', title: '12 MEP supervisors from Dune Park to Samar Medical', requestedBy: 'Priya Sample', due: 'Tomorrow', headcount: 12, project: 'P-2418', sourceProject: 'P-2416', effect: 'adds', trade: 'engineers', requiredOn: '2026-11-08', requiredLabel: 'On site by', readiness: { ready: 12, total: 12, outstanding: [] } },
  { id: 'DM-0427', kind: 'Demobilization', title: 'Release 28 finishing crew from Arish Residences', requestedBy: 'Omar Sample', due: 'Tomorrow', headcount: 28, project: 'P-2395', effect: 'removes', requiredOn: '2026-11-07', requiredLabel: 'Released by', readiness: { ready: 22, total: 28, outstanding: [{ count: 6, label: 'handover checks' }] } },
];

export const alerts: OperationalAlert[] = [
  { id: 'a1', severity: 'critical', title: 'Wadi Link Road, Package 3 is 79 people short', detail: '11 points behind plan, with the Section 4 permit still open.' },
  { id: 'a2', severity: 'critical', title: '78 employees cannot deploy', detail: 'Held for visa or medical clearance, 44 of them for over 14 days.' },
  { id: 'a3', severity: 'warning', title: '31 visas expire within 30 days', detail: 'All at Sanbouk Quay Towers. Renewal has not started.' },
  { id: 'a4', severity: 'warning', title: 'Oasis Schools handover in 46 days', detail: 'The snagging list is open, with 126 people still on site.' },
];

export const activities: Activity[] = [
  { id: 'e1', kind: 'mobilization', title: 'Mobilization MB-1176 completed', detail: '22 masons reported to Ghaf Grove Villas, Cluster C', at: '2026-11-04T09:12:00Z' },
  { id: 'e2', kind: 'report', title: 'Daily site report submitted', detail: 'Oryx Gate Logistics Park, Phase 2, by Omar Sample', at: '2026-11-04T08:47:00Z' },
  { id: 'e3', kind: 'clearance', title: 'Visa renewals cleared', detail: '18 employees released from hold', at: '2026-11-04T08:05:00Z' },
  { id: 'e4', kind: 'headcount', title: 'Morning headcount confirmed', detail: '3,412 deployed across 18 sites', at: '2026-11-04T07:30:00Z' },
  { id: 'e5', kind: 'delay', title: 'Delay logged on Wadi Link Road, Package 3', detail: 'Section 4 permit moved to 18 November', at: '2026-11-03T16:40:00Z' },
  { id: 'e6', kind: 'demobilization', title: 'Demobilization DM-0421 closed', detail: '16 employees moved from Oasis Schools to Pearl Diver Retail', at: '2026-11-03T15:20:00Z' },
  { id: 'e7', kind: 'milestone', title: 'Façade milestone reached', detail: 'Falaj Office Tower, level 30', at: '2026-11-03T11:05:00Z' },
];

export const notifications: AppNotification[] = [
  { id: 'n1', title: 'Mobilization MB-1184 needs your decision today', at: '2026-11-04T09:30:00Z' },
  { id: 'n2', title: 'Mobilization MB-1176 completed at Ghaf Grove Villas', at: '2026-11-04T09:12:00Z' },
  { id: 'n3', title: 'Morning headcount confirmed: 3,412 deployed', at: '2026-11-04T07:30:00Z' },
  { id: 'n4', title: 'Delay logged on Wadi Link Road, Package 3', at: '2026-11-03T16:40:00Z' },
];
