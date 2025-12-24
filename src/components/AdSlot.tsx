'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import styles from './AdSlot.module.css';

type AdSlotProps = {
  placement: 'postGame' | 'leaderboard' | 'archive' | 'account';
  className?: string;
};

function isAdsEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ADS_ENABLED;
  return v === '1' || v === 'true';
}

export default function AdSlot({ placement, className }: AdSlotProps) {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!isAdsEnabled()) return;
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (cancelled) return;
        const adsRemoved = me.entitlements.adsRemoved;
        setShouldShow(!adsRemoved);
      })
      .catch(() => {
        // Fail closed: no ads if we can't determine entitlement.
        if (cancelled) return;
        setShouldShow(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAdsEnabled() || !shouldShow) return null;

  // Placeholder slot. Real ad network integration can replace this component later.
  return (
    <div className={`${styles.container} ${className ?? ''}`.trim()} aria-label={`Ad slot: ${placement}`}>
      <div className={styles.hint}>Advertisement</div>
    </div>
  );
}

