import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import styles from './Popover.module.css';

interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-controls': string;
}

interface PopoverProps {
  label: string;
  renderTrigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
}

/** A click-to-open panel that closes on Escape or an outside click and returns focus to its trigger. */
export function Popover({ label, renderTrigger, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      {renderTrigger({
        ref: triggerRef,
        onClick: () => setOpen((current) => !current),
        'aria-expanded': open,
        'aria-controls': panelId,
      })}
      <div id={panelId} className={styles.panel} role="region" aria-label={label} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
