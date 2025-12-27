'use client';

import { useEffect, useRef, useState } from 'react';

type ConsentSource = 'default' | 'geo' | 'cmp' | 'timeout';

interface ConsentState {
  ready: boolean;
  gdprApplies: boolean | null;
  source: ConsentSource;
}

const IS_PROD = process.env.NEXT_PUBLIC_ENV === 'prod';
const CMP_ENABLED = process.env.NEXT_PUBLIC_CMP_ENABLED
  ? process.env.NEXT_PUBLIC_CMP_ENABLED === 'true'
  : IS_PROD;
const CMP_FAIL_OPEN = process.env.NEXT_PUBLIC_CMP_FAIL_OPEN
  ? process.env.NEXT_PUBLIC_CMP_FAIL_OPEN === 'true'
  : !IS_PROD;
const CMP_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_CMP_TIMEOUT_MS ?? 4000);

const GDPR_COUNTRIES = new Set([
  // EU
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA (non-EU)
  'IS', 'LI', 'NO',
  // UK + Switzerland
  'GB', 'UK', 'CH',
]);

function readCookie(name: string) {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getGdprFromCookie(): boolean | null {
  const country = readCookie('geo_country').toUpperCase();
  if (!country) return null;
  return GDPR_COUNTRIES.has(country);
}

function setAdRequestsPaused(paused: boolean) {
  if (typeof window === 'undefined') return;
  const ads = ((window as any).adsbygoogle = (window as any).adsbygoogle || []);
  ads.pauseAdRequests = paused ? 1 : 0;
}

export function useAdConsent() {
  const initialGdpr = getGdprFromCookie();
  const [state, setState] = useState<ConsentState>(() => {
    if (!CMP_ENABLED) return { ready: true, gdprApplies: null, source: 'default' };
    if (initialGdpr === false) return { ready: true, gdprApplies: false, source: 'geo' };
    return { ready: false, gdprApplies: initialGdpr, source: 'default' };
  });
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (!CMP_ENABLED) return;

    const gdprApplies = getGdprFromCookie();
    if (gdprApplies === false) {
      setState({ ready: true, gdprApplies: false, source: 'geo' });
      return;
    }

    setAdRequestsPaused(true);

    const markReady = (applies: boolean | null, source: ConsentSource) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      setState({ ready: true, gdprApplies: applies, source });
      setAdRequestsPaused(false);
    };

    const attachTcfListener = () => {
      const tcfapi = (window as any).__tcfapi;
      if (typeof tcfapi !== 'function') return;

      tcfapi('addEventListener', 2, (tcData: any, success: boolean) => {
        if (!success || resolvedRef.current) return;
        const applies =
          typeof tcData?.gdprApplies === 'boolean' ? tcData.gdprApplies : gdprApplies ?? null;
        if (applies === false) {
          markReady(false, 'cmp');
          return;
        }
        const status = tcData?.eventStatus;
        if (status === 'tcloaded' || status === 'useractioncomplete') {
          markReady(true, 'cmp');
        }
      });
    };

    attachTcfListener();
    const pollId = window.setInterval(() => {
      if (resolvedRef.current) return;
      const refreshedGdpr = getGdprFromCookie();
      if (refreshedGdpr === false) {
        markReady(false, 'geo');
        return;
      }
      attachTcfListener();
    }, 250);

    const timeoutId = window.setTimeout(() => {
      if (resolvedRef.current) return;
      if (CMP_FAIL_OPEN) {
        markReady(gdprApplies ?? true, 'timeout');
      }
    }, CMP_TIMEOUT_MS);

    return () => {
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  return {
    consentReady: state.ready,
    gdprApplies: state.gdprApplies,
    cmpEnabled: CMP_ENABLED,
    consentSource: state.source,
  };
}
