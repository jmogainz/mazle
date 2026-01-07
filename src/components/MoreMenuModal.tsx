'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './MoreMenuModal.module.css';

type MoreMenuModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenLeaderboard?: () => void;
  onOpenAccount?: () => void;
  onOpenArchive?: () => void;
  triggerButtonRef?: React.RefObject<HTMLButtonElement>;
};

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

function MoreMenuModal({
  open,
  onClose,
  onOpenLeaderboard,
  onOpenAccount,
  onOpenArchive,
  triggerButtonRef,
}: MoreMenuModalProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);

  const showLockedFeatures = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') return true;
    return previewFeaturesEnabled;
  }, [previewFeaturesEnabled]);

  useEffect(() => {
    if (!open) return;
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, [open]);

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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to prevent immediate close from the trigger click
    const timeout = setTimeout(() => {
      window.addEventListener('click', onClick);
    }, 10);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('click', onClick);
    };
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
    <div ref={menuRef} className={styles.dropdown} style={style} role="menu" aria-label="Menu">
      {showLockedFeatures && (
        <>
          {/* Leaderboard button hidden - keeping code for potential future use
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
          */}
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => handleClick(onOpenArchive)}
            role="menuitem"
          >
            <span>Archive</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        </>
      )}
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
    </div>
  );
}

export default React.memo(MoreMenuModal);
