import { useId, type ReactNode } from 'react';
import styles from './Panel.module.css';

interface PanelProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, subtitle, actions, children, className }: PanelProps) {
  const headingId = useId();
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={headingId} className={styles.title}>
            {title}
          </h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </section>
  );
}
