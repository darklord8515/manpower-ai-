import { SegmentBar } from '../../components/charts/SegmentBar';
import { companyLabourSummary, projectsShort } from '../../data/labourSelectors';
import { formatInt, formatPercent } from '../../lib/format';
import styles from './LabourSummary.module.css';

const { required, deployed, short, over, pending, uncovered } = companyLabourSummary;

const FACTS: { label: string; value: number; note?: string; emphasis?: boolean }[] = [
  { label: 'Required', value: required },
  { label: 'Deployed', value: deployed },
  { label: 'Short', value: short, note: `on ${projectsShort} projects`, emphasis: true },
  { label: 'Over', value: over },
  { label: 'Pending', value: pending, note: 'in open requests' },
  { label: 'No request', value: uncovered, note: 'still uncovered', emphasis: true },
];

const filled = required - short;
const coverage = (filled / required) * 100;

/** Company-wide labour totals across all projects, whatever filter is applied below. */
export function LabourSummary() {
  return (
    <div className={styles.root}>
    <dl className={styles.summary} aria-label="Labour across all projects">
      {FACTS.map((fact) => (
        <div key={fact.label} className={styles.fact}>
          <dt>{fact.label}</dt>
          <dd>
            <span className={styles.value} data-emphasis={fact.emphasis}>
              {formatInt(fact.value)}
            </span>
            {fact.note && <span className={styles.note}>{fact.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
    <SegmentBar
      label={`${formatInt(filled)} of ${formatInt(required)} required roles filled, ${formatInt(pending)} in open requests, ${formatInt(uncovered)} with no request`}
      segments={[
        { key: 'filled', value: filled, color: 'var(--chart-1)' },
        { key: 'pending', value: pending, color: 'var(--chart-3)' },
        { key: 'uncovered', value: uncovered, color: 'var(--color-brand)' },
      ]}
    />
    <p className={styles.coverage}>
      {formatPercent(coverage)} of required roles filled. {formatInt(over)} extra people on over-staffed projects are not counted.
    </p>
    </div>
  );
}
