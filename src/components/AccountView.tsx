'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cachedApi, fetchMeFresh, readCachedMe } from '@/lib/api/cached';
import { getPrefs, setPrefs } from '@/lib/prefs';
import styles from './AccountView.module.css';

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function isAppleEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_APPLE_OIDC_ENABLED;
  return v === '1' || v === 'true';
}

export default function AccountView() {
  const router = useRouter();
  const cachedMe = useMemo(() => readCachedMe(), []);
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.me>>>>(
    cachedMe ? { status: 'loaded', data: cachedMe } : { status: 'loading' }
  );
  const [busy, setBusy] = useState<'idle' | 'signin' | 'signout'>('idle');
  const [autoSubmitWins, setAutoSubmitWins] = useState(() => getPrefs().leaderboardAutoSubmitWins);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);

  const refreshMe = useCallback(async (silent = false, force = false) => {
    if (!silent) {
      setMeState({ status: 'loading' });
    }
    try {
      const me = force ? await fetchMeFresh() : await cachedApi.me();
      setMeState({ status: 'loaded', data: me });
      return me;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load account';
      setMeState({ status: 'error', message });
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe(!!cachedMe);
  }, [refreshMe, cachedMe]);

  useEffect(() => {
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, []);

  const showLockedFeatures = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') return true;
    return previewFeaturesEnabled;
  }, [previewFeaturesEnabled]);

  const isSignedIn = useMemo(() => meState.status === 'loaded' && meState.data.mode === 'user', [meState]);

  const handleToggleAutoSubmit = useCallback(() => {
    setAutoSubmitWins((prev) => {
      const next = !prev;
      setPrefs({ leaderboardAutoSubmitWins: next });
      return next;
    });
  }, []);

  const startSignIn = useCallback(
    (provider: 'google' | 'apple') => {
      const callbackUrl = '/account';
      window.location.href = `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    },
    [refreshMe],
  );

  const handleSignOut = useCallback(() => {
    if (!isSignedIn) return;
    window.location.href = `/api/auth/signout?callbackUrl=${encodeURIComponent('/')}`;
  }, [isSignedIn, refreshMe]);

  const goToArchive = useCallback(() => {
    router.push('/archive');
  }, [router]);

  const me = meState.status === 'loaded' ? meState.data : null;

  return (
    <div className={styles.grid}>
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>You</div>
        {meState.status === 'loading' && <div className={styles.modeHint}>Loading…</div>}
        {meState.status === 'error' && <div className={styles.error}>{meState.message}</div>}
        {me && (
          <>
            <div className={styles.identityRow}>
              <div className={styles.identityLeft}>
                <div className={styles.displayName}>{me.displayName}</div>
                <div className={styles.modeHint}>
                  {me.mode === 'guest'
                    ? 'Guest profile (not synced across devices)'
                    : 'Signed in'}
                </div>
              </div>
              <div className={styles.chip}>{me.mode === 'guest' ? 'GUEST' : 'USER'}</div>
            </div>

            {me.mode === 'guest' ? (
              <>
                <div className={styles.modeHint} style={{ marginTop: '0.75rem' }}>
                  Sign in to save your name and keep purchases across devices.
                </div>
                <div className={styles.buttonRow}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => startSignIn('google')}
                    disabled={busy !== 'idle'}
                  >
                    {busy === 'signin' ? 'Signing in…' : 'Continue with Google'}
                  </button>
                </div>
                {isAppleEnabled() && (
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.appleButton}
                      onClick={() => startSignIn('apple')}
                      disabled={busy !== 'idle'}
                      aria-label="Sign in with Apple"
                    >
                      <span className={styles.appleIcon} aria-hidden="true">
                        <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                          <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282z" />
                        </svg>
                      </span>
                      <span>Sign in with Apple</span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleSignOut}
                  disabled={busy !== 'idle'}
                >
                  {busy === 'signout' ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showLockedFeatures && (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>Settings</div>
          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleLabel}>Auto-submit wins</div>
              <div className={styles.toggleHint}>
                Automatically submits your daily win to the leaderboard.
              </div>
            </div>
            <div className={styles.toggleControl}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={autoSubmitWins}
                onChange={handleToggleAutoSubmit}
              />
            </div>
          </div>
        </div>
      )}

      {me && showLockedFeatures && (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>Access</div>
          <div className={styles.entitlements}>
            <div className={styles.entitlementRow}>
              <div className={styles.entitlementLabel}>Archive</div>
              <div className={styles.entitlementValue}>{me.entitlements.archiveAccess ? 'Unlocked' : 'Locked'}</div>
            </div>
            <div className={styles.entitlementRow}>
              <div className={styles.entitlementLabel}>Ads</div>
              <div className={styles.entitlementValue}>{me.entitlements.adsRemoved ? 'Removed' : 'Shown'}</div>
            </div>
          </div>

          {!me.entitlements.archiveAccess && (
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={goToArchive}
              >
                Unlock Archive
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
