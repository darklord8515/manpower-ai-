import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { navigation, type NavItem } from '../../config/navigation';
import { IconButton } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Logo } from './Logo';
import styles from './Sidebar.module.css';

interface SidebarProps {
  isDrawer: boolean;
  collapsed: boolean;
  drawerOpen: boolean;
  pendingApprovals: number;
  onToggleCollapsed: () => void;
  onCloseDrawer: () => void;
}

export function Sidebar({ isDrawer, collapsed, drawerOpen, pendingApprovals, onToggleCollapsed, onCloseDrawer }: SidebarProps) {
  const { showToast } = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  useEffect(() => {
    if (isDrawer && drawerOpen) closeRef.current?.focus();
  }, [isDrawer, drawerOpen]);

  useEffect(() => {
    if (!collapsed) setTip(null);
  }, [collapsed]);

  const showTip = (label: string) => (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (!collapsed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2 });
  };
  const hideTip = () => setTip(null);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const badge = item.id === 'approvals' ? pendingApprovals : undefined;
    const accessibleName = badge ? `${item.label}, ${badge} pending` : item.label;
    return (
      <li key={item.id}>
        <button
          type="button"
          className={styles.item}
          aria-current={item.built ? 'page' : undefined}
          aria-label={collapsed ? accessibleName : undefined}
          onClick={() => {
            if (item.built) return;
            showToast(`${item.label} isn’t part of this build yet.`);
          }}
          onMouseEnter={showTip(item.label)}
          onMouseLeave={hideTip}
          onFocus={showTip(item.label)}
          onBlur={hideTip}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
          {!collapsed && <span className={styles.label}>{item.label}</span>}
          {badge !== undefined && badge > 0 && (
            <span className={collapsed ? styles.dot : styles.badge} aria-hidden={collapsed}>
              {!collapsed && badge}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed}
      data-drawer={isDrawer}
      data-open={drawerOpen}
      inert={isDrawer && !drawerOpen}
      aria-label="Primary"
    >
      <div className={styles.brand}>
        <Logo compact={collapsed} />
        {isDrawer && (
          <IconButton ref={closeRef} aria-label="Close navigation" onClick={onCloseDrawer}>
            <X size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>

      <nav className={styles.nav} aria-label="Main navigation">
        {navigation.map((group, index) => (
          <div key={group.label} className={styles.group}>
            {collapsed ? index > 0 && <hr className={styles.rule} /> : <p className={styles.groupLabel}>{group.label}</p>}
            <ul aria-label={group.label}>{group.items.map(renderItem)}</ul>
          </div>
        ))}
      </nav>

      {!isDrawer && (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.item}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : undefined}
            onClick={onToggleCollapsed}
            onMouseEnter={showTip('Expand sidebar')}
            onMouseLeave={hideTip}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
            ) : (
              <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" className={styles.icon} />
            )}
            {!collapsed && <span className={styles.label}>Collapse sidebar</span>}
          </button>
        </div>
      )}

      {tip && collapsed && (
        <div className={styles.tooltip} style={{ top: tip.top }} aria-hidden="true">
          {tip.label}
        </div>
      )}
    </aside>
  );
}
