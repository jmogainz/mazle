'use client';

import { useEffect, useRef } from 'react';

type AdFormat = 'auto' | 'rectangle' | 'horizontal' | 'vertical';

interface AdSlotProps {
  slot?: string;
  placement?: 'postGame';
  className?: string;
  style?: React.CSSProperties;
  format?: AdFormat;
  responsive?: boolean;
  onSlotStatus?: (status: 'filled' | 'unfilled') => void;
  enabled?: boolean;
}

const AD_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || 'ca-pub-4676376614824147';

export default function AdSlot({ slot, placement, className, style, format, responsive = false, onSlotStatus, enabled = true }: AdSlotProps) {
  const pushedRef = useRef(false);
  const insRef = useRef<HTMLModElement>(null);
  const effectiveSlot = slot || '';
  const isDev = effectiveSlot.startsWith('DEV_');

  useEffect(() => {
    if (!enabled) return;
    if (isDev || !effectiveSlot || !AD_CLIENT) return;
    if (pushedRef.current) return;
    pushedRef.current = true;
    try {
      (window as any).adsbygoogle = (window as any).adsbygoogle || [];
      (window as any).adsbygoogle.push({});
    } catch {
      // AdSense can throw if the script isn't ready yet; fail silently.
    }
  }, [effectiveSlot, isDev, enabled]);

  useEffect(() => {
    if (!insRef.current || !onSlotStatus || isDev || !enabled) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-ad-status') {
          const status = insRef.current?.getAttribute('data-ad-status');
          if (status === 'filled' || status === 'unfilled') {
            onSlotStatus(status);
          }
        }
      }
    });

    observer.observe(insRef.current, { attributes: true });

    return () => observer.disconnect();
  }, [onSlotStatus, isDev, enabled]);

  useEffect(() => {
    if (!enabled || !onSlotStatus || !isDev) return;
    onSlotStatus('filled');
  }, [enabled, onSlotStatus, isDev]);

  // If no slot provided (legacy placement-only usage), render nothing or placeholder
  if (!effectiveSlot || !AD_CLIENT) {
    if (placement) {
      // Legacy placeholder for placement-based slots
      return null;
    }
    return null;
  }

  if (isDev) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.1)',
          border: '1px dashed #666',
          color: '#666',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}
      >
        AD SLOT: {effectiveSlot}
      </div>
    );
  }

  return (
    <ins
      ref={insRef}
      className={`adsbygoogle${className ? ` ${className}` : ''}`}
      style={{ display: 'block', ...style }}
      data-ad-client={AD_CLIENT}
      data-ad-slot={effectiveSlot}
      data-ad-format={format}
      data-full-width-responsive={responsive ? 'true' : undefined}
    />
  );
}
