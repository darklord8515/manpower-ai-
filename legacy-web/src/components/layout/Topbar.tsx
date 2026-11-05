import type { Ref } from 'react';
import { Menu } from 'lucide-react';
import { IconButton } from '../ui/Button';
import { NotificationsMenu } from './NotificationsMenu';
import { ProfileMenu } from './ProfileMenu';
import { SearchBox } from './SearchBox';
import styles from './Topbar.module.css';

interface TopbarProps {
  showMenuButton: boolean;
  menuButtonRef: Ref<HTMLButtonElement>;
  onOpenMenu: () => void;
  onSelectProject: (code: string) => void;
}

export function Topbar({ showMenuButton, menuButtonRef, onOpenMenu, onSelectProject }: TopbarProps) {
  return (
    <header className={styles.topbar}>
      {showMenuButton && (
        <IconButton ref={menuButtonRef} aria-label="Open navigation" onClick={onOpenMenu}>
          <Menu size={20} aria-hidden="true" />
        </IconButton>
      )}
      <SearchBox onSelectProject={onSelectProject} />
      <p className={styles.demo}>Fictional Demo Data</p>
      <div className={styles.end}>
        <NotificationsMenu />
        <ProfileMenu />
      </div>
    </header>
  );
}
