'use client';

import styles from './Header.module.css';

interface HeaderProps {
  streak: number;
  onHelpClick: () => void;
  onStatsClick: () => void;
  logoRef?: React.Ref<HTMLDivElement>;
  logoClassName?: string;
}

export default function Header({ streak, onHelpClick, onStatsClick, logoRef, logoClassName }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <button className={styles.iconButton} onClick={onHelpClick} aria-label="Help">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </button>
      </div>
      
      <div className={`${styles.logo} ${logoClassName ?? ''}`.trim()} ref={logoRef}>
        <span className={styles.logoText}>MAZLE</span>
      </div>
      
      <div className={styles.rightSection}>
        <button className={styles.iconButton} onClick={onStatsClick} aria-label="Statistics">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
      </div>
    </header>
  );
}

