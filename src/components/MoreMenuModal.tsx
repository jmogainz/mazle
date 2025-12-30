'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './MoreMenuModal.module.css';

type MoreMenuModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function MoreMenuModal({ open, onClose }: MoreMenuModalProps) {
  const router = useRouter();
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    firstButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const nav = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Menu" onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Menu</div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.list}>
          <button
            ref={firstButtonRef}
            type="button"
            className={styles.menuButton}
            onClick={() => nav('/leaderboard')}
          >
            <span>Leaderboard</span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className={styles.menuButton} onClick={() => nav('/archive')}>
            <span>Archive</span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className={styles.menuButton} onClick={() => nav('/account')}>
            <span>Account</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div className={styles.hint}>Mazle #N is the primary label. Dates are shown as a secondary label.</div>
      </div>
    </div>
  );
}

