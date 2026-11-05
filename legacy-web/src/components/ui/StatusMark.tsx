import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { STATUS_LABEL } from '../../data/selectors';
import type { ProjectStatus } from '../../data/types';
import styles from './StatusMark.module.css';

const ICONS = { 'on-track': CircleCheck, 'at-risk': TriangleAlert, delayed: CircleAlert };

export function StatusMark({ status }: { status: ProjectStatus }) {
  const Icon = ICONS[status];
  return (
    <span className={styles.mark} data-status={status}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
