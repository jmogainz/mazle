'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { api } from '@/lib/api';
import { cachedApi, readCachedMe } from '@/lib/api/cached';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';
import { formatTimeMs, getTodaysResult, recordLeaderboardRank } from '@/utils/storage';
import { emitGameEvent, onGameEvent } from '@/game/events';
import CharacterIcon from './CharacterIcon';
import PullToRefresh from './PullToRefresh';
import styles from './LeaderboardView.module.css';

const LEADERBOARD_PAGE_SIZE = 200;
const LOAD_MORE_THRESHOLD_PX = 180;
const LEADERBOARD_MAX_ROWS = 1000;
const AUTO_GAP_PREFETCH_MAX = 800;
type StickyPosition = 'top' | 'inline' | 'bottom';

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
  const todayDate = useMemo(() => getNewYorkDateString(), []);
  const puzzleNumber = useMemo(() => getPuzzleNumberFromNyDateString(todayDate), [todayDate]);
  const [todayResult, setTodayResult] = useState(() => getTodaysResult());

  // User has played today if they have any result for today (win or fail)
  const hasPlayedToday = useMemo(() => {
    return !!todayResult && todayResult.date === todayDate;
  }, [todayResult, todayDate]);

  const [topState, setTopState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardTop>>>>(
    { status: 'loading' }
  );
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardMe>>>>(
    { status: 'loading' }
  );
  const [viewerMode, setViewerMode] = useState<'unknown' | 'guest' | 'user'>('unknown');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const myRowRef = useRef<HTMLDivElement>(null);
  const stickyTopRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef<HTMLDivElement>(null);
  const loadMoreEpochRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const stickyPositionRef = useRef<StickyPosition>('bottom');

  const maxLoadedRank = useMemo(() => {
    if (topState.status !== 'loaded') return null;
    if (topState.data.entries.length === 0) return null;
    return Math.max(...topState.data.entries.map((e) => e.rank));
  }, [topState]);

  const prefillGapToRank = useCallback(
    async (top: Awaited<ReturnType<typeof api.leaderboardTop>>, rank?: number | null) => {
      if (!rank || rank <= 3 || rank > LEADERBOARD_MAX_ROWS) return top;

      const maxLoadedRank = top.entries.length > 0 ? Math.max(...top.entries.map((e) => e.rank)) : null;
      if (maxLoadedRank != null && rank <= maxLoadedRank) return top;
      if (maxLoadedRank != null && rank - maxLoadedRank > AUTO_GAP_PREFETCH_MAX) return top;

      let merged = top;
      let nextOffset = top.nextOffset;
      let maxRank = maxLoadedRank ?? 0;

      while (nextOffset != null && maxRank < rank) {
        try {
          const page = await api.leaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, nextOffset);
          const seen = new Set(merged.entries.map((e) => e.rank));
          const appended = page.entries.filter((e) => !seen.has(e.rank));
          merged = {
            ...merged,
            entries: [...merged.entries, ...appended].sort((a, b) => a.rank - b.rank),
            total: page.total ?? merged.total,
            nextOffset: page.nextOffset,
            podium: merged.podium ?? page.podium,
          };
          if (page.entries.length === 0) break;
          maxRank = merged.entries.length > 0 ? Math.max(...merged.entries.map((e) => e.rank)) : maxRank;
          nextOffset = page.nextOffset;
        } catch {
          break;
        }
      }

      return merged;
    },
    [todayDate]
  );

  const refreshLeaderboard = useCallback(async () => {
    try {
      loadMoreEpochRef.current += 1;
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
      // Re-read local result in case puzzle was just completed
      setTodayResult(getTodaysResult());
      const [top, me] = await Promise.all([
        api.leaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, 0),
        api.leaderboardMe(todayDate),
      ]);
      const filledTop = await prefillGapToRank(top, me?.rank ?? null);
      setTopState({ status: 'loaded', data: filledTop });
      setMeState({ status: 'loaded', data: me });
    } catch {
      // Keep existing data on refresh failure
    }
  }, [todayDate, prefillGapToRank]);

  // Auto-refresh on mount (every time modal opens)
  useEffect(() => {
    refreshLeaderboard();
  }, [refreshLeaderboard]);

  // Listen for leaderboardRefresh event (fired after puzzle completion)
  useEffect(() => {
    const unsubscribe = onGameEvent('leaderboardRefresh', () => {
      refreshLeaderboard();
    });
    return unsubscribe;
  }, [refreshLeaderboard]);

  // Load viewer mode from cached account info (fast)
  useEffect(() => {
    const cached = readCachedMe();
    if (cached) {
      setViewerMode(cached.mode);
    } else {
      cachedApi
        .me()
        .then((me) => setViewerMode(me.mode))
        .catch(() => setViewerMode('unknown'));
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (topState.status !== 'loaded') return;
    const requestedOffset = topState.data.nextOffset;
    if (requestedOffset == null) return;
    if (maxLoadedRank && maxLoadedRank >= LEADERBOARD_MAX_ROWS) return;
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
        const maxRank = merged.length > 0 ? Math.max(...merged.map((entry) => entry.rank)) : null;
        const total = page.total ?? prev.data.total;
        const nextOffset =
          page.nextOffset ??
          (appended.length > 0 && total != null
            ? requestedOffset + appended.length < total
              ? requestedOffset + appended.length
              : null
            : null);
        const cappedNextOffset = maxRank && maxRank >= LEADERBOARD_MAX_ROWS ? null : nextOffset;

        return {
          status: 'loaded',
          data: {
            ...prev.data,
            entries: merged,
            total,
            nextOffset: cappedNextOffset,
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
  }, [todayDate, topState, maxLoadedRank]);

  const attemptsUsed = computeAttemptsUsed(todayResult);

  // Compute user's leaderboard data for the sticky row (moved early for updateStickyPosition and restEntries merge)
  const myEntryData = useMemo(() => {
    const accountMe = readCachedMe();
    const displayName = accountMe?.displayName ?? 'You';

    if (meState.status === 'loaded' && meState.data) {
      const me = meState.data;
      return { rank: me.rank, displayName: me.displayName, timeMs: me.timeMs, attemptsUsed: me.attemptsUsed, submitted: true };
    }

    if (todayResult && todayResult.date === todayDate && !todayResult.failed && attemptsUsed != null) {
      return { rank: null, displayName, timeMs: todayResult.timeMs, attemptsUsed, submitted: false };
    }

    return null;
  }, [meState, todayResult, todayDate, attemptsUsed]);

  // Track sticky position based on scroll - uses direct DOM manipulation for opacity (no re-renders)
  const updateStickyPosition = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    const myRow = myRowRef.current;
    const stickyTop = stickyTopRef.current;
    const stickyBottom = stickyBottomRef.current;

    const setVisibility = (position: StickyPosition) => {
      // Use classList toggle instead of inline visibility to respect parent visibility:hidden
      if (stickyTop) {
        const showTop = position === 'top';
        stickyTop.classList.toggle(styles.stickyVisible, showTop);
      }
      if (stickyBottom) {
        const showBottom = position === 'bottom';
        stickyBottom.classList.toggle(styles.stickyVisible, showBottom);
      }
      if (myRow) {
        // Inline row: hide when sticky version shows, show when inline
        const hideInline = position !== 'inline';
        myRow.classList.toggle(styles.inlineHidden, hideInline);
      }
    };

    if (!myEntryData) {
      if (stickyTop) {
        stickyTop.classList.remove(styles.stickyVisible);
      }
      if (stickyBottom) {
        stickyBottom.classList.remove(styles.stickyVisible);
      }
      if (myRow) {
        myRow.classList.remove(styles.inlineHidden);
      }
      return;
    }

    // If there's no inline row to track, keep at bottom
    if (!scrollContainer || !myRow) {
      stickyPositionRef.current = 'bottom';
      setVisibility('bottom');
      return;
    }

    const epsilon = 0.5;
    const topWall = 0;
    const bottomWall = scrollContainer.clientHeight;
    const rowTop = Math.round(myRow.offsetTop - scrollContainer.scrollTop);
    const rowBottom = rowTop + myRow.offsetHeight;

    let newPosition: StickyPosition;
    if (rowTop <= topWall + epsilon) {
      newPosition = 'top';
    } else if (rowBottom >= bottomWall - epsilon) {
      newPosition = 'bottom';
    } else {
      newPosition = 'inline';
    }

    stickyPositionRef.current = newPosition;
    setVisibility(newPosition);
  }, [myEntryData]);

  // Update sticky position when data changes or after initial render
  useLayoutEffect(() => {
    updateStickyPosition();
  }, [topState, meState, myEntryData, updateStickyPosition]);

  const canSubmitLocal = !!todayResult && todayResult.date === todayDate && !todayResult.failed && attemptsUsed != null;
  const canSubmit = canSubmitLocal && viewerMode === 'user';

  const handleSubmit = useCallback(async () => {
    if (!todayResult || attemptsUsed == null) return;
    if (!canSubmit) return;
    setSubmitState('submitting');
    let stage: 'resultsRecord' | 'leaderboardSubmit' = 'resultsRecord';
    try {
      stage = 'resultsRecord';
      await api.resultsRecord({ date: todayDate, completed: true, timeMs: todayResult.timeMs, attemptsUsed });
      invalidateMeCache();
      stage = 'leaderboardSubmit';
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

      api.leaderboardMe(todayDate)
        .then((me) => setMeState({ status: 'loaded', data: me }))
        .catch(() => null);
      api.leaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, 0)
        .then((top) => prefillGapToRank(top, result.rank ?? null))
        .then((top) => {
          loadMoreEpochRef.current += 1;
          loadingMoreRef.current = false;
          setIsLoadingMore(false);
          setTopState({ status: 'loaded', data: top });
        })
        .catch(() => null);
    } catch (err) {
      const anyErr = err as (Error & { errorCode?: string; status?: number }) | unknown;
      const message = anyErr instanceof Error ? anyErr.message : 'Failed to submit';
      const code = typeof (anyErr as any)?.errorCode === 'string' ? (anyErr as any).errorCode : undefined;
      const status = typeof (anyErr as any)?.status === 'number' ? (anyErr as any).status : undefined;
      console.error('[leaderboard submit failed]', { stage, code, status, message, err });
      setSubmitState('failed');
    }
  }, [attemptsUsed, canSubmit, prefillGapToRank, todayDate, todayResult]);

  const entries = topState.status === 'loaded' ? topState.data.entries : [];
  const totalCount = topState.status === 'loaded' ? topState.data.total ?? null : null;
  const cappedTotal = totalCount != null ? Math.min(totalCount, LEADERBOARD_MAX_ROWS) : null;
  const hasMore =
    topState.status === 'loaded' &&
    maxLoadedRank != null &&
    (cappedTotal != null ? maxLoadedRank < cappedTotal : topState.data.nextOffset != null);
  
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
  const rawRestEntries = entries.filter((entry) => entry.rank > 3);

  // Merge user's entry into the list at correct position if not already present
  const restEntries = useMemo(() => {
    // Only merge if user is submitted (has rank) and rank > 3 (not in podium)
    if (!myEntryData?.rank || myEntryData.rank <= 3 || !myEntryData.submitted) {
      return rawRestEntries;
    }
    
    // Already in the list via isMe flag from server data
    if (rawRestEntries.some(e => e.isMe)) {
      return rawRestEntries;
    }
    
    const myRankValue = myEntryData.rank;
    
    // Check if rank is within or adjacent to loaded range
    const minRank = rawRestEntries.length > 0 ? Math.min(...rawRestEntries.map(e => e.rank)) : null;
    const maxRank = rawRestEntries.length > 0 ? Math.max(...rawRestEntries.map(e => e.rank)) : null;
    
    // Only insert if within loaded range (or extending by 1)
    if (minRank !== null && maxRank !== null) {
      if (myRankValue < minRank - 1 || myRankValue > maxRank + 1) {
        return rawRestEntries;
      }
    }
    
    // Create synthetic entry for user
    const syntheticEntry = {
      rank: myRankValue,
      displayName: myEntryData.displayName,
      timeMs: myEntryData.timeMs,
      attemptsUsed: myEntryData.attemptsUsed,
      isMe: true,
    };
    
    // Merge and sort
    const merged = [...rawRestEntries, syntheticEntry].sort((a, b) => a.rank - b.rank);
    return merged;
  }, [rawRestEntries, myEntryData]);

  // Track loading state for bidirectional pagination
  const [isLoadingDown, setIsLoadingDown] = useState(false);
  const loadingDownRef = useRef(false);

  // Load entries below current range using offset-based pagination (200 at a time)
  const loadDown = useCallback(async () => {
    if (loadingDownRef.current || !maxLoadedRank) return;
    if (maxLoadedRank >= LEADERBOARD_MAX_ROWS) return;
    if (totalCount && maxLoadedRank >= totalCount) return;
    loadingDownRef.current = true;
    setIsLoadingDown(true);

    try {
      // Offset is maxLoadedRank - 3 (since rank 4 is offset 0)
      const targetOffset = maxLoadedRank - 3;
      const page = await api.leaderboardTop(todayDate, LEADERBOARD_PAGE_SIZE, targetOffset);

      setTopState((prev) => {
        if (prev.status !== 'loaded') return prev;
        const seen = new Set(prev.data.entries.map((e) => e.rank));
        const newEntries = page.entries.filter((e) => !seen.has(e.rank));
        const merged = [...prev.data.entries, ...newEntries].sort((a, b) => a.rank - b.rank);
        const maxRank = merged.length > 0 ? Math.max(...merged.map((e) => e.rank)) : null;
        const total = page.total ?? prev.data.total;
        const capped = total != null ? Math.min(total, LEADERBOARD_MAX_ROWS) : LEADERBOARD_MAX_ROWS;
        const nextOffset = maxRank != null && maxRank >= capped ? null : prev.data.nextOffset;
        return {
          ...prev,
          data: { ...prev.data, entries: merged, total, nextOffset },
        };
      });
    } catch {
      // Ignore load failures
    } finally {
      loadingDownRef.current = false;
      setIsLoadingDown(false);
    }
  }, [todayDate, maxLoadedRank, totalCount]);

  // Scroll handler for bidirectional pagination
  useEffect(() => {
    const listContainer = listRef.current;
    if (!listContainer) return;

    const scrollContainer = listContainer.closest('[class*="container"]') as HTMLElement;
    if (!scrollContainer) return;
    scrollContainerRef.current = scrollContainer;

    const handleScroll = () => {
      if (topState.status !== 'loaded') return;

      // Check for loading more at bottom (threshold before reaching end)
      const remaining = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (remaining <= LOAD_MORE_THRESHOLD_PX && (!maxLoadedRank || maxLoadedRank < LEADERBOARD_MAX_ROWS)) {
        loadMore();
        loadDown();
      }

      updateStickyPosition();
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [loadMore, loadDown, topState.status, updateStickyPosition]);

  const podiumByRank = useMemo(() => new Map(podium.map((p) => [p.rank, p])), [podium]);
  const first = podiumByRank.get(1);
  const second = podiumByRank.get(2);
  const third = podiumByRank.get(3);

  // Check if user's entry is in the podium (rank 1-3)
  const isUserInPodium = useMemo(() => {
    if (!myEntryData?.rank) return false;
    return myEntryData.rank <= 3;
  }, [myEntryData]);

  // Scroll to user's position in the list, fetching nearby entries if needed
  const scrollToMyPosition = useCallback(async () => {
    if (!myEntryData?.rank || myEntryData.rank <= 3) return; // Podium users don't need this
    if (myEntryData.rank > LEADERBOARD_MAX_ROWS) return;
    
    const rank = myEntryData.rank;
    
    // Check if the user's rank is already loaded
    if (topState.status === 'loaded') {
      const alreadyLoaded = topState.data.entries.some(e => e.rank === rank);
      if (alreadyLoaded) {
        // Already have it, just scroll
        requestAnimationFrame(() => {
          myRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return;
      }
    }
    
    // Fetch entries around user's rank
    try {
      const around = await api.leaderboardAround(todayDate, rank, 10);
      
      // Merge with existing entries
      setTopState((prev) => {
        if (prev.status !== 'loaded') return prev;
        const seen = new Set(prev.data.entries.map((e) => e.rank));
        const newEntries = around.entries.filter((e) => !seen.has(e.rank));
        const merged = [...prev.data.entries, ...newEntries].sort((a, b) => a.rank - b.rank);
        return {
          ...prev,
          data: { ...prev.data, entries: merged },
        };
      });
      
      // Wait for render then scroll
      requestAnimationFrame(() => {
        setTimeout(() => {
          myRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      });
    } catch {
      // Fallback: just try to scroll if possible
      myRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [myEntryData, topState, todayDate]);

  // Render user's row as a card (used both inline and sticky)
  const canJumpToMyRow = !!(myEntryData?.rank && myEntryData.rank > 3 && myEntryData.rank <= LEADERBOARD_MAX_ROWS);

  const renderMyRow = (isSticky: boolean, position?: 'top' | 'bottom', rowRef?: React.Ref<HTMLDivElement>) => {
    if (!myEntryData) return null;
    if (isUserInPodium && !isSticky) return null; // Don't show inline duplicate for podium users, but allow sticky

    const stickyClass = isSticky
      ? position === 'top' ? styles.stickyTop : styles.stickyBottom
      : '';

    const rankDisplay = myEntryData.rank != null && myEntryData.rank > 0 
      ? `#${myEntryData.rank}` 
      : <span className={styles.pendingRank}><span /><span /><span /></span>;

    // Color rank based on podium position
    const rankColorClass = myEntryData.rank === 1 ? styles.rankGold
      : myEntryData.rank === 2 ? styles.rankSilver
      : myEntryData.rank === 3 ? styles.rankBronze
      : '';

    // Use yellow for unsubmitted, green for submitted
    const highlightClass = myEntryData.submitted ? styles.rowMeHighlight : styles.rowMePending;

    // Sticky rows are tappable to scroll to position
    const handleClick = isSticky && canJumpToMyRow ? scrollToMyPosition : undefined;
    const clickableClass = isSticky && canJumpToMyRow ? styles.rowClickable : '';

    return (
      <div
        ref={isSticky ? rowRef : myRowRef}
        className={`${styles.row} ${highlightClass} ${stickyClass} ${clickableClass}`.trim()}
        onClick={handleClick}
        role={isSticky && canJumpToMyRow ? 'button' : undefined}
        tabIndex={isSticky && canJumpToMyRow ? 0 : undefined}
        onKeyDown={isSticky && canJumpToMyRow ? (e) => { if (e.key === 'Enter' || e.key === ' ') scrollToMyPosition(); } : undefined}
      >
        <div className={`${styles.rowRank} ${rankColorClass}`.trim()}>{rankDisplay}</div>
        <div className={styles.rowName}>{myEntryData.displayName}</div>
        <div className={styles.rowTime}>{formatTimeMs(myEntryData.timeMs)}</div>
        <div className={styles.rowAttempts}>{myEntryData.attemptsUsed}/3</div>
      </div>
    );
  };

  const renderStickyRow = (position: 'top' | 'bottom') => {
    const rowRef = position === 'top' ? stickyTopRef : stickyBottomRef;
    const row = renderMyRow(true, position, rowRef);
    if (!row) return null;
    const anchorClass = position === 'top' ? styles.stickyAnchorTop : styles.stickyAnchorBottom;
    return (
      <div className={`${styles.stickyAnchor} ${anchorClass}`.trim()}>
        {row}
      </div>
    );
  };

  // Render submit prompt (only shown when not submitted)
  const renderSubmitPrompt = () => {
    if (!todayResult || todayResult.date !== todayDate) {
      return <div className={styles.hintText} style={{ textAlign: 'center', padding: '0.5rem' }}>Play today&apos;s puzzle to join the leaderboard.</div>;
    }
    
    if (todayResult.failed) {
      return <div className={styles.hintText} style={{ textAlign: 'center', padding: '0.5rem' }}>Only successful solves can be submitted.</div>;
    }
    
    if (meState.status === 'loaded' && meState.data) {
      return null; // Already submitted
    }
    
    return (
      <div className={styles.submitPrompt}>
        {viewerMode !== 'user' ? (
          <button 
            type="button" 
            className={styles.submitButtonSmall}
            onClick={() => emitGameEvent('openAccount', null)}
          >
            Sign in to submit
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.submitButtonSmall} ${submitState === 'submitting' ? styles.submitting : ''}`.trim()}
            onClick={handleSubmit}
            disabled={submitState === 'submitting' || !canSubmit}
          >
            {submitState === 'submitting' ? (
              <span className={styles.submitButtonContent}>
                <span className={styles.submitSpinner} />
                Submitting
              </span>
            ) : (
              'Submit Time'
            )}
          </button>
        )}
      </div>
    );
  };

  // Compute user's rank position for inline rendering
  const myRank = myEntryData?.rank;
  const showPostLoadUi = topState.status === 'loaded' && meState.status === 'loaded';

  return (
    <div className={styles.grid}>
      <div className={styles.dayTitle}>
        <div className={styles.dayTitleMain}>Mazle #{puzzleNumber}</div>
        <div className={styles.dayTitleSub}>Today</div>
      </div>

      {topState.status === 'loaded' && podium.length >= 3 && (
        <div className={styles.podium}>
          <div className={`${styles.podiumColumn} ${second?.isMe ? styles.podiumColumnMe : ''}`.trim()}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon characterId={second?.characterId} skinId={second?.skinId} size={40} />
            </div>
            <div className={styles.podiumName}>{second?.displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
              <div className={styles.podiumRankBadge}>🥈</div>
              <div className={`${styles.podiumTime} ${!hasPlayedToday ? styles.podiumTimeHidden : ''}`.trim()}>{second ? formatTimeMs(second.timeMs) : ''}</div>
            </div>
          </div>
          <div className={`${styles.podiumColumn} ${first?.isMe ? styles.podiumColumnMe : ''}`.trim()}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon characterId={first?.characterId} skinId={first?.skinId} size={48} />
            </div>
            <div className={styles.podiumName}>{first?.displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
              <div className={styles.podiumRankBadge}>🥇</div>
              <div className={`${styles.podiumTime} ${!hasPlayedToday ? styles.podiumTimeHidden : ''}`.trim()}>{first ? formatTimeMs(first.timeMs) : ''}</div>
            </div>
          </div>
          <div className={`${styles.podiumColumn} ${third?.isMe ? styles.podiumColumnMe : ''}`.trim()}>
            <div className={styles.podiumAvatar}>
              <CharacterIcon characterId={third?.characterId} skinId={third?.skinId} size={40} />
            </div>
            <div className={styles.podiumName}>{third?.displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
              <div className={styles.podiumRankBadge}>🥉</div>
              <div className={`${styles.podiumTime} ${!hasPlayedToday ? styles.podiumTimeHidden : ''}`.trim()}>{third ? formatTimeMs(third.timeMs) : ''}</div>
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

      <PullToRefresh onRefresh={refreshLeaderboard} className={styles.scrollArea} edgeFade edgeFadeSelector={`.${styles.row}:not(.${styles.rowMeHighlight}):not(.${styles.rowMePending})`}>
        {/* Sticky row at top when scrolled past user's position */}
        {showPostLoadUi && myEntryData && renderStickyRow('top')}
        
        {topState.status === 'loaded' && restEntries.length > 0 && (
          <div className={styles.list} ref={listRef}>
            {restEntries.map((e) => {
              // For entries that are isMe, we render the highlighted version with the ref
              if (e.isMe) {
                return (
                  <div 
                    key={`${e.rank}-${e.displayName}`} 
                    ref={myRowRef}
                    data-rank={e.rank}
                    className={`${styles.row} ${styles.rowMeHighlight}`.trim()}
                  >
                    <div className={styles.rowRank}>#{e.rank}</div>
                    <div className={styles.rowName}>{e.displayName}</div>
                    <div className={styles.rowTime}>{formatTimeMs(e.timeMs)}</div>
                    <div className={styles.rowAttempts}>{e.attemptsUsed}/3</div>
                  </div>
                );
              }
              return (
                <div key={`${e.rank}-${e.displayName}`} data-rank={e.rank} className={styles.row}>
                  <div className={styles.rowRank}>#{e.rank}</div>
                  <div className={styles.rowName}>{e.displayName}</div>
                  <div className={`${styles.rowTime} ${!hasPlayedToday ? styles.timeHidden : ''}`.trim()}>{formatTimeMs(e.timeMs)}</div>
                  <div className={styles.rowAttempts}>{e.attemptsUsed}/3</div>
                </div>
              );
            })}

            {/* If user has submitted but their rank is beyond loaded entries, show placeholder at end */}
            {myRank && myRank > 3 && !restEntries.some(e => e.isMe) && myEntryData && (
              <div 
                ref={myRowRef}
                className={`${styles.row} ${styles.rowMeHighlight}`.trim()}
              >
                <div className={styles.rowRank}>#{myRank}</div>
                <div className={styles.rowName}>{myEntryData.displayName}</div>
                <div className={styles.rowTime}>{formatTimeMs(myEntryData.timeMs)}</div>
                <div className={styles.rowAttempts}>{myEntryData.attemptsUsed}/3</div>
              </div>
            )}

            {(hasMore || isLoadingMore || isLoadingDown) && (
              <div className={styles.loadMoreRow}>
                {isLoadingMore ? (
                  <div className={styles.loadMoreSpinner} />
                ) : (
                  <div className={styles.loadMoreHint}>Scroll for more</div>
                )}
              </div>
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

        {!hasPlayedToday && topState.status === 'loaded' && (
          <div className={styles.spoilerAnchor}>
            <div className={`${styles.row} ${styles.spoilerRow} ${styles.spoilerRowSticky}`.trim()}>
              <div className={styles.spoilerBanner}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                Times hidden until you play
              </div>
            </div>
          </div>
        )}

        {/* Sticky row at bottom when user's position is below viewport */}
        {showPostLoadUi && myEntryData && renderStickyRow('bottom')}
      </PullToRefresh>
      
      {/* Submit prompt for users who haven't submitted yet */}
      {showPostLoadUi && renderSubmitPrompt()}
      
      {submitState === 'failed' && (
        <div className={styles.error} style={{ marginTop: '0.5rem' }}>
          Couldn&apos;t submit. Try again.
        </div>
      )}
    </div>
  );
}

export default React.memo(LeaderboardView);
