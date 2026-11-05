import { CalendarDays } from 'lucide-react';
import { currentUser, DEMO_NOW } from '../../data/demo';
import { statusCounts } from '../../data/selectors';
import { formatLongDate } from '../../lib/format';
import styles from './WelcomeHeader.module.css';

function greeting(iso: string) {
  const hour = new Date(iso).getUTCHours();
  if (hour < 12) return 'Good morning';
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function WelcomeHeader({ pendingApprovals }: { pendingApprovals: number }) {
  const approvals =
    pendingApprovals === 1 ? '1 approval is waiting' : `${pendingApprovals} approvals are waiting`;

  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>Executive dashboard</h1>
        <p className={styles.summary}>
          {greeting(DEMO_NOW)}, {currentUser.firstName}. {statusCounts.delayed} projects are delayed,{' '}
          {statusCounts['at-risk']} are at risk, and {approvals} on management.
        </p>
      </div>
      <div className={styles.meta}>
        <span className={styles.date}>
          <CalendarDays size={15} strokeWidth={1.75} aria-hidden="true" />
          {formatLongDate(DEMO_NOW)}
        </span>
      </div>
    </header>
  );
}
