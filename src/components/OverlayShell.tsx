'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './OverlayShell.module.css';

type OverlayShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  variant?: 'overlay' | 'page';
  closeHref?: string;
  ariaLabel?: string;
  onClose?: () => void;
};

export default function OverlayShell({
  title,
  subtitle,
  children,
  variant = 'overlay',
  closeHref,
  ariaLabel,
  onClose,
}: OverlayShellProps) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const defaultClose = useMemo(() => {
    if (onClose) return onClose;
    if (variant === 'overlay') return () => router.back();
    return () => router.push(closeHref ?? '/');
  }, [router, variant, closeHref, onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') defaultClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [defaultClose]);

  const containerClass = variant === 'overlay' ? styles.backdrop : styles.page;
  const cardClass = variant === 'overlay' ? styles.card : `${styles.card} ${styles.cardPage}`;

  return (
    <div
      className={containerClass}
      role="dialog"
      aria-modal={variant === 'overlay' ? 'true' : undefined}
      aria-label={ariaLabel ?? title}
      onClick={variant === 'overlay' ? defaultClose : undefined}
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
          >
            ✕
          </button>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
