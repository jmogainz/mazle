'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signOut } from 'next-auth/react';
import { api, getApiMode } from '@/lib/api';
import { cachedApi, fetchMeFresh, readCachedMe } from '@/lib/api/cached';
import { getPrefs, setPrefs } from '@/lib/prefs';
import { addDays } from '@/lib/date';
import { getAllSkins, getSkinById, getUnlockedSkins } from '@/lib/skins';
import { getAllCharacters, getCharacterById } from '@/lib/characters';
import { getNewYorkDateString } from '@/game/puzzleGenerator';
import { formatTime, getGuestHistoryForAccountImport } from '@/utils/storage';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import CharacterIcon from './CharacterIcon';
import SkinWheelItem from './SkinWheelItem';
import styles from './AccountView.module.css';

const IS_UI_DEV_ENV = process.env.NEXT_PUBLIC_ENV === 'dev';
const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';
const GUEST_IMPORT_PREFIX = 'mazle_guest_history_imported_v1:';
const MOCK_ME_STORAGE_KEY = 'mazle_mock_me_v1';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function isAppleEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_APPLE_OIDC_ENABLED;
  return v === '1' || v === 'true';
}

type LocalAccountStats = {
  playedStreak: number;
  winStreak: number;
  totalPlayed: number;
  totalWins: number;
  avgSolveTimeMs: number | null;
};

function computePlayedStreak(datesDesc: string[], today: string): number {
  if (datesDesc.length === 0) return 0;
  const yesterday = addDays(today, -1);
  const mostRecent = datesDesc[0]!;
  if (mostRecent !== today && mostRecent !== yesterday) return 0;

  let streak = 1;
  let prev = mostRecent;
  for (let i = 1; i < datesDesc.length; i += 1) {
    const expected = addDays(prev, -1);
    const next = datesDesc[i]!;
    if (next !== expected) break;
    streak += 1;
    prev = next;
  }
  return streak;
}

function computeWinStreak(rowsDesc: Array<{ date: string; completed: boolean }>, today: string): number {
  if (rowsDesc.length === 0) return 0;
  const yesterday = addDays(today, -1);
  const mostRecent = rowsDesc[0]!;
  if (!mostRecent.completed) return 0;
  if (mostRecent.date !== today && mostRecent.date !== yesterday) return 0;

  let streak = 1;
  let prev = mostRecent.date;
  for (let i = 1; i < rowsDesc.length; i += 1) {
    const row = rowsDesc[i]!;
    const expected = addDays(prev, -1);
    if (row.date !== expected) break;
    if (!row.completed) break;
    streak += 1;
    prev = row.date;
  }
  return streak;
}

function computeLocalAccountStats(history: ReturnType<typeof getGuestHistoryForAccountImport>): LocalAccountStats {
  const today = getNewYorkDateString();
  const rowsDesc = [...history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const totalPlayed = rowsDesc.length;
  const totalWins = rowsDesc.filter((r) => r.completed).length;
  const times = rowsDesc.filter((r) => r.completed && r.timeMs != null).map((r) => r.timeMs as number);
  const avgSolveTimeMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  const playedStreak = computePlayedStreak(rowsDesc.map((r) => r.date), today);
  const winStreak = computeWinStreak(rowsDesc.map((r) => ({ date: r.date, completed: r.completed })), today);

  return { playedStreak, winStreak, totalPlayed, totalWins, avgSolveTimeMs };
}

function AccountView() {
  const router = useRouter();
  const cachedMe = useMemo(() => readCachedMe(), []);
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.me>>>>(
    cachedMe ? { status: 'loaded', data: cachedMe } : { status: 'loading' }
  );
  const [busy, setBusy] = useState<'idle' | 'signin' | 'signout'>('idle');
  const [autoSubmitWins, setAutoSubmitWins] = useState(() => getPrefs().leaderboardAutoSubmitWins);
  const [themePreference, setThemePreference] = useState(() => getPrefs().themePreference);
  const [nameDraft, setNameDraft] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [nameStatus, setNameStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [showEditTooltip, setShowEditTooltip] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);
  const [signInExpanded, setSignInExpanded] = useState(false);
  const [skinWheelIndex, setSkinWheelIndex] = useState(0);
  const [isSnapping, setIsSnapping] = useState(false);
  const [unlockHintSkinId, setUnlockHintSkinId] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [provisionalIndex, setProvisionalIndex] = useState<number | null>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragItemWidth = React.useRef<number>(0);
  const dragStartRef = React.useRef<number>(0);

  const me = meState.status === 'loaded' ? meState.data : null;
  const localHistory = useMemo(() => getGuestHistoryForAccountImport(), []);
  const localStats = useMemo(() => computeLocalAccountStats(localHistory), [localHistory]);
  const stats = me?.stats ?? localStats;
  const profile = me?.profile ?? { characterId: 'default', skinId: 'default' };
  const avgTime = stats.avgSolveTimeMs != null ? formatTime(stats.avgSolveTimeMs) : '—';

  const skins = useMemo(() => getAllSkins(), []);

  // Create a buffered array for infinite looping: 11 sets of skins
  // This provides a massive runway so the user never reaches the edge.
  const displaySkins = useMemo(() => [...skins, ...skins, ...skins, ...skins, ...skins, ...skins, ...skins, ...skins, ...skins, ...skins, ...skins], [skins]);
  const BUFFER_OFFSET = skins.length * 5; // Center is the 6th set (index 5 * len)

  const characters = useMemo(() => getAllCharacters(), []);
  const activeCharacter = useMemo(() => getCharacterById(profile.characterId) ?? characters[0]!, [profile.characterId, characters]);
  const activeCharacterIndex = useMemo(() => characters.findIndex(c => c.id === activeCharacter.id), [activeCharacter.id, characters]);

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
    if (meState.status !== 'loaded') return;
    const me = meState.data;
    if (me.mode !== 'user') return;
    const serverValue = me.settings?.leaderboardAutoSubmit;
    if (typeof serverValue !== 'boolean') return;
    setAutoSubmitWins(serverValue);
    setPrefs({ leaderboardAutoSubmitWins: serverValue });
  }, [meState]);

  useEffect(() => {
    if (meState.status !== 'loaded') return;
    const me = meState.data;
    if (me.mode !== 'user') return;

    const serverTheme = me.settings?.theme;
    if (serverTheme === 'system' || serverTheme === 'light' || serverTheme === 'dark') {
      setThemePreference(serverTheme);
      setPrefs({ themePreference: serverTheme });
    }
  }, [meState]);

  useEffect(() => {
    if (meState.status !== 'loaded') return;
    const me = meState.data;
    if (!me) return;
    if (nameTouched) return;
    setNameDraft(me.displayName ?? '');
  }, [meState, nameTouched]);

  useEffect(() => {
    if (meState.status !== 'loaded') return;
    const me = meState.data;
    if (me.mode !== 'user' || !me.userId) return;

    const key = `${GUEST_IMPORT_PREFIX}${me.userId}`;
    let alreadyImported = false;
    try {
      alreadyImported = localStorage.getItem(key) === '1';
    } catch {
      alreadyImported = false;
    }
    if (alreadyImported) return;

    const history = getGuestHistoryForAccountImport();
    if (history.length === 0) {
      try {
        localStorage.setItem(key, '1');
      } catch {
        // ignore
      }
      return;
    }

    api
      .resultsImport({ history })
      .then(() => refreshMe(true, true))
      .then(() => {
        try {
          localStorage.setItem(key, '1');
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // Ignore: can retry later (idempotent).
      });
  }, [meState, refreshMe]);

  useEffect(() => {
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, []);

  // Sync wheel index with profile skin on load
  useEffect(() => {
    const logicalIdx = skins.findIndex((s) => s.id === profile.skinId);
    if (logicalIdx >= 0) {
      // Always start in the exact middle set (3rd one)
      setSkinWheelIndex(logicalIdx + BUFFER_OFFSET);
    }
  }, [profile.skinId, skins, BUFFER_OFFSET]);

  const showLockedFeatures = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') return true;
    return previewFeaturesEnabled;
  }, [previewFeaturesEnabled]);

  const isSignedIn = useMemo(() => meState.status === 'loaded' && meState.data.mode === 'user', [meState]);

  const handleToggleAutoSubmit = useCallback(() => {
    setAutoSubmitWins((prev) => {
      const next = !prev;
      setPrefs({ leaderboardAutoSubmitWins: next });
      if (isSignedIn) {
        api
          .settingsUpdate({ leaderboardAutoSubmit: next })
          .then(() => refreshMe(true, true))
          .catch(() => null);
      }
      return next;
    });
  }, [isSignedIn, refreshMe]);

  const handleThemeChange = useCallback(
    (value: 'system' | 'light' | 'dark') => {
      setThemePreference(value);
      setPrefs({ themePreference: value });
      if (isSignedIn) {
        api
          .settingsUpdate({ theme: value })
          .then(() => refreshMe(true, true))
          .catch(() => null);
      }
    },
    [isSignedIn, refreshMe]
  );

  const handleSaveName = useCallback(async () => {
    if (!isSignedIn) return;
    if (!nameDraft) return;
    setNameStatus('saving');
    setNameError(null);
    try {
      await api.claim({ displayName: nameDraft });
      setNameTouched(false);
      setNameStatus('saved');
      setIsEditingName(false);
      await refreshMe(true, true);
      window.setTimeout(() => setNameStatus('idle'), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update name';
      setNameStatus('error');
      setNameError(message);
    }
  }, [isSignedIn, nameDraft, refreshMe]);

  const startSignIn = useCallback(
    async (provider: 'google' | 'apple') => {
      if (getApiMode() === 'mock') {
        setBusy('signin');
        api
          .claim({})
          .then(() => refreshMe(false, true))
          .finally(() => setBusy('idle'));
        return;
      }

      setBusy('signin');
      const callbackUrl =
        typeof window !== 'undefined' && window.location.pathname.startsWith('/account') ? '/account' : '/';
      await signIn(provider, { callbackUrl });
    },
    [refreshMe],
  );

  const handleSignOut = useCallback(async () => {
    if (!isSignedIn) return;
    if (getApiMode() === 'mock') {
      setBusy('signout');
      try {
        localStorage.removeItem('mazle_mock_me_v1');
      } catch {
        // ignore
      }
      refreshMe(false, true).finally(() => setBusy('idle'));
      return;
    }

    setBusy('signout');
    const callbackUrl =
      typeof window !== 'undefined' && window.location.pathname.startsWith('/account') ? '/account' : '/';
    await signOut({ callbackUrl });
  }, [isSignedIn, refreshMe]);

  const goToArchive = useCallback(() => {
    router.push('/archive');
  }, [router]);

  const applyProfile = useCallback(
    async (changes: { skinId?: string; characterId?: string }) => {
      // Validate inputs locally first
      if (changes.skinId) {
        const s = getSkinById(changes.skinId);
        if (!s || s.locked) return;
      }
      if (changes.characterId) {
        const c = getCharacterById(changes.characterId);
        if (!c || c.locked) return;
      }

      const me = readCachedMe();
      if (!me) return;

      // Optimistic update for UI responsiveness
      // Note: This only affects the cachedMe if we were using a context, 
      // but since we rely on `refreshMe` to update `meState`, we'll see the flicker unless we do more complex state management.
      // However, api.profileUpdate is fast.

      try {
        if (me.mode === 'user') {
          await api.profileUpdate(changes);
        } else {
          // For mock/guest mode, we might still be using the mock API which handles localStorage
          if (getApiMode() === 'mock') {
            await api.profileUpdate(changes);
          }
        }
        await refreshMe(true, true);
      } catch {
        // ignore
      }
    },
    [refreshMe],
  );

  const handleNextCharacter = () => {
    const nextIdx = (activeCharacterIndex + 1) % characters.length;
    const nextChar = characters[nextIdx];
    if (nextChar && !nextChar.locked) {
      applyProfile({ characterId: nextChar.id });
    }
  };

  const handlePrevCharacter = () => {
    const prevIdx = (activeCharacterIndex - 1 + characters.length) % characters.length;
    const prevChar = characters[prevIdx];
    if (prevChar && !prevChar.locked) {
      applyProfile({ characterId: prevChar.id });
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Cache layout metrics ONCE at start of drag to avoid thrashing during move
    if (trackRef.current) {
      const track = trackRef.current;
      const firstItem = track.children[0] as HTMLElement;
      if (firstItem) {
        const gap = parseFloat(getComputedStyle(track).gap) || 0;
        dragItemWidth.current = firstItem.offsetWidth + gap;
      }
    }

    setTouchStartX(e.touches[0].clientX);
    dragStartRef.current = e.touches[0].clientX;
    setIsDragging(true);
    // Note: We do NOT reset dragOffset state here, we rely on the CSS var update in move
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null || !trackRef.current) return;
    const currentX = e.touches[0].clientX;
    const offset = currentX - dragStartRef.current;

    // PERF: Bypass React render cycle for smooth 60fps drag
    // Directly update the CSS variable on the DOM element
    trackRef.current.style.setProperty('--drag-offset', `${offset}px`);

    // Only update React state if the integer index would actually change
    if (dragItemWidth.current > 0) {
      // Calculate index shift: dragging right (offset > 0) reduces index
      const indexShift = Math.round(offset / dragItemWidth.current);
      const newProvisional = skinWheelIndex - indexShift;

      // Only trigger re-render if the highlighted item actually changes
      if (newProvisional !== (provisionalIndex ?? skinWheelIndex)) {
        setProvisionalIndex(newProvisional);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = dragStartRef.current - touchEndX;
    const threshold = 30;

    setIsDragging(false);
    setTouchStartX(null);
    setProvisionalIndex(null);

    // Clear the direct DOM override so React/CSS transition can take over
    if (trackRef.current) {
      trackRef.current.style.removeProperty('--drag-offset');
    }

    if (Math.abs(diff) > threshold) {
      let targetIdx = skinWheelIndex;

      if (dragItemWidth.current > 0) {
        const shift = Math.round(diff / dragItemWidth.current);
        // Ensure at least 1 shift if past threshold
        targetIdx = skinWheelIndex + (shift || (diff > 0 ? 1 : -1));
      } else {
        // Fallback if metrics failed
        targetIdx = skinWheelIndex + (diff > 0 ? 1 : -1);
      }

      setSkinWheelIndex(targetIdx);
      const logicalIdx = (targetIdx % skins.length + skins.length) % skins.length;
      const skin = skins[logicalIdx];
      if (skin && !skin.locked) applyProfile({ skinId: skin.id });
    }
  };

  // Handle infinite loop snapping - aggressive centering
  const handleTransitionEnd = useCallback(() => {
    const len = skins.length;
    if (len === 0) return;

    // Teleport back to the center set (Set 6) while preserving the logical skin
    const logicalIdx = (skinWheelIndex % len + len) % len;
    const targetIdx = logicalIdx + BUFFER_OFFSET;

    if (skinWheelIndex !== targetIdx) {
      setIsSnapping(true);
      setSkinWheelIndex(targetIdx);
    }
  }, [skinWheelIndex, skins.length, BUFFER_OFFSET]);

  // Safety Sync: If we ever drift too far from the center, snap back instantly.
  // This handles extremely fast clicking where transitionEnd might not keep up.
  useEffect(() => {
    const len = skins.length;
    if (len === 0 || isSnapping) return;

    const drift = Math.abs(skinWheelIndex - BUFFER_OFFSET);
    // If we've drifted more than 2 full sets away from the center set
    if (drift > len * 2) {
      const logicalIdx = (skinWheelIndex % len + len) % len;
      setIsSnapping(true);
      setSkinWheelIndex(logicalIdx + BUFFER_OFFSET);
    }
  }, [skinWheelIndex, skins, BUFFER_OFFSET, isSnapping]);

  // Disable snapping after one tick
  useEffect(() => {
    if (isSnapping) {
      const timer = setTimeout(() => setIsSnapping(false), 50);
      return () => clearTimeout(timer);
    }
  }, [isSnapping]);

  return (
    <div className={styles.grid}>
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>You</div>
        {meState.status === 'loading' && <div className={styles.modeHint}>Loading…</div>}
        {meState.status === 'error' && <div className={styles.error}>{meState.message}</div>}
        {me && (
          <>
            {/* Centered Name Header */}
            <div className={styles.youHeader}>
              {isEditingName && me.mode === 'user' ? (
                <>
                  <input
                    className={styles.youNameInput}
                    value={nameDraft}
                    onChange={(e) => {
                      setNameDraft(e.target.value);
                      setNameTouched(true);
                      setNameStatus('idle');
                      setNameError(null);
                    }}
                    maxLength={24}
                    inputMode="text"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                  />
                  <div className={styles.youNameActions}>
                    <button
                      type="button"
                      className={styles.youNameSaveButton}
                      onClick={handleSaveName}
                      disabled={nameStatus === 'saving'}
                    >
                      {nameStatus === 'saving' ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className={styles.youNameCancelButton}
                      onClick={() => {
                        setIsEditingName(false);
                        setNameDraft(me.displayName ?? '');
                        setNameTouched(false);
                        setNameError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {nameStatus === 'error' && nameError && (
                    <div className={styles.error} style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>{nameError}</div>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.youNameRow}>
                    <span className={styles.youName}>{me.displayName}</span>
                    <button
                      type="button"
                      className={styles.youEditButton}
                      onClick={() => {
                        if (me.mode === 'user') {
                          setIsEditingName(true);
                          setNameDraft(me.displayName ?? '');
                        } else {
                          setShowEditTooltip(true);
                          setTimeout(() => setShowEditTooltip(false), 2500);
                        }
                      }}
                      aria-label={me.mode === 'user' ? 'Edit name' : 'Sign in to change your name'}
                    >
                      {showEditTooltip && me.mode === 'guest' && (
                        <div className={styles.youEditTooltip}>Sign in to change your name</div>
                      )}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                  <div className={styles.youModeHint}>
                    {me.mode === 'guest' ? 'Guest' : 'Signed in'}
                  </div>
                </>
              )}
            </div>

            {/* Character Selector Row */}
            <div className={styles.characterSelector}>
              <button type="button" className={styles.characterArrow} onClick={handlePrevCharacter}>&lt;</button>
              <div className={styles.characterName}>{activeCharacter.name}</div>
              <button type="button" className={styles.characterArrow} onClick={handleNextCharacter}>&gt;</button>
            </div>

            {/* Skin Picker Wheel - Carousel */}
            <div className={styles.skinWheel}>
              <button
                type="button"
                className={styles.skinWheelArrow}
                onClick={() => {
                  const nextIdx = skinWheelIndex - 1;
                  setSkinWheelIndex(nextIdx);
                  const logicalIdx = (nextIdx % skins.length + skins.length) % skins.length;
                  const skin = skins[logicalIdx];
                  if (skin && !skin.locked) applyProfile({ skinId: skin.id });
                }}
                aria-label="Previous skin"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <div
                className={styles.skinWheelViewport}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <div
                  ref={trackRef}
                  className={`${styles.skinWheelTrack} ${isSnapping || isDragging ? styles.skinWheelTrackSnapping : ''}`}
                  onTransitionEnd={handleTransitionEnd}
                  style={{
                    '--index': skinWheelIndex,
                  } as React.CSSProperties}
                >
                  {displaySkins.map((skin, idx) => {
                    if (!skin) return null;
                    const isActive = idx === (provisionalIndex ?? skinWheelIndex);
                    return (
                      <SkinWheelItem
                        key={`${skin.id}-${idx}`}
                        skin={skin}
                        isActive={isActive}
                        characterId={profile.characterId}
                        onClick={() => {
                          if (isActive && skin.locked) return;
                          setSkinWheelIndex(idx);
                          applyProfile({ skinId: skin.id });
                        }}
                        showUnlockHint={false}
                      />
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className={styles.skinWheelArrow}
                onClick={() => {
                  const nextIdx = skinWheelIndex + 1;
                  setSkinWheelIndex(nextIdx);
                  const logicalIdx = (nextIdx % skins.length + skins.length) % skins.length;
                  const skin = skins[logicalIdx];
                  if (skin && !skin.locked) applyProfile({ skinId: skin.id });
                }}
                aria-label="Next skin"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Skin name under center */}
            <div className={styles.skinWheelMeta}>
              <div className={styles.skinWheelNameContainer}>
                <div className={styles.skinWheelName}>{skins[((provisionalIndex ?? skinWheelIndex) % skins.length + skins.length) % skins.length]?.name ?? ''}</div>
                {skins[((provisionalIndex ?? skinWheelIndex) % skins.length + skins.length) % skins.length]?.locked && (
                  <span className={styles.skinWheelNameLock}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                      <rect x="6" y="11" width="12" height="10" rx="2" />
                    </svg>
                  </span>
                )}
              </div>
            </div>

            {/* Sign-in / Sign-out Section */}
            {me.mode === 'guest' ? (
              <>
                {!signInExpanded ? (
                  <div className={styles.buttonRow} style={{ flexDirection: 'column', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => setSignInExpanded(true)}
                      disabled={busy !== 'idle'}
                    >
                      Create Account
                    </button>
                    <div className={styles.signInHint}>
                      Save your name and sync purchases across devices.
                    </div>
                  </div>
                ) : (
                  <div className={styles.signInOptions}>
                    <button
                      type="button"
                      className={styles.googleButton}
                      onClick={() => startSignIn('google')}
                      disabled={busy !== 'idle'}
                    >
                      <div className={styles.googleButtonState}></div>
                      <div className={styles.googleButtonContentWrapper}>
                        <div className={styles.googleButtonIcon}>
                          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                            <path fill="none" d="M0 0h48v48H0z"></path>
                          </svg>
                        </div>
                        <span className={styles.googleButtonContents}>
                          {busy === 'signin' ? 'Signing in…' : 'Sign in with Google'}
                        </span>
                        <span style={{ display: 'none' }}>Sign in with Google</span>
                      </div>
                    </button>
                    {isAppleEnabled() && (
                      <button
                        type="button"
                        className={styles.appleButton}
                        onClick={() => startSignIn('apple')}
                        disabled={busy !== 'idle'}
                      >
                        <div className={styles.appleButtonContentWrapper}>
                          <div className={styles.appleButtonIcon}>
                            <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                              <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282z" />
                            </svg>
                          </div>
                          <span className={styles.appleButtonContents}>
                            {busy === 'signin' ? 'Signing in…' : 'Sign in with Apple'}
                          </span>
                        </div>
                      </button>
                    )}
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
              <div className={styles.toggleLabel}>Theme</div>
              <div className={styles.toggleHint}>Choose your preferred appearance</div>
            </div>
            <div className={styles.toggleControl}>
              <div className={styles.themeDropdownWrapper}>
                <button
                  type="button"
                  className={styles.themeTriggerButton}
                  onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
                  aria-haspopup="true"
                  aria-expanded={isThemeMenuOpen}
                >
                  <span className={styles.themeValue}>
                    {themePreference === 'system' ? 'System' : themePreference === 'light' ? 'Light' : 'Dark'}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={styles.chevron}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isThemeMenuOpen && (
                  <>
                    <div className={styles.themeMenuBackdrop} onClick={() => setIsThemeMenuOpen(false)} />
                    <div className={styles.themeMenu}>
                      <button
                        type="button"
                        className={`${styles.themeMenuItem} ${themePreference === 'system' ? styles.themeMenuItemActive : ''}`}
                        onClick={() => {
                          handleThemeChange('system');
                          setIsThemeMenuOpen(false);
                        }}
                      >
                        <span>System</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.themeMenuItem} ${themePreference === 'light' ? styles.themeMenuItemActive : ''}`}
                        onClick={() => {
                          handleThemeChange('light');
                          setIsThemeMenuOpen(false);
                        }}
                      >
                        <span>Light</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="5" />
                          <line x1="12" y1="1" x2="12" y2="3" />
                          <line x1="12" y1="21" x2="12" y2="23" />
                          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                          <line x1="1" y1="12" x2="3" y2="12" />
                          <line x1="21" y1="12" x2="23" y2="12" />
                          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.themeMenuItem} ${themePreference === 'dark' ? styles.themeMenuItemActive : ''}`}
                        onClick={() => {
                          handleThemeChange('dark');
                          setIsThemeMenuOpen(false);
                        }}
                      >
                        <span>Dark</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={styles.toggleRow} style={{ marginTop: '0.9rem' }}>
            <div>
              <div className={styles.toggleLabel}>Auto-Submit</div>
              <div className={styles.toggleHint}>Auto-submit wins to leaderboard</div>
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

      {me && showLockedFeatures && !me.entitlements.archiveAccess && (
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={goToArchive}
          >
            Remove Ads &amp; Unlock Archive
          </button>
        </div>
      )}
    </div>
  );
}

export default React.memo(AccountView);
