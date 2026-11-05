import { CircleCheck, Clock, FileText, Flag, LogIn, LogOut, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { activities, DEMO_NOW } from '../../data/demo';
import type { Activity, ActivityKind } from '../../data/types';
import { formatTime } from '../../lib/format';
import styles from './ActivityFeed.module.css';

const ICONS: Record<ActivityKind, LucideIcon> = {
  mobilization: LogIn,
  report: FileText,
  clearance: ShieldCheck,
  headcount: Users,
  delay: Clock,
  demobilization: LogOut,
  milestone: Flag,
};

const day = (iso: string) => iso.slice(0, 10);

const groups: { label: string; items: Activity[] }[] = [
  { label: 'Today', items: activities.filter((activity) => day(activity.at) === day(DEMO_NOW)) },
  { label: 'Yesterday', items: activities.filter((activity) => day(activity.at) !== day(DEMO_NOW)) },
];

export function ActivityFeed() {
  return (
    <Panel title="Recent activity">
      <div className={styles.body}>
        {groups.map((group) => (
          <div key={group.label} className={styles.group}>
            <h3 className={styles.day}>{group.label}</h3>
            <ol className={styles.list}>
              {group.items.map((item) => {
                const Icon = ICONS[item.kind] ?? CircleCheck;
                return (
                  <li key={item.id} className={styles.item}>
                    <span className={styles.icon} data-kind={item.kind}>
                      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <div className={styles.text}>
                      <p className={styles.title}>{item.title}</p>
                      <p className={styles.detail}>{item.detail}</p>
                    </div>
                    <time className={styles.time} dateTime={item.at}>
                      {formatTime(item.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </Panel>
  );
}
