'use client';

import { useEffect } from 'react';
import { getPrefs, onPrefsChanged } from '@/lib/prefs';

type ResolvedTheme = 'light' | 'dark';

function resolveTheme(pref: 'system' | 'light' | 'dark'): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const prefs = getPrefs();
  const resolved = resolveTheme(prefs.themePreference);
  document.documentElement.dataset.theme = resolved;
  (document.documentElement.style as any).colorScheme = resolved;
}

export default function ThemeApplier() {
  useEffect(() => {
    applyTheme();

    const unsubscribe = onPrefsChanged(() => applyTheme());

    const media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    const onChange = () => {
      const prefs = getPrefs();
      if (prefs.themePreference !== 'system') return;
      applyTheme();
    };

    if (media) {
      media.addEventListener?.('change', onChange);
    }

    return () => {
      unsubscribe();
      if (media) {
        media.removeEventListener?.('change', onChange);
      }
    };
  }, []);

  return null;
}

