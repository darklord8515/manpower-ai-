import { useCallback, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui/Toast';
import { ExecutiveDashboardPage } from './features/executive-dashboard/ExecutiveDashboardPage';
import type { RevealRequest } from './features/executive-dashboard/ProjectProgressPanel';
import { useApprovals } from './hooks/useApprovals';

export function App() {
  const { decisions, decide, undo, pendingCount } = useApprovals();
  const [reveal, setReveal] = useState<RevealRequest | null>(null);

  const onSelectProject = useCallback((code: string) => {
    setReveal((current) => ({ code, id: (current?.id ?? 0) + 1 }));
  }, []);

  return (
    <ToastProvider>
      <AppShell pendingApprovals={pendingCount} onSelectProject={onSelectProject}>
        <ExecutiveDashboardPage
          reveal={reveal}
          decisions={decisions}
          pendingCount={pendingCount}
          onDecide={decide}
          onUndo={undo}
        />
      </AppShell>
    </ToastProvider>
  );
}
