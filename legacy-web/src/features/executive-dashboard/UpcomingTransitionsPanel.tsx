import { Building2 } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { upcomingTransitions } from '../../data/forecastSelectors';
import { formatDayMonth, formatInt } from '../../lib/format';
import styles from './UpcomingTransitionsPanel.module.css';

const TRANSITIONS_SHOWN = 4;

export function UpcomingTransitionsPanel() {
  return (
    <Panel title="Upcoming project transitions" subtitle="Next planned handovers, and the people on site today">
      <ul className={styles.list}>
        {upcomingTransitions(TRANSITIONS_SHOWN).map(({ project, releasing }) => (
          <li key={project.code} className={styles.item}>
            <span className={styles.icon} aria-hidden="true">
              <Building2 size={15} strokeWidth={1.75} />
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{project.name}</span>
              <span className={styles.date}>Handover {formatDayMonth(project.handover)}</span>
            </span>
            <span className={styles.count}>{formatInt(releasing)} releasing</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
