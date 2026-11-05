import styles from './SegmentBar.module.css';

export interface BarSegment {
  key: string;
  value: number;
  color: string;
  /** Adds an outline, so a pale segment still stands out from a white panel. */
  outlined?: boolean;
}

interface SegmentBarProps {
  segments: BarSegment[];
  size?: 'sm' | 'lg';
  /** Names the bar for screen readers. Leave it out when adjacent text already gives the same numbers. */
  label?: string;
}

export function SegmentBar({ segments, size = 'sm', label }: SegmentBarProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span className={styles.bar} data-size={size} {...a11y}>
      {segments.map((segment) => (
        <span
          key={segment.key}
          data-outlined={segment.outlined}
          style={{ flexGrow: segment.value, flexBasis: 0, background: segment.color }}
        />
      ))}
    </span>
  );
}
