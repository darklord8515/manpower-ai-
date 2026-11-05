import { useEffect, useRef, useState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { TOTAL_PENDING_APPROVALS, urgentApprovals } from '../../data/demo';
import { approvalImpact, gapLabel } from '../../data/labourSelectors';
import type { Approval, ApprovalDecision } from '../../data/types';
import { formatDayMonth, formatInt } from '../../lib/format';
import type { ApprovalDecisions } from '../../hooks/useApprovals';
import styles from './ApprovalsAlertsPanel.module.css';

interface ApprovalsAlertsPanelProps {
  decisions: ApprovalDecisions;
  onDecide: (id: string, decision: ApprovalDecision) => void;
  onUndo: (id: string) => void;
}

function readinessText({ ready, total, outstanding }: Approval['readiness']) {
  if (ready === total) return `All ${formatInt(total)} ready`;
  const items = outstanding.map((item) => `${formatInt(item.count)} ${item.label}`).join(', ');
  return `Ready: ${formatInt(ready)} of ${formatInt(total)} (${items} outstanding)`;
}

function ApprovalDetail({ approval }: { approval: Approval }) {
  const { lines, risks } = approvalImpact(approval);
  return (
    <>
      <ul className={styles.impact} aria-label="Effect on project staffing">
        {lines.map((line) => (
          <li key={line.code} className={styles.impactLine} data-worsens={line.worsens}>
            {line.name}: {gapLabel(line.before).toLowerCase()} to {gapLabel(line.after).toLowerCase()}
          </li>
        ))}
      </ul>
      <p className={styles.facts}>
        {approval.requiredLabel} {formatDayMonth(approval.requiredOn)}. {readinessText(approval.readiness)}.
      </p>
      {risks.length > 0 && (
        <ul className={styles.risks} aria-label="Possible consequences">
          {risks.map((risk) => (
            <li key={risk} className={styles.risk}>
              <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" className={styles.riskIcon} />
              {risk}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function dueTodaySummary(open: number) {
  if (open === 0) return 'No decisions left to make today';
  return open === 1 ? '1 decision due today' : `${open} decisions due today`;
}

export function ApprovalsAlertsPanel({ decisions, onDecide, onUndo }: ApprovalsAlertsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  // The clicked button unmounts when a decision changes, so focus moves to its replacement.
  useEffect(() => {
    if (!focusTarget) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-focus-key="${focusTarget}"]`)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const openToday = urgentApprovals.filter((approval) => approval.due === 'Today' && !decisions[approval.id]).length;

  return (
    <Panel title="Pending approvals" subtitle={dueTodaySummary(openToday)}>
      <div ref={rootRef}>
        <ul className={styles.approvals}>
          {urgentApprovals.map((approval) => {
            const decision = decisions[approval.id];
            if (decision) {
              const Icon = decision === 'approved' ? Check : X;
              return (
                <li key={approval.id} className={styles.decided}>
                  <Icon size={15} aria-hidden="true" className={styles.decidedIcon} />
                  <span className={styles.decidedText}>
                    <strong>{decision === 'approved' ? 'Approved' : 'Declined'}</strong> {approval.id}
                  </span>
                  <Button
                    variant="ghost"
                    data-focus-key={`${approval.id}-undo`}
                    aria-label={`Undo decision on ${approval.id}`}
                    onClick={() => {
                      onUndo(approval.id);
                      setFocusTarget(`${approval.id}-approve`);
                    }}
                  >
                    Undo
                  </Button>
                </li>
              );
            }
            return (
              <li key={approval.id} className={styles.approval}>
                <div className={styles.approvalMeta}>
                  <span>
                    {approval.kind} {approval.id}
                  </span>
                  <span className={styles.due} data-today={approval.due === 'Today'}>
                    Due {approval.due.toLowerCase()}
                  </span>
                </div>
                <p className={styles.approvalTitle}>{approval.title}</p>
                <ApprovalDetail approval={approval} />
                <div className={styles.actions}>
                  <span className={styles.requester}>From {approval.requestedBy}</span>
                  <span className={styles.buttons}>
                  <Button
                    variant={approval.due === 'Today' ? 'primary' : 'secondary'}
                    data-focus-key={`${approval.id}-approve`}
                    aria-label={`Approve ${approval.id}: ${approval.title}`}
                    onClick={() => {
                      onDecide(approval.id, 'approved');
                      setFocusTarget(`${approval.id}-undo`);
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Decline ${approval.id}: ${approval.title}`}
                    onClick={() => {
                      onDecide(approval.id, 'declined');
                      setFocusTarget(`${approval.id}-undo`);
                    }}
                  >
                    Decline
                  </Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className={styles.note}>
          Showing the {urgentApprovals.length} most urgent of {TOTAL_PENDING_APPROVALS} requests. Decisions last for
          this session only and don’t change other figures.
        </p>
      </div>
    </Panel>
  );
}
