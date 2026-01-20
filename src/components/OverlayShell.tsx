'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './OverlayShell.module.css';

type OverlayShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  variant?: 'overlay' | 'page';
  align?: 'center' | 'top';
  closeHref?: string;
  ariaLabel?: string;
  onClose?: () => void;
  /** When provided, controls visibility. Component stays mounted after first open for instant re-opens. */
  open?: boolean;
};

export default function OverlayShell({
  title,
  subtitle,
  children,
  variant = 'overlay',
  align = 'center',
  closeHref,
  ariaLabel,
  onClose,
  open,
}: OverlayShellProps) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Track if modal has ever been opened (for keep-mounted pattern)
  const [hasBeenOpened, setHasBeenOpened] = useState(open ?? true);

  useEffect(() => {
    if (open) setHasBeenOpened(true);
  }, [open]);

  const defaultClose = useMemo(() => {
    if (onClose) return onClose;
    if (variant === 'overlay') return () => router.back();
    return () => router.push(closeHref ?? '/');
  }, [router, variant, closeHref, onClose]);

  // Focus close button when opening
  useEffect(() => {
    if (open !== false) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  // Escape key handler - only when open
  useEffect(() => {
    if (open === false) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') defaultClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [defaultClose, open]);

  // Don't render until first opened (when using open prop)
  if (open !== undefined && !hasBeenOpened) {
    return null;
  }

  const isVisible = open ?? true;
  const containerClass = variant === 'overlay'
    ? `${styles.backdrop} ${align === 'top' ? styles.backdropTop : ''} ${!isVisible ? styles.backdropHidden : ''}`
    : styles.page;
  const cardClass = variant === 'overlay' ? styles.card : `${styles.card} ${styles.cardPage}`;

  return (
    <div
      className={containerClass}
      role="dialog"
      aria-modal={variant === 'overlay' ? 'true' : undefined}
      aria-label={ariaLabel ?? title}
      aria-hidden={!isVisible}
      onClick={variant === 'overlay' && isVisible ? defaultClose : undefined}
    >
      <div className={cardClass} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>{title}</div>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={defaultClose}
            aria-label="Close"
            title="Close"
            tabIndex={isVisible ? 0 : -1}
          >
            ✕
          </button>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
