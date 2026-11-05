import { Sparkles } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { FORECAST_HORIZON_DAYS, redeployment } from '../../data/forecastSelectors';
import { formatDayMonth, formatInt } from '../../lib/format';
import styles from './WorkforceForecastPanel.module.css';

const { projects, releasing, matches, remaining } = redeployment;

const FACTS = [
  { label: 'Releasing', value: releasing },
  { label: 'Potential matches', value: matches },
  { label: 'Still uncovered', value: remaining },
];

export function WorkforceForecastPanel() {
  return (
    <Panel
      title="AI Workforce Forecast"
      subtitle={`Redeployment over the next ${FORECAST_HORIZON_DAYS} days`}
      actions={<span className={styles.tag}>Demo</span>}
      className={styles.panel}
    >
      <div className={styles.body}>
        <ul className={styles.handovers} aria-label="Projects handing over">
          {projects.map((project) => (
            <li key={project.code} className={styles.handover}>
              <span className={styles.handoverName}>{project.name}</span>
              <span className={styles.handoverDate}>{formatDayMonth(project.handover)}</span>
            </li>
          ))}
        </ul>
        <dl className={styles.facts}>
          {FACTS.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dd className={styles.value}>{formatInt(fact.value)}</dd>
              <dt className={styles.label}>{fact.label}</dt>
            </div>
          ))}
        </dl>
        <p className={styles.note}>
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" className={styles.noteIcon} />
          No AI model is connected. This preview applies fixed rules to the fictional demo data: people on projects handing
          over are matched by trade to shortages with no request raised.
        </p>
      </div>
    </Panel>
  );
}
