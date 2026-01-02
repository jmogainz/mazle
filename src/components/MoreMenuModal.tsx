'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './MoreMenuModal.module.css';

type MoreMenuModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenLeaderboard?: () => void;
  onOpenAccount?: () => void;
  onOpenArchive?: () => void;
};

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

export default function MoreMenuModal({
  open,
  onClose,
  onOpenLeaderboard,
  onOpenAccount,
  onOpenArchive,
}: MoreMenuModalProps) {
  const router = useRouter();
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);

  const showLockedFeatures = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') return true;
    return previewFeaturesEnabled;
  }, [previewFeaturesEnabled]);

  useEffect(() => {
    if (!open) return;
    firstButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, [open]);

  const nav = useCallback(
    (href: string, onOpen?: () => void) => {
      if (onOpen) {
        onOpen();
        onClose();
        return;
      }
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

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
          {showLockedFeatures && (
            <>
              <button
                ref={firstButtonRef}
                type="button"
                className={styles.menuButton}
                onClick={() => nav('/leaderboard', onOpenLeaderboard)}
              >
                <span>Leaderboard</span>
                <span aria-hidden="true">›</span>
              </button>
              <button type="button" className={styles.menuButton} onClick={() => nav('/archive', onOpenArchive)}>
                <span>Archive</span>
                <span aria-hidden="true">›</span>
              </button>
            </>
          )}
          <button
            ref={showLockedFeatures ? undefined : firstButtonRef}
            type="button"
            className={styles.menuButton}
            onClick={() => nav('/account', onOpenAccount)}
          >
            <span>Account</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div className={styles.hint}>Mazle #N is the primary label. Dates are shown as a secondary label.</div>
      </div>
    </div>
  );
}
