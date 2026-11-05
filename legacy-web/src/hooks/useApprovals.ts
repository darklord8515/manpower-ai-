import { useCallback, useState } from 'react';
import { TOTAL_PENDING_APPROVALS } from '../data/demo';
import type { ApprovalDecision } from '../data/types';

export type ApprovalDecisions = Record<string, ApprovalDecision>;

/** Session-only decisions. Nothing is saved, and other dashboard figures do not recalculate. */
export function useApprovals() {
  const [decisions, setDecisions] = useState<ApprovalDecisions>({});

  const decide = useCallback((id: string, decision: ApprovalDecision) => {
    setDecisions((current) => ({ ...current, [id]: decision }));
  }, []);

  const undo = useCallback((id: string) => {
    setDecisions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return { decisions, decide, undo, pendingCount: TOTAL_PENDING_APPROVALS - Object.keys(decisions).length };
}
