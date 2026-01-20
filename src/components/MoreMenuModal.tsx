'use client';

import React, { useEffect, useState } from 'react';
import styles from './MoreMenuModal.module.css';

type MoreMenuModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenStats?: () => void;
  onOpenLeaderboard?: () => void;
  onOpenHallOfFame?: () => void;
  onOpenAccount?: () => void;
  triggerButtonRef?: React.RefObject<HTMLButtonElement>;
};

function MoreMenuModal({
  open,
  onClose,
  onOpenStats,
  onOpenLeaderboard,
  onOpenHallOfFame,
  onOpenAccount,
  triggerButtonRef,
}: MoreMenuModalProps) {
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);

  // Calculate menu position based on trigger button
  useEffect(() => {
    if (!open || !triggerButtonRef?.current) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = triggerButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      // Position menu below the button with a small gap
      setMenuPosition({
        top: rect.bottom + 4, // 4px gap below button
        right: window.innerWidth - rect.right, // Align to right edge of button
      });
    };

    updatePosition();

    // Update position on window resize
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [open, triggerButtonRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleClick = (callback?: () => void) => {
    if (callback) {
      callback();
    }
    onClose();
  };

  if (!open) return null;

  const style = menuPosition
    ? { top: `${menuPosition.top}px`, right: `${menuPosition.right}px` }
    : undefined;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.dropdown} style={style} role="menu" aria-label="Menu">
        <button
          type="button"
          className={styles.menuItem}
          onClick={() => handleClick(onOpenStats)}
          role="menuitem"
        >
          <span>Stats</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.menuItem}
          onClick={() => handleClick(onOpenLeaderboard)}
          role="menuitem"
        >
          <span>Leaderboard</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21V10h6V3h6v4h6v14H3zM9 10v11M15 7v14" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.menuItem}
          onClick={() => handleClick(onOpenHallOfFame)}
          role="menuitem"
        >
          <span>Hall of Fame</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 18h8" />
            <path d="M12 12v6" />
            <path d="M7 4h10" />
            <path d="M17 4v3a5 5 0 0 1-10 0V4" />
            <path d="M5 5a2 2 0 0 0 2 2" />
            <path d="M19 5a2 2 0 0 1-2 2" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.menuItem}
          onClick={() => handleClick(onOpenAccount)}
          role="menuitem"
        >
          <span>Account</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </button>
        <a
          href="https://ko-fi.com/mazle"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.menuItem}
          onClick={() => onClose()}
          role="menuitem"
        >
          <span>Support Us</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </a>
      </div>
    </>
  );
}

export default React.memo(MoreMenuModal);
