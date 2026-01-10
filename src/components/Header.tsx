'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getPrefs, onPrefsChanged, setPrefs } from '@/lib/prefs';
import styles from './Header.module.css';

interface HeaderProps {
  streak: number;
  puzzleInfo?: string;
  puzzleInfoLoading?: boolean;
  onHelpClick: () => void;
  onStatsClick: () => void;
  onMenuClick?: () => void;
  isMenuOpen?: boolean;
  logoRef?: React.Ref<HTMLDivElement>;
  logoClassName?: string;
  menuButtonRef?: React.Ref<HTMLButtonElement>;
}

export default function Header({
  streak,
  puzzleInfo,
  puzzleInfoLoading,
  onHelpClick,
  onStatsClick,
  onMenuClick,
  isMenuOpen,
  logoRef,
  logoClassName,
  menuButtonRef,
}: HeaderProps) {
  const getEffectiveIsDark = () => {
    const pref = getPrefs().themePreference;
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  };

  const [isDark, setIsDark] = useState(() => (typeof window === 'undefined' ? false : getEffectiveIsDark()));

  useEffect(() => {
    const handlePrefsChange = () => {
      setIsDark(getEffectiveIsDark());
    };
    const unsubscribe = onPrefsChanged(handlePrefsChange);
    handlePrefsChange();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    if (!media) return undefined;
    const onChange = () => {
      if (getPrefs().themePreference === 'system') {
        setIsDark(media.matches);
      }
    };
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  const toggleTheme = () => {
    const nextIsDark = !isDark;
    setIsDark(nextIsDark);
    const nextPref = nextIsDark ? 'dark' : 'light';
    setPrefs({ themePreference: nextPref });
    api.settingsUpdate({ theme: nextPref }).catch(() => null);
  };

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <Link
          href="/how-to-play"
          className={styles.iconButton}
          onClick={(e) => {
            e.preventDefault();
            onHelpClick();
          }}
          aria-label="Help"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </Link>
        <label className={styles.themeToggle}>
          <input
            type="checkbox"
            checked={isDark}
            onChange={toggleTheme}
            className={styles.themeToggleInput}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          />
          <span className={styles.themeToggleTrack} aria-hidden="true">
            <span className={styles.themeToggleThumb}>
              {isDark ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2" />
                  <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2" />
                  <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2" />
                  <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </span>
          </span>
        </label>
      </div>

      <div className={`${styles.logo} ${logoClassName ?? ''}`.trim()} ref={logoRef}>
        <h1 className={styles.logoText}>MAZLE</h1>
      </div>
      {(puzzleInfo || puzzleInfoLoading) && (
        <div className={styles.puzzleInfoRow}>
          <span className={`${styles.puzzleInfo} ${puzzleInfoLoading ? styles.skeleton : ''}`}>
            {puzzleInfoLoading ? '#000' : puzzleInfo}
          </span>
        </div>
      )}

      <div className={styles.rightSection}>
        <button className={styles.iconButton} onClick={onStatsClick} aria-label="Statistics">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
        {onMenuClick && (
          (menuButtonRef || isMenuOpen !== undefined) ? (
            <button
              ref={menuButtonRef}
              className={`${styles.iconButton} ${isMenuOpen ? styles.iconButtonActive : ''}`.trim()}
              onClick={onMenuClick}
              aria-label={isMenuOpen ? 'Close menu' : 'Menu'}
            >
              {isMenuOpen ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          ) : (
            <button className={styles.iconButton} onClick={onMenuClick} aria-label="Menu">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
          )
        )}
      </div>
    </header>
  );
}
