import { useState } from 'react';
import { Bell } from 'lucide-react';
import { DEMO_NOW, notifications } from '../../data/demo';
import { formatTime } from '../../lib/format';
import { Button, IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import styles from './Menus.module.css';

const INITIALLY_UNREAD = new Set(['n1', 'n2', 'n3']);

export function NotificationsMenu() {
  const [unread, setUnread] = useState(INITIALLY_UNREAD);
  const count = unread.size;

  return (
    <Popover
      label="Notifications"
      renderTrigger={(props) => (
        <IconButton {...props} aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
          <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
          {count > 0 && (
            <span className={styles.count} aria-hidden="true">
              {count}
            </span>
          )}
        </IconButton>
      )}
    >
      <div className={styles.menuHeader}>
        <h2 className={styles.menuTitle}>Notifications</h2>
        <Button variant="ghost" disabled={count === 0} onClick={() => setUnread(new Set())}>
          Mark all as read
        </Button>
      </div>
      <ul className={styles.notifications}>
        {notifications.map((item) => (
          <li key={item.id} className={styles.notification} data-unread={unread.has(item.id)}>
            <span className={styles.unreadDot} aria-hidden="true" />
            <span className={styles.notificationText}>
              {unread.has(item.id) && <span className="sr-only">Unread: </span>}
              {item.title}
            </span>
            <time className={styles.notificationTime} dateTime={item.at}>
              {item.at.slice(0, 10) === DEMO_NOW.slice(0, 10) ? formatTime(item.at) : 'Yesterday'}
            </time>
          </li>
        ))}
      </ul>
      <p className={styles.menuNote}>Read state resets when you refresh.</p>
    </Popover>
  );
}
