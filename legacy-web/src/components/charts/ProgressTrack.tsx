import styles from './ProgressTrack.module.css';

interface ProgressTrackProps {
  /** Actual value, 0 to 100. */
  value: number;
  /** Plan or target, 0 to 100. The gap up to this point shows in red. */
  mark: number;
}

/** Visual only. Callers show the same numbers as text beside it, so it is hidden from screen readers. */
export function ProgressTrack({ value, mark }: ProgressTrackProps) {
  const shortfall = Math.max(mark - value, 0);
  return (
    <span className={styles.track} aria-hidden="true">
      <span className={styles.fill} style={{ width: `${value}%` }} />
      {shortfall > 0 && <span className={styles.shortfall} style={{ insetInlineStart: `${value}%`, width: `${shortfall}%` }} />}
      <span className={styles.mark} style={{ insetInlineStart: `${mark}%` }} />
    </span>
  );
}
