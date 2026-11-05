import { UTILIZATION_TARGET } from '../../config/workforce';
import type { ApprovalDecision } from '../../data/types';
import type { ApprovalDecisions } from '../../hooks/useApprovals';
import { ActivityFeed } from './ActivityFeed';
import { ApprovalsAlertsPanel } from './ApprovalsAlertsPanel';
import { KeyAlertsPanel } from './KeyAlertsPanel';
import { KpiBand } from './KpiBand';
import { ProjectProgressPanel, type RevealRequest } from './ProjectProgressPanel';
import { ProjectTimelinePanel } from './ProjectTimelinePanel';
import { UpcomingTransitionsPanel } from './UpcomingTransitionsPanel';
import { WelcomeHeader } from './WelcomeHeader';
import { WorkforceForecastPanel } from './WorkforceForecastPanel';
import { WorkforceUtilizationPanel } from './WorkforceUtilizationPanel';
import styles from './ExecutiveDashboardPage.module.css';

interface ExecutiveDashboardPageProps {
  reveal: RevealRequest | null;
  decisions: ApprovalDecisions;
  pendingCount: number;
  onDecide: (id: string, decision: ApprovalDecision) => void;
  onUndo: (id: string) => void;
}

export function ExecutiveDashboardPage({ reveal, decisions, pendingCount, onDecide, onUndo }: ExecutiveDashboardPageProps) {
  return (
    <div className={styles.page}>
      <WelcomeHeader pendingApprovals={pendingCount} />
      <KpiBand />
      <div className={styles.columns}>
        <div className={styles.primary}>
          <div className={styles.utilization}>
            <WorkforceUtilizationPanel />
          </div>
          <div className={styles.projects}>
            <ProjectProgressPanel reveal={reveal} />
          </div>
          <div className={styles.timeline}>
            <ProjectTimelinePanel />
          </div>
          <div className={styles.transitions}>
            <UpcomingTransitionsPanel />
          </div>
        </div>
        <div className={styles.rail}>
          <div className={styles.approvals}>
            <ApprovalsAlertsPanel decisions={decisions} onDecide={onDecide} onUndo={onUndo} />
          </div>
          <div className={styles.forecast}>
            <WorkforceForecastPanel />
          </div>
          <div className={styles.alerts}>
            <KeyAlertsPanel />
          </div>
          <div className={styles.activity}>
            <ActivityFeed />
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <p>
          All names, projects, figures and dates on this page are fictional and do not represent company data. The{' '}
          {UTILIZATION_TARGET}% utilization target is an illustrative placeholder set in configuration, not an approved
          company target.
        </p>
      </footer>
    </div>
  );
}
