import styles from './Logo.module.css';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.logo}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className={styles.mark}>
        <rect width="32" height="32" rx="7" fill="var(--color-brand)" />
        <path fill="#fff" d="M8 7h16v4h-6v10h6v4H8v-4h6V11H8z" />
      </svg>
      <span className={compact ? 'sr-only' : styles.word} translate="no">
        CONSTRUCTIQ
      </span>
    </span>
  );
}
