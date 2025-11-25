'use client';

import styles from './Header.module.css';

interface HeaderProps {
  streak: number;
  onHelpClick: () => void;
  onStatsClick: () => void;
}

export default function Header({ streak, onHelpClick, onStatsClick }: HeaderProps) {
  return (
    <header className={styles.header}>
      <button className={styles.iconButton} onClick={onHelpClick} aria-label="Help">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      
      <div className={styles.logo}>
        <span className={styles.logoText}>MAZLE</span>
      </div>
      
      <div className={styles.rightSection}>
        {streak > 0 && (
          <div className={styles.streak}>
            <span className={styles.streakIcon}>🔥</span>
            <span className={styles.streakCount}>{streak}</span>
          </div>
        )}
        <button className={styles.iconButton} onClick={onStatsClick} aria-label="Statistics">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
      </div>
    </header>
  );
}

