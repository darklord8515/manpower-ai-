import type { Project, ProjectStatus, WorkforceSegment } from './types';
import { projects, trades, workforceSegments } from './demo';

export const totalWorkforce = workforceSegments.reduce((sum, segment) => sum + segment.count, 0);
export const deployedWorkforce = workforceSegments.find((segment) => segment.key === 'deployed')!.count;
export const utilization = (deployedWorkforce / totalWorkforce) * 100;

const segmentCount = (key: WorkforceSegment['key']) =>
  workforceSegments.find((segment) => segment.key === key)!.count;

/** The four states shown to management. Unavailable groups leave and holds. */
export const workforceStates = [
  { key: 'deployed', label: 'Deployed', meaning: 'On a project site', count: segmentCount('deployed') },
  { key: 'mobilizing', label: 'Mobilizing', meaning: 'Assigned, not yet on site', count: segmentCount('mobilizing') },
  { key: 'available', label: 'Available', meaning: 'Free to assign now', count: segmentCount('available') },
  { key: 'unavailable', label: 'Unavailable', meaning: '', count: segmentCount('leave') + segmentCount('hold') },
] as const;

export const onLeave = segmentCount('leave');
export const onHold = segmentCount('hold');

const countByStatus = (status: ProjectStatus) => projects.filter((project) => project.status === status).length;

export const statusCounts: Record<ProjectStatus, number> = {
  'on-track': countByStatus('on-track'),
  'at-risk': countByStatus('at-risk'),
  delayed: countByStatus('delayed'),
};

export const supervisoryStaff = trades.find((trade) => trade.trade === 'Engineers and supervisors')!.total;
export const craftAndLabour = totalWorkforce - supervisoryStaff;

export const planVariance = (project: Project) => project.progress - project.planned;
export const workforceGap = (project: Project) => project.required - project.deployed;

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  delayed: 'Delayed',
};
