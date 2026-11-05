import type { ReactNode } from 'react';
import { Building2, HardHat, MapPin, TriangleAlert, Truck, UserCheck, type LucideIcon } from 'lucide-react';
import { SegmentBar, type BarSegment } from '../../components/charts/SegmentBar';
import { mobilizations, projects, workforceChangeThisWeek } from '../../data/demo';
import { companyLabourSummary, projectsShort } from '../../data/labourSelectors';
import {
  craftAndLabour,
  deployedWorkforce,
  statusCounts,
  supervisoryStaff,
  totalWorkforce,
  utilization,
  workforceStates,
} from '../../data/selectors';
import { formatInt, formatPercent, formatSigned } from '../../lib/format';
import styles from './KpiBand.module.css';

interface Kpi {
  label: string;
  icon: LucideIcon;
  tone?: 'alert';
  value: string;
  change?: string;
  segments: BarSegment[];
  barLabel?: string;
  detail: ReactNode;
}

const pendingTotal = mobilizations.awaitingApproval + mobilizations.inReadiness;
const available = workforceStates.find((state) => state.key === 'available')!.count;

const KPIS: Kpi[] = [
  {
    label: 'Active projects',
    icon: Building2,
    value: formatInt(projects.length),
    segments: [
      { key: 'on-track', value: statusCounts['on-track'], color: 'var(--color-ok)' },
      { key: 'at-risk', value: statusCounts['at-risk'], color: 'var(--color-warn)' },
      { key: 'delayed', value: statusCounts.delayed, color: 'var(--color-danger)' },
    ],
    barLabel: `Project status: ${statusCounts['on-track']} on track, ${statusCounts['at-risk']} at risk, ${statusCounts.delayed} delayed`,
    detail: `${statusCounts['on-track']} on track, ${statusCounts['at-risk']} at risk, ${statusCounts.delayed} delayed`,
  },
  {
    label: 'Total workforce',
    icon: HardHat,
    value: formatInt(totalWorkforce),
    change: `${formatSigned(workforceChangeThisWeek.total)} this week`,
    segments: [
      { key: 'craft', value: craftAndLabour, color: 'var(--chart-1)' },
      { key: 'staff', value: supervisoryStaff, color: 'var(--chart-3)' },
    ],
    detail: `${formatInt(craftAndLabour)} craft and labour, ${formatInt(supervisoryStaff)} engineers and supervisors`,
  },
  {
    label: 'Employees deployed',
    icon: MapPin,
    value: formatInt(deployedWorkforce),
    change: `${formatSigned(workforceChangeThisWeek.deployed)} this week`,
    segments: [
      { key: 'deployed', value: deployedWorkforce, color: 'var(--chart-1)' },
      { key: 'rest', value: totalWorkforce - deployedWorkforce, color: 'var(--track)' },
    ],
    detail: `${formatPercent(utilization)} of the workforce, across ${projects.length} sites`,
  },
  {
    label: 'Available',
    icon: UserCheck,
    value: formatInt(available),
    segments: [
      { key: 'available', value: available, color: 'var(--chart-2)' },
      { key: 'rest', value: totalWorkforce - available, color: 'var(--track)' },
    ],
    detail: `${formatPercent((available / totalWorkforce) * 100)} of the workforce, free to assign now`,
  },
  {
    label: 'Workforce shortage',
    icon: TriangleAlert,
    tone: 'alert',
    value: formatInt(companyLabourSummary.short),
    segments: [
      { key: 'pending', value: companyLabourSummary.pending, color: 'var(--chart-3)' },
      { key: 'uncovered', value: companyLabourSummary.uncovered, color: 'var(--color-brand)' },
    ],
    detail: `On ${projectsShort} projects: ${formatInt(companyLabourSummary.pending)} in open requests, ${formatInt(companyLabourSummary.uncovered)} with no request`,
  },
  {
    label: 'Pending mobilizations',
    icon: Truck,
    value: formatInt(pendingTotal),
    segments: [
      { key: 'approval', value: mobilizations.awaitingApproval, color: 'var(--color-brand)' },
      { key: 'readiness', value: mobilizations.inReadiness, color: 'var(--chart-3)' },
    ],
    detail: `${mobilizations.awaitingApproval} awaiting approval, ${mobilizations.inReadiness} in readiness, covering ${mobilizations.employees} employees`,
  },
];

export function KpiBand() {
  return (
    <section className={styles.frame} aria-label="Key figures">
      <dl className={styles.band}>
        {KPIS.map(({ label, icon: Icon, tone, value, change, segments, barLabel, detail }) => (
          <div key={label} className={styles.kpi} data-tone={tone}>
            <dt className={styles.label}>
              <span className={styles.chip} aria-hidden="true">
                <Icon size={15} strokeWidth={1.75} />
              </span>
              {label}
            </dt>
            <dd className={styles.body}>
              <span className={styles.valueRow}>
                <span className={styles.value}>{value}</span>
                {change && <span className={styles.change}>{change}</span>}
              </span>
              <SegmentBar segments={segments} label={barLabel} />
              <span className={styles.detail}>{detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
