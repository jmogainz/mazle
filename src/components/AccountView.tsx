'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getApiMode } from '@/lib/api';
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
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.me>>>>({ status: 'loading' });
  const [busy, setBusy] = useState<'idle' | 'signin' | 'signout'>('idle');
  const [autoSubmitWins, setAutoSubmitWins] = useState(() => getPrefs().leaderboardAutoSubmitWins);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);

  const refreshMe = useCallback(async () => {
    setMeState({ status: 'loading' });
    try {
      const me = await api.me();
      setMeState({ status: 'loaded', data: me });
      return me;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load account';
      setMeState({ status: 'error', message });
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

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
      if (getApiMode() === 'mock') {
        setBusy('signin');
        api
          .claim({})
          .then(() => refreshMe())
          .finally(() => setBusy('idle'));
        return;
      }

      const callbackUrl = '/account';
      window.location.href = `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    },
    [refreshMe],
  );

  const handleSignOut = useCallback(() => {
    if (!isSignedIn) return;
    if (getApiMode() === 'mock') {
      setBusy('signout');
      try {
        localStorage.removeItem('mazle_mock_me_v1');
      } catch {
        // ignore
      }
      refreshMe().finally(() => setBusy('idle'));
      return;
    }

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
                      className={styles.secondaryButton}
                      onClick={() => startSignIn('apple')}
                      disabled={busy !== 'idle'}
                    >
                      Continue with Apple
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
