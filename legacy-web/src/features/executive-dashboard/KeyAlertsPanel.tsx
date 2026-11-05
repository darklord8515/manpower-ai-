import { OctagonAlert, TriangleAlert } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { alerts } from '../../data/demo';
import styles from './KeyAlertsPanel.module.css';

export function KeyAlertsPanel() {
  return (
    <Panel title="Key alerts">
      <ul className={styles.alerts}>
        {alerts.map((alert) => {
          const critical = alert.severity === 'critical';
          const Icon = critical ? OctagonAlert : TriangleAlert;
          return (
            <li key={alert.id} className={styles.alert} data-severity={alert.severity}>
              <Icon size={16} strokeWidth={2} className={styles.icon} aria-hidden="true" />
              <div className={styles.text}>
                <p className={styles.severity}>{critical ? 'Critical' : 'Warning'}</p>
                <p className={styles.title}>{alert.title}</p>
                <p className={styles.detail}>{alert.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
