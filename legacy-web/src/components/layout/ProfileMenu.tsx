import { ChevronDown } from 'lucide-react';
import { currentUser } from '../../data/demo';
import { Popover } from '../ui/Popover';
import styles from './Menus.module.css';

export function ProfileMenu() {
  return (
    <Popover
      label="Profile"
      renderTrigger={(props) => (
        <button type="button" className={styles.profile} {...props}>
          <span className={styles.avatar} aria-hidden="true">
            {currentUser.initials}
          </span>
          <span className={styles.profileText}>
            <span className={styles.profileName}>{currentUser.fullName}</span>{' '}
            <span className={styles.profileRole}>{currentUser.role}</span>
            <span className="sr-only"> profile menu</span>
          </span>
          <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
        </button>
      )}
    >
      <div className={styles.profileCard}>
        <span className={styles.avatar} aria-hidden="true">
          {currentUser.initials}
        </span>
        <div>
          <h2 className={styles.menuTitle}>{currentUser.fullName}</h2>
          <p className={styles.profileRole}>{currentUser.role}</p>
        </div>
      </div>
      <p className={styles.menuNote}>This is a demonstration profile. Sign-in and account settings aren’t built yet.</p>
    </Popover>
  );
}
