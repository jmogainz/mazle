'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  cachedApi,
  fetchLeaderboardMeFresh,
  fetchLeaderboardTopFresh,
  readCachedLeaderboardMe,
  readCachedLeaderboardTop,
  readCachedMe,
} from '@/lib/api/cached';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';
import { formatTime, getTodaysResult } from '@/utils/storage';
import CharacterIcon from './CharacterIcon';
import styles from './LeaderboardView.module.css';

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function computeAttemptsUsed(result: ReturnType<typeof getTodaysResult>): number | null {
  if (!result) return null;
  if (result.failed) return null;
  const failedAttempts = result.attempts?.length ?? 0;
  return Math.min(3, Math.max(1, failedAttempts + 1));
}

function LeaderboardView() {
  const router = useRouter();
  const todayDate = useMemo(() => getNewYorkDateString(), []);
  const puzzleNumber = useMemo(() => getPuzzleNumberFromNyDateString(todayDate), [todayDate]);
  const todayResult = useMemo(() => getTodaysResult(), []);

  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);
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

  const cachedTop = useMemo(() => readCachedLeaderboardTop(todayDate, 50), [todayDate]);
  const cachedMe = useMemo(() => readCachedLeaderboardMe(todayDate), [todayDate]);
  const [topState, setTopState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardTop>>>>(
    cachedTop ? { status: 'loaded', data: cachedTop } : { status: 'loading' }
  );
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardMe>>>>(
    cachedMe ? { status: 'loaded', data: cachedMe } : { status: 'loading' }
  );
  const [viewerMode, setViewerMode] = useState<'unknown' | 'guest' | 'user'>('unknown');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    // We attach listRef to the list container. 
    // If it's not present (e.g. loading or error), we might not have it.
    // However, if we just want to update when it exists:
    if (!scrollContainer) return;
    
    // If listRef is null, we can still attach scroll listener but it won't do anything.
    // But we want to re-run this when listRef becomes available.
    // The dependency array handles this? No, refs don't trigger re-renders.
    // But topState changes trigger re-renders which re-runs this effect.
    
    let rafId: number;
    const update = () => {
      const listContainer = listRef.current;
      if (!listContainer) return;

      const viewHeight = scrollContainer.clientHeight;
      const scrollTop = scrollContainer.scrollTop;

      const children = listContainer.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        const childHeight = child.offsetHeight;
        // relativeTop is the position of the top edge of the child relative to the viewport top
        const relativeTop = child.offsetTop - scrollTop;
        // relativeBottom is the position of the bottom edge relative to the viewport top
        const relativeBottom = relativeTop + childHeight;

        let fractionVisible = 1;

        if (relativeBottom > viewHeight) {
          // Crossing bottom edge
          // Visible pixels = how much is above the bottom edge
          const visiblePixels = Math.max(0, viewHeight - relativeTop);
          fractionVisible = Math.min(1, visiblePixels / childHeight);
        } else if (relativeTop < 0) {
          // Crossing top edge
          // Visible pixels = how much is below the top edge
          const visiblePixels = Math.max(0, relativeBottom);
          fractionVisible = Math.min(1, visiblePixels / childHeight);
        }

        if (fractionVisible < 1) {
           // Scale from 0.9 to 1.0 based on visibility
           const scale = 0.9 + 0.1 * fractionVisible;
           // Opacity from 0.3 to 1.0 based on visibility
           const opacity = 0.3 + 0.7 * fractionVisible;
           
           child.style.transform = `scale(${scale})`;
           child.style.opacity = `${opacity}`;
        } else {
           if (child.style.transform) child.style.transform = '';
           if (child.style.opacity) child.style.opacity = '';
        }
      }
    };

    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    // Also update on window resize
    window.addEventListener('resize', handleScroll);
    
    // Initial update
    update();
    
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [topState]);

  useEffect(() => {
    if (!showLockedFeatures) return;
    cachedApi
      .me()
      .then((me) => setViewerMode(me.mode))
      .catch(() => setViewerMode('unknown'));
  }, [showLockedFeatures]);

  useEffect(() => {
    if (!showLockedFeatures) return;

    const cached = readCachedLeaderboardTop(todayDate, 50);
    if (cached) {
      setTopState({ status: 'loaded', data: cached });
    }

    cachedApi
      .leaderboardTop(todayDate, 50)
      .then((top) => setTopState({ status: 'loaded', data: top }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load';
        setTopState({ status: 'error', message });
      });
  }, [todayDate, showLockedFeatures]);

  useEffect(() => {
    if (!showLockedFeatures) return;

    const cached = readCachedLeaderboardMe(todayDate);
    if (cached) {
      setMeState({ status: 'loaded', data: cached });
    }

    cachedApi
      .leaderboardMe(todayDate)
      .then((me) => setMeState({ status: 'loaded', data: me }))
      .catch(() => setMeState({ status: 'error', message: 'Failed to load' }));
  }, [todayDate, showLockedFeatures]);

  const attemptsUsed = computeAttemptsUsed(todayResult);
  const canSubmitLocal = !!todayResult && todayResult.date === todayDate && !todayResult.failed && attemptsUsed != null;
  const canSubmit = canSubmitLocal && viewerMode === 'user';

  const handleSubmit = useCallback(async () => {
    if (!todayResult || attemptsUsed == null) return;
    if (!canSubmit) return;
    setSubmitState('submitting');
    try {
      await api.resultsRecord({ date: todayDate, completed: true, timeMs: todayResult.timeMs, attemptsUsed });
      const result = await api.leaderboardSubmit({ date: todayDate });
      setSubmitState('submitted');

      const accountMe = readCachedMe();
      const displayName = accountMe?.displayName ?? 'You';
      setMeState({
        status: 'loaded',
        data: {
          date: todayDate,
          rank: result.rank ?? 0,
          displayName,
          timeMs: todayResult.timeMs,
          attemptsUsed,
        },
      });

      fetchLeaderboardMeFresh(todayDate)
        .then((me) => setMeState({ status: 'loaded', data: me }))
        .catch(() => null);
      fetchLeaderboardTopFresh(todayDate, 50)
        .then((top) => setTopState({ status: 'loaded', data: top }))
        .catch(() => null);
    } catch {
      setSubmitState('failed');
    }
  }, [attemptsUsed, canSubmit, todayDate, todayResult]);

  const handleOpenAccount = useCallback(() => {
    router.push('/account');
  }, [router]);

  const entries = topState.status === 'loaded' ? topState.data.entries : [];
  const podium = useMemo(() => {
    if (topState.status !== 'loaded') return [];
    if (topState.data.podium && topState.data.podium.length > 0) return topState.data.podium;
    return topState.data.entries.slice(0, 3).map((e) => ({
      rank: e.rank as 1 | 2 | 3,
      displayName: e.displayName,
      timeMs: e.timeMs,
      attemptsUsed: e.attemptsUsed,
      characterId: 'default',
      skinId: 'default',
      isMe: e.isMe,
    }));
  }, [topState]);
  const restEntries = entries.length >= 3 ? entries.slice(3) : entries;

  const podiumByRank = useMemo(() => new Map(podium.map((p) => [p.rank, p])), [podium]);
  const first = podiumByRank.get(1);
  const second = podiumByRank.get(2);
  const third = podiumByRank.get(3);

  if (!showLockedFeatures) {
    return (
      <div className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>Leaderboard coming soon</div>
          <div className={styles.hintText}>We&apos;re still polishing this feature.</div>
        </div>
      </div>
    );
  }

  const mePanel = () => {
    const accountMe = readCachedMe();
    const displayName = accountMe?.displayName ?? 'You';

    if (meState.status === 'loading' || meState.status === 'idle') {
      return <div className={styles.hintText}>Loading your rank…</div>;
    }
    if (meState.status === 'error') {
      return <div className={styles.hintText}>Unable to load your rank.</div>;
    }

    const me = meState.data;
    if (me) {
      return (
        <div className={styles.meRow}>
          <div className={styles.meName}>{me.displayName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className={styles.rowTime}>{formatTime(me.timeMs)}</div>
            <div className={styles.rowAttempts}>{me.attemptsUsed}/3</div>
            <div className={styles.rank}>#{me.rank}</div>
          </div>
        </div>
      );
    }

    if (!todayResult || todayResult.date !== todayDate) {
      return <div className={styles.hintText}>Play today&apos;s puzzle to join the leaderboard.</div>;
    }

    const attemptsDisplay = todayResult.failed ? '(DNF)' : `${attemptsUsed}/3`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div className={styles.meRow}>
          <div className={styles.meName}>{displayName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className={styles.rowTime}>{formatTime(todayResult.timeMs)}</div>
            <div className={styles.rowAttempts}>{attemptsDisplay}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: '0.2rem' }}>
          {todayResult.failed ? (
            <div className={styles.hintText}>Only successful solves can be submitted.</div>
          ) : viewerMode !== 'user' ? (
            <button type="button" className={styles.submitButtonSmall} onClick={handleOpenAccount}>
              Sign in to submit
            </button>
          ) : (
            <button
              type="button"
              className={styles.submitButtonSmall}
              onClick={handleSubmit}
              disabled={submitState === 'submitting' || !canSubmit}
            >
              {submitState === 'submitting' ? '...' : 'Submit Time'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.grid}>
      <div className={styles.dayTitle}>
        <div className={styles.dayTitleMain}>Mazle #{puzzleNumber}</div>
        <div className={styles.dayTitleSub}>Today</div>
      </div>

      {topState.status === 'loaded' && podium.length >= 3 && (
        <div className={styles.podium}>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon characterId={second?.characterId} skinId={second?.skinId} size={40} />
            </div>
            <div className={styles.podiumName}>{second?.displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
              <div className={styles.podiumRankBadge}>🥈</div>
              <div className={styles.podiumTime}>{second ? formatTime(second.timeMs) : ''}</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon characterId={first?.characterId} skinId={first?.skinId} size={48} />
            </div>
            <div className={styles.podiumName}>{first?.displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
              <div className={styles.podiumRankBadge}>🥇</div>
              <div className={styles.podiumTime}>{first ? formatTime(first.timeMs) : ''}</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon characterId={third?.characterId} skinId={third?.skinId} size={40} />
            </div>
            <div className={styles.podiumName}>{third?.displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
              <div className={styles.podiumRankBadge}>🥉</div>
              <div className={styles.podiumTime}>{third ? formatTime(third.timeMs) : ''}</div>
            </div>
          </div>
        </div>
      )}

      {topState.status === 'loading' && (
        <div className={styles.podium} style={{ opacity: 0.4, filter: 'blur(2px)' }}>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon size={40} />
            </div>
            <div className={styles.podiumName}>Player2</div>
            <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
              <div className={styles.podiumRankBadge}>🥈</div>
              <div className={styles.podiumTime}>0:00</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon size={48} />
            </div>
            <div className={styles.podiumName}>Player1</div>
            <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
              <div className={styles.podiumRankBadge}>🥇</div>
              <div className={styles.podiumTime}>0:00</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon size={40} />
            </div>
            <div className={styles.podiumName}>Player3</div>
            <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
              <div className={styles.podiumRankBadge}>🥉</div>
              <div className={styles.podiumTime}>0:00</div>
            </div>
          </div>
        </div>
      )}

      {topState.status === 'error' && <div className={styles.error}>{topState.message}</div>}

      <div className={styles.scrollArea} ref={scrollRef}>
        {topState.status === 'loaded' && restEntries.length > 0 && (
          <div className={styles.list} ref={listRef}>
            {restEntries.map((e) => (
              <div key={`${e.rank}-${e.displayName}`} className={`${styles.row} ${e.isMe ? styles.rowMe : ''}`.trim()}>
                <div className={styles.rowRank}>#{e.rank}</div>
                <div className={styles.rowName}>{e.displayName}</div>
                <div className={styles.rowTime}>{formatTime(e.timeMs)}</div>
                <div className={styles.rowAttempts}>{e.attemptsUsed}/3</div>
              </div>
            ))}
          </div>
        )}

        {topState.status === 'loaded' && entries.length === 0 && (
          <div className={styles.hintText}>No entries yet — be the first!</div>
        )}

        {topState.status === 'loading' && (
          <div className={styles.list} ref={listRef}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.row} style={{ opacity: 0.4 }}>
                <div className={styles.rowRank}>#{i + 4}</div>
                <div
                  className={styles.rowName}
                  style={{ background: 'var(--color-surface)', borderRadius: 4, width: '60%', height: '1em' }}
                >
                  &nbsp;
                </div>
                <div
                  className={styles.rowTime}
                  style={{ background: 'var(--color-surface)', borderRadius: 4, width: 50, height: '1em' }}
                >
                  &nbsp;
                </div>
                <div className={styles.rowAttempts}>–/3</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.sectionTitle} style={{ marginBottom: '0.5rem' }}>
          You
        </div>
        {mePanel()}
        {submitState === 'failed' && <div className={styles.error} style={{ marginTop: '0.5rem' }}>Couldn&apos;t submit. Try again.</div>}
      </div>
    </div>
  );
}

export default React.memo(LeaderboardView);
