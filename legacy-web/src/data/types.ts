export type ProjectStatus = 'on-track' | 'at-risk' | 'delayed';

export interface Project {
  code: string;
  name: string;
  emirate: string;
  phase: string;
  /** Actual completion, percent. */
  progress: number;
  /** Planned completion as of today, percent. */
  planned: number;
  deployed: number;
  required: number;
  /** ISO date of planned handover. */
  handover: string;
  status: ProjectStatus;
}

export type TradeKey = 'steel' | 'masons' | 'carpenters' | 'mep' | 'engineers' | 'operators' | 'general';

export interface TradeUtilization {
  key: TradeKey;
  trade: string;
  total: number;
  deployed: number;
  mobilizing: number;
  available: number;
  leave: number;
  hold: number;
}

export interface ProjectLabour {
  /** People on site by trade, in the order of TRADE_KEYS. */
  deployed: number[];
  /** Required minus deployed, for trades that differ. Negative means over-staffed. */
  gaps: Partial<Record<TradeKey, number>>;
}

export interface MobilizationLine {
  project: string;
  trade: TradeKey;
  employees: number;
  requests: number;
  awaitingApproval: number;
  /** Set when the line is a single request shown on the dashboard. */
  reference?: string;
}

export interface WorkforceSegment {
  key: 'deployed' | 'mobilizing' | 'available' | 'leave' | 'hold';
  label: string;
  count: number;
}

export interface UtilizationPoint {
  /** ISO date of the Monday starting the week. */
  week: string;
  value: number;
}

export type ApprovalKind = 'Mobilization' | 'Demobilization' | 'Labour hire' | 'Transfer';
export type ApprovalDecision = 'approved' | 'declined';

export interface ApprovalReadiness {
  ready: number;
  total: number;
  outstanding: { count: number; label: string }[];
}

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  requestedBy: string;
  due: 'Today' | 'Tomorrow';
  headcount: number;
  /** The project this decision changes. */
  project: string;
  /** Where the people come from, for a transfer. */
  sourceProject?: string;
  effect: 'adds' | 'removes';
  /** Left out when the people aren't from a single trade. */
  trade?: TradeKey;
  /** ISO date the people are needed on site, or released by. */
  requiredOn: string;
  requiredLabel: 'On site by' | 'Released by';
  readiness: ApprovalReadiness;
}

export type AlertSeverity = 'critical' | 'warning';

export interface OperationalAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export type ActivityKind =
  | 'mobilization'
  | 'report'
  | 'clearance'
  | 'headcount'
  | 'delay'
  | 'demobilization'
  | 'milestone';

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  /** Local site time, written as a UTC timestamp so rendering never shifts with the viewer's time zone. */
  at: string;
}

export interface AppNotification {
  id: string;
  title: string;
  at: string;
}
