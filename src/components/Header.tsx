'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cachedApi } from '@/lib/api/cached';
import { getPrefs, onPrefsChanged, setPrefs } from '@/lib/prefs';
import styles from './Header.module.css';

interface HeaderProps {
  streak: number;
  puzzleInfo?: string;
  puzzleInfoLoading?: boolean;
  onHelpClick: () => void;
  onMenuClick?: () => void;
  isMenuOpen?: boolean;
  logoRef?: React.Ref<HTMLDivElement>;
  logoClassName?: string;
  menuButtonRef?: React.Ref<HTMLButtonElement>;
  showThemeToggle?: boolean;
}

export default function Header({
  streak,
  puzzleInfo,
  puzzleInfoLoading,
  onHelpClick,
  onMenuClick,
  isMenuOpen,
  logoRef,
  logoClassName,
  menuButtonRef,
  showThemeToggle = true,
}: HeaderProps) {
  const getEffectiveIsDark = () => {
    const pref = getPrefs().themePreference;
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  };

  // Start with null to avoid hydration mismatch, then sync with actual theme
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    cachedApi
      .me()
      .then((me) => {
        const serverTheme = me?.mode === 'user' ? me.settings?.theme : null;
        if (serverTheme === 'system' || serverTheme === 'light' || serverTheme === 'dark') {
          setPrefs({ themePreference: serverTheme });
        }
      })
      .catch(() => null);
  }, []);

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
        {showThemeToggle && (
          <label className={styles.themeToggle}>
            <input
              type="checkbox"
              checked={isDark ?? false}
              onChange={toggleTheme}
              className={styles.themeToggleInput}
              aria-label="Toggle theme"
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
                    <line x1="12" y1="1" x2="12" y2="5" stroke="currentColor" strokeWidth="2" />
                    <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" />
                    <line x1="4.22" y1="4.22" x2="7.05" y2="7.05" stroke="currentColor" strokeWidth="2" />
                    <line x1="16.95" y1="16.95" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2" />
                    <line x1="1" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth="2" />
                    <line x1="19" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2" />
                    <line x1="4.22" y1="19.78" x2="7.05" y2="16.95" stroke="currentColor" strokeWidth="2" />
                    <line x1="16.95" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </span>
            </span>
          </label>
        )}
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
        <div
          className={`${styles.streakIndicator} ${streak > 0 ? styles.streakActive : styles.streakInactive}`}
          title={streak > 0 ? `${streak} day streak!` : 'No active streak'}
        >
          <svg
            className={styles.streakFlame}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 23c-3.866 0-7-3.134-7-7 0-2.692 1.58-5.058 3.947-6.447.573-.336 1.303.1 1.197.763-.2 1.246.174 2.503.973 3.467.156.189.436.11.479-.13.247-1.377.953-2.63 2.004-3.553 1.333-1.17 2.272-2.693 2.65-4.4.114-.512.737-.716 1.12-.38C19.457 7.2 21 10.174 21 13.5c0 5.247-4.253 9.5-9.5 9.5h.5z" />
          </svg>
          <span className={styles.streakNumber}>{streak}</span>
        </div>
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
