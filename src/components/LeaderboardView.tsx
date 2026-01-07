'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  cachedApi,
  fetchLeaderboardAroundFresh,
  fetchLeaderboardMeFresh,
  fetchLeaderboardTopFresh,
  prefetchLeaderboard,
  readCachedLeaderboardAround,
  readCachedLeaderboardMe,
  readCachedLeaderboardTop,
  readCachedMe,
} from '@/lib/api/cached';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { formatTime } from '@/utils/storage';
import { getTodaysResult } from '@/utils/storage';
import styles from './LeaderboardView.module.css';

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

type LoadState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function computeAttemptsUsed(result: ReturnType<typeof getTodaysResult>): number | null {
  if (!result) return null;
  if (result.failed) return null;
  const failedAttempts = result.attempts?.length ?? 0;
  return Math.min(3, Math.max(1, failedAttempts + 1));
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Sub-component for a single day's leaderboard content (podium + list)
type DayPanelProps = {
  date: string;
  todayDate: string;
  showLockedFeatures: boolean;
};

function LeaderboardDayPanel({ date, todayDate, showLockedFeatures }: DayPanelProps) {
  const puzzleNumber = getPuzzleNumberFromNyDateString(date);
  const cachedTop = readCachedLeaderboardTop(date, 50);
  const cachedMe = readCachedLeaderboardMe(date);

  const [topState, setTopState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardTop>>>>(
    cachedTop ? { status: 'loaded', data: cachedTop } : { status: 'loading' }
  );

  useEffect(() => {
    if (!showLockedFeatures) return;

    // Immediately show cached data
    const cached = readCachedLeaderboardTop(date, 50);
    if (cached) {
      setTopState({ status: 'loaded', data: cached });
    }

    // Reload in background
    const load = async () => {
      try {
        const top = await cachedApi.leaderboardTop(date, 50);
        setTopState({ status: 'loaded', data: top });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load';
        setTopState({ status: 'error', message });
      }
    };
    load();
  }, [date, showLockedFeatures]);

  const top3 = topState.status === 'loaded' ? topState.data.entries.slice(0, 3) : [];
  const restEntries = topState.status === 'loaded' ? topState.data.entries.slice(3) : [];

  return (
    <div className={styles.dayPanel}>
      {/* Day title - slides with content */}
      <div className={styles.dayTitle}>
        <div className={styles.dayTitleMain}>Mazle #{puzzleNumber}</div>
        <div className={styles.dayTitleSub}>
          {date === todayDate ? 'Today' : formatDateDisplay(date)}
        </div>
      </div>

      {/* Podium for top 3 */}
      {topState.status === 'loaded' && top3.length >= 3 && (
        <div className={styles.podium}>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumName}>{top3[1].displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
              <div className={styles.podiumRankBadge}>🥈</div>
              <div className={styles.podiumTime}>{formatTime(top3[1].timeMs)}</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumName}>{top3[0].displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
              <div className={styles.podiumRankBadge}>🥇</div>
              <div className={styles.podiumTime}>{formatTime(top3[0].timeMs)}</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumName}>{top3[2].displayName}</div>
            <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
              <div className={styles.podiumRankBadge}>🥉</div>
              <div className={styles.podiumTime}>{formatTime(top3[2].timeMs)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Loading state for podium */}
      {topState.status === 'loading' && (
        <div className={styles.podium} style={{ opacity: 0.4, filter: 'blur(2px)' }}>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumName}>Player2</div>
            <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
              <div className={styles.podiumRankBadge}>🥈</div>
              <div className={styles.podiumTime}>0:00.00</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumName}>Player1</div>
            <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
              <div className={styles.podiumRankBadge}>🥇</div>
              <div className={styles.podiumTime}>0:00.00</div>
            </div>
          </div>
          <div className={styles.podiumColumn}>
            <div className={styles.podiumName}>Player3</div>
            <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
              <div className={styles.podiumRankBadge}>🥉</div>
              <div className={styles.podiumTime}>0:00.00</div>
            </div>
          </div>
        </div>
      )}

      {topState.status === 'error' && <div className={styles.error}>{topState.message}</div>}

      {/* Scrollable List Area */}
      <div className={styles.scrollArea}>
        {topState.status === 'loaded' && restEntries.length > 0 && (
          <div className={styles.list}>
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

        {topState.status === 'loading' && (
          <div className={styles.list}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.row} style={{ opacity: 0.4 }}>
                <div className={styles.rowRank}>#{i + 4}</div>
                <div className={styles.rowName} style={{ background: 'var(--color-surface)', borderRadius: 4, width: '60%', height: '1em' }}>&nbsp;</div>
                <div className={styles.rowTime} style={{ background: 'var(--color-surface)', borderRadius: 4, width: 50, height: '1em' }}>&nbsp;</div>
                <div className={styles.rowAttempts}>–/3</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderboardView() {
  const todayDate = useMemo(() => getNewYorkDateString(), []);
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const puzzleNumber = useMemo(() => getPuzzleNumberFromNyDateString(selectedDate), [selectedDate]);
  const todayResult = useMemo(() => getTodaysResult(), []);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const showLockedFeatures = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') return true;
    return previewFeaturesEnabled;
  }, [previewFeaturesEnabled]);

  // Me state for the footer - initialize from cache
  const initialMeCache = useMemo(() => readCachedLeaderboardMe(selectedDate), []);
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardMe>>>>(
    initialMeCache ? { status: 'loaded', data: initialMeCache } : { status: 'loading' }
  );
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');

  // Load me data when selectedDate changes - show cached instantly, refresh in background
  useEffect(() => {
    if (!showLockedFeatures) return;

    // Check cache first - show immediately if we have actual data
    const cachedMe = readCachedLeaderboardMe(selectedDate);
    if (cachedMe) {
      setMeState({ status: 'loaded', data: cachedMe });
    }
    // Don't set loading if we already have a loaded state with null data
    // (means user has no entry for that day - already known)

    // Always refresh in background (cachedApi will return from cache if valid)
    cachedApi.leaderboardMe(selectedDate)
      .then(me => setMeState({ status: 'loaded', data: me }))
      .catch(() => setMeState({ status: 'error', message: 'Failed to load' }));
  }, [selectedDate, showLockedFeatures]);

  // Calculate the 3 dates to show (prev, current, next)
  const prevDate = useMemo(() => {
    const prev = shiftDate(selectedDate, -1);
    return prev >= LAUNCH_DATE_NY ? prev : null;
  }, [selectedDate]);

  const nextDate = useMemo(() => {
    const next = shiftDate(selectedDate, 1);
    return next <= todayDate ? next : null;
  }, [selectedDate, todayDate]);

  // Navigation handlers - scroll the carousel smoothly
  const canPrev = selectedDate > LAUNCH_DATE_NY;
  const canNext = selectedDate < todayDate;

  const navPrev = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !canPrev) return;

    // Scroll to the previous panel (smooth animation)
    const panelWidth = container.offsetWidth;
    container.scrollTo({ left: container.scrollLeft - panelWidth, behavior: 'smooth' });
  }, [canPrev]);

  const navNext = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !canNext) return;

    // Scroll to the next panel (smooth animation)
    const panelWidth = container.offsetWidth;
    container.scrollTo({ left: container.scrollLeft + panelWidth, behavior: 'smooth' });
  }, [canNext]);

  // Scroll to center panel on mount and date change
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Find the center panel (index 1 if we have prev, index 0 otherwise)
    const centerIndex = prevDate ? 1 : 0;
    const panelWidth = container.offsetWidth;

    // Scroll instantly to center
    container.scrollTo({ left: centerIndex * panelWidth, behavior: 'instant' });
  }, [selectedDate, prevDate]);

  // Handle scroll end to detect which panel we landed on
  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = window.setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const panelWidth = container.offsetWidth;
      const scrollLeft = container.scrollLeft;
      const panelIndex = Math.round(scrollLeft / panelWidth);

      // Determine which date this corresponds to
      const dates = [prevDate, selectedDate, nextDate].filter(Boolean) as string[];
      const targetDate = dates[panelIndex];

      if (targetDate && targetDate !== selectedDate) {
        isScrollingRef.current = true;
        setSelectedDate(targetDate);

        // Reset the scroll position after state update
        requestAnimationFrame(() => {
          isScrollingRef.current = false;
        });
      }
    }, 100);
  }, [selectedDate, prevDate, nextDate]);

  // Prefetch adjacent days
  useEffect(() => {
    if (!showLockedFeatures) return;

    for (let offset = 1; offset <= 2; offset++) {
      const prev = shiftDate(selectedDate, -offset);
      const next = shiftDate(selectedDate, offset);

      if (prev >= LAUNCH_DATE_NY) prefetchLeaderboard(prev, 50);
      if (next <= todayDate) prefetchLeaderboard(next, 50);
    }
  }, [selectedDate, todayDate, showLockedFeatures]);

  useEffect(() => {
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, []);

  const attemptsUsed = computeAttemptsUsed(todayResult);
  const canSubmit = !!todayResult && todayResult.date === todayDate && !todayResult.failed && attemptsUsed != null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !todayResult || attemptsUsed == null) return;
    setSubmitState('submitting');
    try {
      const result = await api.leaderboardSubmit({
        date: todayDate,
        timeMs: todayResult.timeMs,
        attemptsUsed,
      });
      setSubmitState('submitted');
      
      // Optimistically update the "me" state so user sees their entry immediately
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
      
      // Reload me data in background to get accurate rank if needed
      fetchLeaderboardMeFresh(todayDate)
        .then(me => setMeState({ status: 'loaded', data: me }))
        .catch(() => { /* Already showed optimistic update */ });
    } catch {
      setSubmitState('failed');
    }
  }, [canSubmit, todayResult, attemptsUsed, todayDate]);

  if (!showLockedFeatures) {
    return (
      <div className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>Leaderboard coming soon</div>
          <div className={styles.hintText}>We're still polishing this feature.</div>
        </div>
      </div>
    );
  }

  const mePanel = () => {
    const isToday = selectedDate === todayDate;

    switch (meState.status) {
      case 'loading':
      case 'idle':
        return <div className={styles.hintText}>Loading your rank…</div>;
      case 'error':
        return <div className={styles.hintText}>Unable to load your rank.</div>;
      case 'loaded': {
        const me = meState.data;
        // Case 1: Not submitted yet, or no entry found
        if (!me) {
          if (isToday) {
            if (!todayResult || todayResult.date !== todayDate) {
              return <div className={styles.hintText}>Play today's puzzle to join the leaderboard.</div>;
            }
            if (todayResult.failed) {
              return <div className={styles.hintText}>Only successful solves can be submitted.</div>;
            }

            // Can submit! Show inline button
            const accountMe = readCachedMe();
            const displayName = accountMe?.displayName ?? 'You';
            return (
              <div className={styles.meRow}>
                <div className={styles.meLeft}>
                  <div className={styles.meName}>{displayName}</div>
                  <div className={styles.meMeta}>
                    {formatTime(todayResult.timeMs)} • {attemptsUsed}/3 tries
                  </div>
                </div>
                <div className={styles.meRight}>
                  <button
                    className={styles.submitButtonSmall}
                    onClick={handleSubmit}
                    disabled={submitState === 'submitting'}
                  >
                    {submitState === 'submitting' ? '...' : 'Submit Time'}
                  </button>
                </div>
              </div>
            );
          }
          const accountMe = readCachedMe();
          const displayName = accountMe?.displayName ?? 'You';
          return (
            <div className={styles.meRow}>
              <div className={styles.meLeft}>
                <div className={styles.meName}>{displayName}</div>
                <div className={styles.meMeta} style={{ color: 'var(--color-secondary)' }}>
                  No entry for this day
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className={styles.meRow}>
            <div className={styles.meLeft}>
              <div className={styles.meName}>{me.displayName}</div>
              <div className={styles.meMeta}>
                {formatTime(me.timeMs)} • {me.attemptsUsed}/3 tries
              </div>
            </div>
            <div className={styles.meRight}>
              <div className={styles.rank}>#{me.rank}</div>
            </div>
          </div>
        );
      }
    }
  };



  // Build the list of dates to render
  const datesToRender = [prevDate, selectedDate, nextDate].filter(Boolean) as string[];

  return (
    <div className={styles.grid}>
      {/* Header with day navigation */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.navButton}
          onClick={navPrev}
          disabled={!canPrev}
          aria-label="Previous day"
        >
          <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 8H1M1 8L8 1M1 8L8 15" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.navButton}
          onClick={navNext}
          disabled={!canNext}
          aria-label="Next day"
        >
          <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 8H19M19 8L12 1M19 8L12 15" />
          </svg>
        </button>
      </div>

      {/* Carousel container */}
      <div
        ref={scrollContainerRef}
        className={styles.carousel}
        onScroll={handleScroll}
      >
        {datesToRender.map((date) => (
          <LeaderboardDayPanel
            key={date}
            date={date}
            todayDate={todayDate}
            showLockedFeatures={showLockedFeatures}
          />
        ))}
      </div>

      {/* Sticky Footer - Me section (always visible) */}
      <div className={styles.footer}>
        <div className={styles.sectionTitle} style={{ marginBottom: '0.5rem' }}>You</div>
        {mePanel()}
        {selectedDate === todayDate && submitState === 'failed' && <div className={styles.error} style={{ marginTop: '0.5rem' }}>Couldn't submit. Try again.</div>}
      </div>
    </div>
  );
}

export default React.memo(LeaderboardView);
