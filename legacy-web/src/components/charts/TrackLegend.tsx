import styles from './TrackLegend.module.css';

interface TrackLegendProps {
  actual: string;
  shortfall: string;
  mark: string;
}

/** Explains the parts of a ProgressTrack. */
export function TrackLegend({ actual, shortfall, mark }: TrackLegendProps) {
  return (
    <ul className={styles.legend} aria-label="Bar key">
      <li>
        <span className={styles.actual} aria-hidden="true" />
        {actual}
      </li>
      <li>
        <span className={styles.shortfall} aria-hidden="true" />
        {shortfall}
      </li>
      <li>
        <span className={styles.mark} aria-hidden="true" />
        {mark}
      </li>
    </ul>
  );
}
