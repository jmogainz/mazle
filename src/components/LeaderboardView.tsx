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
import { formatTime, getTodaysResult, recordLeaderboardRank } from '@/utils/storage';
import { onGameEvent } from '@/game/events';
import CharacterIcon from './CharacterIcon';
import PullToRefresh from './PullToRefresh';
import styles from './LeaderboardView.module.css';

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';
const LEADERBOARD_PAGE_SIZE = 200;
const LOAD_MORE_THRESHOLD_PX = 180;

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

  const cachedTop = useMemo(() => readCachedLeaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, 0), [todayDate]);
  const cachedMe = useMemo(() => readCachedLeaderboardMe(todayDate), [todayDate]);
  const [topState, setTopState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardTop>>>>(
    cachedTop ? { status: 'loaded', data: cachedTop } : { status: 'loading' }
  );
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardMe>>>>(
    cachedMe ? { status: 'loaded', data: cachedMe } : { status: 'loading' }
  );
  const [viewerMode, setViewerMode] = useState<'unknown' | 'guest' | 'user'>('unknown');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreEpochRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const refreshLeaderboard = useCallback(async () => {
    try {
      loadMoreEpochRef.current += 1;
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
      const [top, me] = await Promise.all([
        fetchLeaderboardTopFresh(todayDate, LEADERBOARD_PAGE_SIZE, 0),
        fetchLeaderboardMeFresh(todayDate),
      ]);
      setTopState({ status: 'loaded', data: top });
      setMeState({ status: 'loaded', data: me });
    } catch {
      // Keep existing data on refresh failure
    }
  }, [todayDate]);

  // Listen for leaderboardRefresh event (fired after puzzle completion)
  useEffect(() => {
    const unsubscribe = onGameEvent('leaderboardRefresh', () => {
      refreshLeaderboard();
    });
    return unsubscribe;
  }, [refreshLeaderboard]);

  useEffect(() => {
    if (!showLockedFeatures) return;
    cachedApi
      .me()
      .then((me) => setViewerMode(me.mode))
      .catch(() => setViewerMode('unknown'));
  }, [showLockedFeatures]);

  useEffect(() => {
    if (!showLockedFeatures) return;

    const cached = readCachedLeaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, 0);
    if (cached) {
      setTopState({ status: 'loaded', data: cached });
    }

    cachedApi
      .leaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, 0)
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

  const loadMore = useCallback(async () => {
    if (topState.status !== 'loaded') return;
    const requestedOffset = topState.data.nextOffset;
    if (requestedOffset == null) return;
    if (loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const epoch = loadMoreEpochRef.current;

    try {
      const page = await api.leaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, requestedOffset);
      if (loadMoreEpochRef.current !== epoch) return;

      setTopState((prev) => {
        if (prev.status !== 'loaded') return prev;
        const seen = new Set(prev.data.entries.map((entry) => entry.rank));
        const appended = page.entries.filter((entry) => !seen.has(entry.rank));
        const merged = prev.data.entries.concat(appended);
        const total = page.total ?? prev.data.total;
        const nextOffset =
          page.nextOffset ??
          (appended.length > 0 && total != null
            ? requestedOffset + appended.length < total
              ? requestedOffset + appended.length
              : null
            : null);

        return {
          status: 'loaded',
          data: {
            ...prev.data,
            entries: merged,
            total,
            nextOffset,
            podium: prev.data.podium ?? page.podium,
          },
        };
      });
    } catch {
      // ignore load more failures
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [todayDate, topState]);

  useEffect(() => {
    const listContainer = listRef.current;
    if (!listContainer) return;
    
    const scrollContainer = listContainer.closest('[class*="container"]') as HTMLElement;
    if (!scrollContainer) return;

    const handleScroll = () => {
      if (topState.status !== 'loaded') return;
      const remaining = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (remaining <= LOAD_MORE_THRESHOLD_PX) {
        loadMore();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [loadMore, topState.status]);

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
      if (result.rank != null) {
        recordLeaderboardRank(todayDate, result.rank);
      }
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
      fetchLeaderboardTopFresh(todayDate, LEADERBOARD_PAGE_SIZE, 0)
        .then((top) => {
          loadMoreEpochRef.current += 1;
          loadingMoreRef.current = false;
          setIsLoadingMore(false);
          setTopState({ status: 'loaded', data: top });
        })
        .catch(() => null);
    } catch {
      setSubmitState('failed');
    }
  }, [attemptsUsed, canSubmit, todayDate, todayResult]);

  const handleOpenAccount = useCallback(() => {
    router.push('/account');
  }, [router]);

  const entries = topState.status === 'loaded' ? topState.data.entries : [];
  const hasMore = topState.status === 'loaded' && topState.data.nextOffset != null;
  const totalCount = topState.status === 'loaded' ? topState.data.total ?? null : null;
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
  const restEntries = entries.filter((entry) => entry.rank > 3);

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
      return (
        <div className={styles.meRow}>
          <div className={styles.skeletonText} style={{ width: 80 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className={styles.skeletonText} style={{ width: 40 }} />
            <div className={styles.skeletonText} style={{ width: 28 }} />
            <div className={styles.skeletonText} style={{ width: 36 }} />
          </div>
        </div>
      );
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
        <div className={`${styles.podium} ${styles.podiumLoading}`}>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <div className={styles.skeletonAvatar} style={{ width: 40, height: 40 }} />
            </div>
            <div className={`${styles.skeletonText}`} style={{ width: '70%', marginBottom: 4 }} />
            <div className={`${styles.skeletonBar}`} style={{ width: '100%', height: 45 }} />
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <div className={styles.skeletonAvatar} style={{ width: 48, height: 48 }} />
            </div>
            <div className={`${styles.skeletonText}`} style={{ width: '70%', marginBottom: 4 }} />
            <div className={`${styles.skeletonBar}`} style={{ width: '100%', height: 60 }} />
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumAvatar}>
              <div className={styles.skeletonAvatar} style={{ width: 40, height: 40 }} />
            </div>
            <div className={`${styles.skeletonText}`} style={{ width: '70%', marginBottom: 4 }} />
            <div className={`${styles.skeletonBar}`} style={{ width: '100%', height: 35 }} />
          </div>
        </div>
      )}

      {topState.status === 'error' && <div className={styles.error}>{topState.message}</div>}

      <PullToRefresh onRefresh={refreshLeaderboard} className={styles.scrollArea}>
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

            {(hasMore || isLoadingMore) && (
              <div className={styles.loadMoreRow}>
                {isLoadingMore ? (
                  <div className={styles.loadMoreSpinner} />
                ) : (
                  <div className={styles.loadMoreHint}>Scroll for more</div>
                )}
              </div>
            )}

            {!hasMore && !isLoadingMore && totalCount != null && (
              <div className={styles.loadMoreEnd}>End of leaderboard · {totalCount} players</div>
            )}
          </div>
        )}

        {topState.status === 'loaded' && entries.length === 0 && (
          <div className={styles.hintText}>No entries yet — be the first!</div>
        )}

        {topState.status === 'loading' && (
          <div className={styles.list} ref={listRef}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.row}>
                <div className={styles.rowRank}>#{i + 4}</div>
                <div className={styles.skeletonText} style={{ width: '60%' }} />
                <div className={styles.skeletonText} style={{ width: 50 }} />
                <div className={styles.skeletonText} style={{ width: 28 }} />
              </div>
            ))}
          </div>
        )}
      </PullToRefresh>

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
