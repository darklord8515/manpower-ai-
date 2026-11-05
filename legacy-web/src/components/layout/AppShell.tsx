import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useStoredBoolean } from '../../hooks/useStoredBoolean';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  pendingApprovals: number;
  onSelectProject: (code: string) => void;
}

export function AppShell({ children, pendingApprovals, onSelectProject }: AppShellProps) {
  const isDrawer = useMediaQuery('(max-width: 1023px)');
  const [collapsed, setCollapsed] = useStoredBoolean('constructiq.sidebar.collapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Runs after the render that removes `inert` from the page, because inert elements can't take focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !drawerOpen) menuButtonRef.current?.focus();
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    if (!isDrawer) setDrawerOpen(false);
  }, [isDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [drawerOpen, closeDrawer]);

  return (
    <div className={styles.shell} data-collapsed={!isDrawer && collapsed}>
      <a href="#main" className={styles.skip}>
        Skip to main content
      </a>

      <Sidebar
        isDrawer={isDrawer}
        collapsed={!isDrawer && collapsed}
        drawerOpen={drawerOpen}
        pendingApprovals={pendingApprovals}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onCloseDrawer={closeDrawer}
      />

      {!isDrawer && (
        <>
          <div className={`${styles.corner} ${styles.cornerTop}`} aria-hidden="true" />
          <div className={`${styles.corner} ${styles.cornerBottom}`} aria-hidden="true" />
        </>
      )}

      {isDrawer && drawerOpen && <div className={styles.scrim} onClick={closeDrawer} aria-hidden="true" />}

      <div className={styles.main} inert={drawerOpen}>
        <Topbar
          showMenuButton={isDrawer}
          menuButtonRef={menuButtonRef}
          onOpenMenu={() => setDrawerOpen(true)}
          onSelectProject={onSelectProject}
        />
        <main id="main" tabIndex={-1} className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
